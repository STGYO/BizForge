CREATE TABLE IF NOT EXISTS automation_workflows (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  action_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  error TEXT,
  execution_payload JSONB,
  CONSTRAINT fk_automation_executions_workflow
    FOREIGN KEY (workflow_id)
    REFERENCES automation_workflows(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_automation_workflows_org_enabled
  ON automation_workflows (organization_id, enabled);

CREATE INDEX IF NOT EXISTS idx_automation_executions_workflow_started
  ON automation_executions (workflow_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_executions_org_status
  ON automation_executions (organization_id, status);
