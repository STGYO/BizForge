CREATE SCHEMA IF NOT EXISTS plugin_appointment_manager;

CREATE TABLE IF NOT EXISTS plugin_appointment_manager.appointments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_org_start
  ON plugin_appointment_manager.appointments (organization_id, starts_at);
