import httpx
from fastapi import APIRouter, Header, HTTPException, Depends, status
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database.connection import get_db
from app.tools.db_tools import execute_raw_sql

router = APIRouter()

# Updated active OpenRouter model endpoints
AVAILABLE_MODELS = [
    {"id": "mistralai/mistral-small-24b-instruct-2501:free", "name": "Mistral Small 24B (FREE)", "free": True},
    {"id": "qwen/qwen-2.5-72b-instruct", "name": "Qwen 2.5 72B (Paid / Fast)", "free": False},
    {"id": "meta-llama/llama-3.3-70b-instruct", "name": "Llama 3.3 70B (Paid)", "free": False},
    {"id": "google/gemini-2.0-flash-001", "name": "Gemini 2.0 Flash (Paid / Recommended)", "free": False},
]

class KeyVerifyRequest(BaseModel):
    api_key: str = Field(..., alias="key")

    class Config:
        populate_by_name = True

class ChatRequest(BaseModel):
    message: str
    tenant_id: str
    model: Optional[str] = "mistralai/mistral-small-24b-instruct-2501:free"

class ExecuteSqlRequest(BaseModel):
    query: str
    tenant_id: str

@router.get("/models")
async def list_models():
    return {"models": AVAILABLE_MODELS}

@router.post("/verify-key")
async def verify_openrouter_key(payload: KeyVerifyRequest):
    key_to_check = payload.api_key.strip()
    if not key_to_check:
        raise HTTPException(status_code=400, detail="API Key cannot be empty.")

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                "https://openrouter.ai/api/v1/auth/key",
                headers={"Authorization": f"Bearer {key_to_check}"},
                timeout=10.0
            )
            if response.status_code == 200:
                return {"valid": True, "message": "Key Verified Successfully"}
            raise HTTPException(status_code=401, detail="Invalid OpenRouter Key.")
        except httpx.RequestError:
            raise HTTPException(status_code=503, detail="Failed to reach OpenRouter API.")

@router.post("/chat")
async def execute_agent_chat(
    payload: ChatRequest,
    x_openrouter_api_key: Optional[str] = Header(None)
):
    if not x_openrouter_api_key:
        raise HTTPException(status_code=401, detail="Missing OpenRouter API Key in header.")

    system_prompt = (
        f"You are SubStrata-01 EAV Engine operating for tenant [{payload.tenant_id}]. "
        "When asked to create or query entities, analyze the request and provide:\n"
        "1. A structured EAV breakdown.\n"
        "2. An executable PostgreSQL SQL query snippet wrapped in ```sql ... ``` code blocks.\n"
        "Assume standard EAV tables: entities (id, tenant_id, name), attributes (id, name), "
        "and entity_values (entity_id, attribute_id, value_text)."
    )

    openrouter_payload = {
        "model": payload.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": payload.message}
        ]
    }

    headers = {
        "Authorization": f"Bearer {x_openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "SubStrata Engine"
    }

    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=openrouter_payload,
                timeout=45.0
            )
            data = res.json()
            if res.status_code == 200 and "choices" in data and len(data["choices"]) > 0:
                return {"reply": data["choices"][0]["message"]["content"], "model": payload.model}
            
            err = data.get("error", {}).get("message") if isinstance(data, dict) else res.text
            raise HTTPException(status_code=res.status_code or 500, detail=f"OpenRouter Error: {err}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Network error: {str(e)}")

@router.post("/execute-sql")
async def run_sql(payload: ExecuteSqlRequest, db: AsyncSession = Depends(get_db)):
    return await execute_raw_sql(db, payload.query, payload.tenant_id)

@router.get("/inspect/{tenant_id}")
async def inspect_tenant_database(tenant_id: str, db: AsyncSession = Depends(get_db)):
    """Fetches full dynamic EAV state for tenant visualization."""
    try:
        query = text("""
            SELECT e.id as entity_id, e.name as entity_name, a.name as attribute, ev.value_text as value
            FROM entities e
            LEFT JOIN entity_values ev ON e.id = ev.entity_id
            LEFT JOIN attributes a ON ev.attribute_id = a.id
            WHERE e.tenant_id = :tenant_id
        """)
        result = await db.execute(query, {"tenant_id": tenant_id})
        rows = [dict(row._mapping) for row in result.fetchall()]
        return {"tenant_id": tenant_id, "data": rows}
    except Exception as e:
        return {"tenant_id": tenant_id, "data": [], "error": str(e)}