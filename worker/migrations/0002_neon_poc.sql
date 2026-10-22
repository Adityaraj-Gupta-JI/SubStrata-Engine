-- Additive PoC metadata. Legacy organization-level database_tenants is preserved.
-- Credentials live outside D1. Only a deterministic opaque reference is accepted.
CREATE TABLE managed_tenant_databases (
  id TEXT PRIMARY KEY CHECK (length(id) = 32 AND id NOT GLOB '*[^a-f0-9]*'),
  workspace_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'neon' CHECK (provider = 'neon'),
  project_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  database_name TEXT NOT NULL CHECK (database_name = 'ss_t_' || id),
  runtime_role TEXT NOT NULL CHECK (runtime_role = 'ss_r_' || id),
  credential_reference TEXT NOT NULL CHECK (credential_reference = 'neon-runtime/' || id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'database_pending', 'role_pending', 'validating', 'active', 'failed')),
  operation_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(operation_ids)),
  claim_id TEXT,
  retry_not_before INTEGER NOT NULL DEFAULT 0,
  last_error TEXT CHECK (last_error IS NULL OR last_error IN ('PROVIDER_RETRY', 'RECONCILE_REQUIRED', 'PROVIDER_CREDENTIALS', 'PROVIDER_FAILURE', 'PROVIDER_PROTOCOL', 'RESOURCE_CONFLICT', 'UNSAFE_ROLE', 'ISOLATION_FAILED', 'UNSAFE_EXTENSION_OR_ROUTINE', 'ROLE_CONFIGURATION_FAILED', 'MISSING_CREDENTIALS', 'QUARANTINE_REQUIRED', 'PROVISIONING_FAILED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (project_id, branch_id, database_name),
  UNIQUE (project_id, branch_id, runtime_role),
  UNIQUE (credential_reference)
);
CREATE INDEX idx_managed_tenants_state ON managed_tenant_databases(state);
