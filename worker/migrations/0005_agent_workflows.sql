ALTER TABLE ai_conversations ADD COLUMN external_database_id TEXT REFERENCES external_databases(id);
CREATE TABLE agent_definitions (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 name TEXT NOT NULL,
 template TEXT NOT NULL CHECK(template IN ('schema-analyst','query-assistant','data-explorer')),
 instructions TEXT NOT NULL,
 model TEXT NOT NULL,
 database_id TEXT,
 max_steps INTEGER NOT NULL CHECK(max_steps BETWEEN 1 AND 8),
 deadline_seconds INTEGER NOT NULL CHECK(deadline_seconds BETWEEN 10 AND 120),
 allow_rows INTEGER NOT NULL DEFAULT 0 CHECK(allow_rows IN (0,1)),
 deleted_at TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE agent_runs (
 id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL REFERENCES agent_definitions(id),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 conversation_id TEXT NOT NULL REFERENCES ai_conversations(id),
 goal TEXT NOT NULL,
 configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
 status TEXT NOT NULL CHECK(status IN ('running','cancelling','cancelled','completed','failed','interrupted')),
 deadline_at INTEGER NOT NULL,
 error_code TEXT,
 usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 finished_at TEXT
);
CREATE TABLE agent_run_steps (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES agent_runs(id),
 sequence INTEGER NOT NULL,
 detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(run_id,sequence)
);
CREATE INDEX idx_agent_scope ON agent_definitions(workspace_id,user_id);
CREATE INDEX idx_agent_runs_scope ON agent_runs(workspace_id,user_id,created_at);
