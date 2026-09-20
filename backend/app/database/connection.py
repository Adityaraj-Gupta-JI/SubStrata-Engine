import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

raw_database_url = os.getenv(
    "DATABASE_URL", 
    "postgresql+asyncpg://postgres:postgres@localhost:5432/substrata_db"
)

# Ensure asyncpg driver dialect prefix is present
if raw_database_url.startswith("postgresql://"):
    DATABASE_URL = raw_database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
else:
    DATABASE_URL = raw_database_url

# Async engine configuration
engine = create_async_engine(
    DATABASE_URL, 
    echo=False, 
    future=True,
    pool_pre_ping=True
)

AsyncSessionLocal = async_sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()