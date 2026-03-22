CREATE TABLE IF NOT EXISTS managed_plugins (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  plugin_name TEXT NOT NULL,
  plugin_version TEXT NOT NULL,
  state TEXT NOT NULL,
  depends_on JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plugin_lifecycle_audit (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_plugin_lifecycle_audit_plugin
    FOREIGN KEY (plugin_id)
    REFERENCES managed_plugins(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_managed_plugins_org_state
  ON managed_plugins (organization_id, state);

CREATE INDEX IF NOT EXISTS idx_managed_plugins_org_updated
  ON managed_plugins (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_lifecycle_audit_plugin_created
  ON plugin_lifecycle_audit (plugin_id, created_at DESC);
