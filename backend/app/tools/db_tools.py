from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from fastapi import HTTPException, status

async def execute_raw_sql(db: AsyncSession, query_str: str, tenant_id: str):
    """
    Safely executes raw SQL queries against PostgreSQL.
    Safeguards against destructive operations and handles parameterized vs unparameterized raw SQL.
    """
    forbidden_keywords = ["DROP DATABASE", "TRUNCATE", "ALTER SYSTEM", "DROP TABLE"]
    upper_query = query_str.upper().strip()
    
    if any(keyword in upper_query for keyword in forbidden_keywords):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Forbidden SQL operation detected. Destructive commands are strictly prohibited."
        )

    try:
        # Check if the generated query explicitly uses :tenant_id parameter
        params = {}
        if ":tenant_id" in query_str:
            params["tenant_id"] = tenant_id

        result = await db.execute(text(query_str), params)
        await db.commit()

        if result.returns_rows:
            rows = [dict(row._mapping) for row in result.fetchall()]
            return {
                "status": "success",
                "rows_affected": len(rows),
                "data": rows
            }

        return {
            "status": "success",
            "rows_affected": result.rowcount if result.rowcount != -1 else 0,
            "data": []
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Database execution error: {str(e)}"
        )