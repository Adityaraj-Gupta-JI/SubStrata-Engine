from langchain_core.tools import tool
from app.database.connection import get_db_connection
import json

@tool
def query_eav_data(tenant_id: str, entity_type: str = None) -> str:
    """
    Retrieves entities and their attributes for a specific tenant.
    Optionally filter by entity_type.
    """
    try:
        with get_db_connection(tenant_id=tenant_id) as conn:
            with conn.cursor() as cur:
                if entity_type:
                    cur.execute(
                        """
                        SELECT e.entity_id, e.entity_type, a.attribute_name, v.value_text, v.value_numeric 
                        FROM entities e
                        JOIN values v ON e.entity_id = v.entity_id
                        JOIN attributes a ON v.attribute_id = a.attribute_id
                        WHERE e.entity_type = %s;
                        """,
                        (entity_type,)
                    )
                else:
                    cur.execute(
                        """
                        SELECT e.entity_id, e.entity_type, a.attribute_name, v.value_text, v.value_numeric 
                        FROM entities e
                        JOIN values v ON e.entity_id = v.entity_id
                        JOIN attributes a ON v.attribute_id = a.attribute_id;
                        """
                    )
                rows = cur.fetchall()
                if not rows:
                    return f"No records found for tenant '{tenant_id}'."
                
                results = []
                for row in rows:
                    results.append({
                        "entity_id": str(row[0]),
                        "entity_type": row[1],
                        "attribute": row[2],
                        "value": row[3] if row[3] is not None else row[4]
                    })
                return json.dumps(results)
    except Exception as e:
        return f"Error querying database: {str(e)}"

@tool
def upsert_eav_entity(tenant_id: str, entity_type: str, attributes: dict) -> str:
    """
    Creates or updates an entity with given key-value attributes for a specific tenant.
    `attributes` should be a dictionary like {"name": "Product A", "price": 49.99}.
    """
    try:
        with get_db_connection(tenant_id=tenant_id) as conn:
            with conn.cursor() as cur:
                # 1. Create Entity
                cur.execute(
                    "INSERT INTO entities (tenant_id, entity_type) VALUES (%s, %s) RETURNING entity_id;",
                    (tenant_id, entity_type)
                )
                entity_id = cur.fetchone()[0]

                # 2. Insert Attributes and Values
                for key, val in attributes.items():
                    cur.execute(
                        "INSERT INTO attributes (tenant_id, attribute_name) VALUES (%s, %s) "
                        "ON CONFLICT (tenant_id, attribute_name) DO UPDATE SET attribute_name=EXCLUDED.attribute_name "
                        "RETURNING attribute_id;",
                        (tenant_id, key)
                    )
                    attr_id = cur.fetchone()[0]

                    val_text = str(val) if isinstance(val, str) else None
                    val_num = float(val) if isinstance(val, (int, float)) else None

                    cur.execute(
                        "INSERT INTO values (entity_id, attribute_id, value_text, value_numeric) VALUES (%s, %s, %s, %s);",
                        (entity_id, attr_id, val_text, val_num)
                    )
                conn.commit()
                return f"Successfully created entity '{entity_type}' with ID {entity_id}."
    except Exception as e:
        return f"Error inserting entity: {str(e)}"