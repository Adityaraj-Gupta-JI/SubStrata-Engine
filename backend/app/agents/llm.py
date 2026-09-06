import logging
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

def get_llm_client(api_key: str, model_name: str = "qwen/qwen-2.5-72b-instruct"):
    if not api_key or not api_key.strip():
        raise ValueError("A valid OpenRouter API key must be provided.")

    return ChatOpenAI(
        model=model_name,
        openai_api_key=api_key,
        openai_api_base="https://openrouter.ai/api/v1",
        temperature=0.1,
        default_headers={
            "HTTP-Referer": "http://localhost:8000",
            "X-Title": "SubStrata Engine",
        }
    )

def verify_user_api_key(api_key: str) -> bool:
    try:
        llm = get_llm_client(api_key=api_key)
        response = llm.invoke("Test connection. Respond with 'OK'.")
        return bool(response and response.content)
    except Exception as e:
        logger.error(f"User API Key Verification Failed: {e}")
        return False