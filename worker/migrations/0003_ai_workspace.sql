-- User-owned BYOK references only. No plaintext keys or provider credentials.
CREATE TABLE ai_provider_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'openrouter' CHECK(provider='openrouter'),
  credential_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  default_model TEXT,
  verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE ai_conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  database_id TEXT REFERENCES managed_tenant_databases(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  busy_id TEXT,
  allow_rows INTEGER NOT NULL DEFAULT 0 CHECK(allow_rows IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_conversation_scope ON ai_conversations(user_id,workspace_id,updated_at);
CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed','failed','cancelled')),
  proposed_sql TEXT,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  trace_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(trace_json)),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id,created_at);
