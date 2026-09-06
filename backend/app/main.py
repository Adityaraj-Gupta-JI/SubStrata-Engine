from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from app.database.connection import check_db_health
from app.agents.llm import verify_user_api_key
from app.agents.graph import run_agent_workflow
from app.tools.db_tools import query_eav_data, upsert_eav_entity

app = FastAPI(title="SubStrata Engine API", version="0.1.0")

class ChatRequest(BaseModel):
    message: str
    tenant_id: str

class KeyVerifyRequest(BaseModel):
    api_key: str

@app.get("/health/db")
def db_health():
    if not check_db_health():
        raise HTTPException(status_code=503, detail="Database connection failed.")
    return {"status": "ok", "database": "connected"}

@app.post("/api/v1/verify-key")
def verify_key(payload: KeyVerifyRequest):
    if not verify_user_api_key(payload.api_key):
        raise HTTPException(status_code=400, detail="Invalid API Key or quota exceeded.")
    return {"status": "valid", "message": "API key verified successfully."}

@app.post("/api/v1/chat")
def chat_endpoint(
    payload: ChatRequest,
    x_openrouter_api_key: str = Header(..., alias="X-OpenRouter-API-Key")
):
    try:
        registered_tools = [query_eav_data, upsert_eav_entity]
        
        reply = run_agent_workflow(
            messages=[HumanMessage(content=payload.message)],
            tenant_id=payload.tenant_id,
            api_key=x_openrouter_api_key,
            tools=registered_tools
        )
        return {"status": "success", "tenant_id": payload.tenant_id, "reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))