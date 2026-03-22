-- Migration: Add automation execution audit log
CREATE TABLE IF NOT EXISTS automation_execution_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  trigger_event_id TEXT,
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  actions_triggered INTEGER DEFAULT 0,
  conditions_summary JSONB,
  actions_executed JSONB[] DEFAULT ARRAY[]::JSONB[],
  errors TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'pending', -- pending, success, partial_failure, failed
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT organization_audit_fk CHECK (organization_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_automation_audit_rule_org ON automation_execution_audit(rule_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_automation_audit_created ON automation_execution_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_audit_status ON automation_execution_audit(status);

-- Table for dead-lettered failed actions (retry exhausted)
CREATE TABLE IF NOT EXISTS automation_dead_letter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  original_event JSONB NOT NULL,
  action_config JSONB NOT NULL,
  failure_reason TEXT NOT NULL,
  retry_attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT organization_deadletter_fk CHECK (organization_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_automation_deadletter_org ON automation_dead_letter(organization_id);
CREATE INDEX IF NOT EXISTS idx_automation_deadletter_created ON automation_dead_letter(created_at DESC);
