import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from contextlib import contextmanager
from app.config import settings

# Threaded connection pool for high-concurrency agent workflows
pool = ThreadedConnectionPool(
    minconn=1,
    maxconn=20,
    user=settings.POSTGRES_USER,
    password=settings.POSTGRES_PASSWORD,
    host=settings.POSTGRES_HOST,
    port=settings.POSTGRES_PORT,
    database=settings.POSTGRES_DB
)

@contextmanager
def get_db_connection(tenant_id: str = None):
    conn = pool.getconn()
    try:
        if tenant_id:
            with conn.cursor() as cursor:
                cursor.execute("SET LOCAL app.current_tenant_id = %s;", (tenant_id,))
        yield conn
    finally:
        pool.putconn(conn)