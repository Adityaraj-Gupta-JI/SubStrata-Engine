import importlib
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

main_module = importlib.import_module("app.main")
api_module = importlib.import_module("app.routers.api")


class LegacyContainmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_sql_route_is_registered_but_never_opens_database(self):
        statements = [
            "SELECT * FROM tenants",
            "DELETE FROM tenants",
            "DROP TABLE tenants; SELECT 1",
            "UPDATE tenants SET company_name = 'changed'",
        ]
        with patch("app.database.connection.AsyncSessionLocal") as session_factory, patch(
            "app.tools.db_tools.execute_raw_sql", new_callable=AsyncMock
        ) as sql_helper:
            for query in statements:
                with self.subTest(query=query):
                    response = TestClient(main_module.app).post(
                        "/api/v1/execute-sql",
                        json={"query": query, "tenant_id": "arbitrary"},
                    )
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json(), {"detail": "Legacy SQL execution is unavailable."})
            session_factory.assert_not_called()
            sql_helper.assert_not_awaited()

    async def test_tenant_inspection_is_disabled_without_database_access(self):
        with patch("app.database.connection.AsyncSessionLocal") as session_factory:
            response = TestClient(main_module.app).get("/api/v1/inspect/other-tenant")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {"detail": "Legacy database inspection is unavailable."})
            session_factory.assert_not_called()

    async def test_models_and_chat_key_requirement_remain_available(self):
        self.assertTrue((await api_module.list_models())["models"])
        with self.assertRaises(HTTPException) as chat_error:
            await api_module.execute_agent_chat(
                api_module.ChatRequest(message="hello", tenant_id="demo"), None
            )
        self.assertEqual(chat_error.exception.status_code, 401)
        with self.assertRaises(HTTPException) as key_error:
            await api_module.verify_openrouter_key(
                api_module.KeyVerifyRequest(key=" ")
            )
        self.assertEqual(key_error.exception.status_code, 400)

    async def test_chat_success_remains_available_with_mocked_provider(self):
        provider_response = Mock()
        provider_response.status_code = 200
        provider_response.json.return_value = {
            "choices": [{"message": {"content": "Mocked provider reply"}}]
        }
        with patch("app.routers.api.httpx.AsyncClient") as provider_client:
            provider_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=provider_response
            )
            result = await api_module.execute_agent_chat(
                api_module.ChatRequest(message="hello", tenant_id="demo"), "test-key"
            )
        self.assertEqual(result["reply"], "Mocked provider reply")

    async def test_errors_do_not_echo_provider_or_database_secrets(self):
        provider_response = Mock()
        provider_response.status_code = 401
        provider_response.json.return_value = {"error": {"message": "SECRET_SENTINEL"}}
        with patch("app.routers.api.httpx.AsyncClient") as provider_client:
            provider_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=provider_response
            )
            with self.assertRaises(HTTPException) as chat_error:
                await api_module.execute_agent_chat(
                    api_module.ChatRequest(message="hello", tenant_id="demo"),
                    "test-key",
                )
        self.assertEqual(chat_error.exception.status_code, 502)
        self.assertNotIn("SECRET_SENTINEL", chat_error.exception.detail)

        async def failing_db():
            raise RuntimeError("SECRET_SENTINEL")
            yield  # pragma: no cover

        with patch.object(main_module, "get_db", failing_db):
            result = await main_module.health_db()
        self.assertEqual(result, {"status": "degraded", "database": "disconnected"})


if __name__ == "__main__":
    unittest.main()
