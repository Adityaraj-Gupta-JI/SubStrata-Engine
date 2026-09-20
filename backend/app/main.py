from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

# Import database connection
from app.database.connection import get_db

# Import the router defined in app/routers/api.py
from app.routers.api import router as api_router

app = FastAPI(
    title="SubStrata Engine API",
    version="0.1.0",
    description="Dynamic EAV Multi-Tenant Agent Engine"
)

# 1. Enable CORS Middleware to accept requests from Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows local dev from http://localhost:3000
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Database Health Check Endpoint (/health/db)
@app.get("/health/db")
async def health_db():
    """Health check endpoint to verify database & backend readiness."""
    try:
        async for db in get_db():
            await db.execute(text("SELECT 1"))
            return {"status": "online", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "database": "disconnected", "error": str(e)}

# 3. Mount API v1 Router from app/routers/api.py
app.include_router(api_router, prefix="/api/v1")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)