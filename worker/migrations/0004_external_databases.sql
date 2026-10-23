CREATE TABLE external_databases (
 id TEXT PRIMARY KEY CHECK(length(id)=32),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 name TEXT NOT NULL,
 destination_id TEXT NOT NULL,
 destination_digest TEXT NOT NULL,
 database_name TEXT NOT NULL,
 runtime_role TEXT NOT NULL,
 schema_name TEXT NOT NULL,
 credential_reference TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('pending','active','failed')),
 last_error TEXT,
 revision INTEGER NOT NULL DEFAULT 1,
 disconnected INTEGER NOT NULL DEFAULT 0 CHECK(disconnected IN (0,1)),
 checked_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id)
);
CREATE INDEX idx_external_workspace ON external_databases(workspace_id,organization_id);
