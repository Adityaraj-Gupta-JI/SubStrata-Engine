import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "substrata_admin")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "substrata_secure_pass_2026")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "substrata_db")
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: int = int(os.getenv("POSTGRES_PORT", 5432))
    
    QDRANT_HOST: str = os.getenv("QDRANT_HOST", "localhost")
    QDRANT_PORT: int = int(os.getenv("QDRANT_PORT", 6333))
    
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "qwen2.5-coder:7b-instruct")

    class Config:
        env_file = ".env"

settings = Settings()