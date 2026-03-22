CREATE TABLE IF NOT EXISTS workflow_tasks (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assignee TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  linked_entity_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workflow_task_history (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_org_status_due
  ON workflow_tasks (organization_id, status, due_at ASC);

CREATE INDEX IF NOT EXISTS idx_workflow_task_history_task_changed
  ON workflow_task_history (task_id, changed_at DESC);
