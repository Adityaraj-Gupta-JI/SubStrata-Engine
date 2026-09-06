import os
import psycopg2
from psycopg2 import pool
from contextlib import contextmanager
import logging

logger = logging.getLogger(__name__)

DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/substrata_db")

try:
    db_pool = psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=DB_URL)
except Exception as e:
    logger.error(f"Failed to initialize database connection pool: {e}")
    db_pool = None

@contextmanager
def get_db_connection(tenant_id: str = None):
    if not db_pool:
        raise RuntimeError("Database pool is not initialized.")
    conn = db_pool.getconn()
    try:
        if tenant_id:
            with conn.cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false);", (tenant_id,))
        yield conn
    finally:
        db_pool.putconn(conn)

def check_db_health() -> bool:
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                return cur.fetchone()[0] == 1
    except Exception as e:
        logger.error(f"Database Health Check Failed: {e}")
        return False