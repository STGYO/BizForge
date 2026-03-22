CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  staff_id TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_activity (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_appointment_activity_appointment
    FOREIGN KEY (appointment_id)
    REFERENCES appointments(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appointments_org_start
  ON appointments (organization_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_appointments_customer_status
  ON appointments (customer_id, status);

CREATE INDEX IF NOT EXISTS idx_appointment_activity_appointment_created
  ON appointment_activity (appointment_id, created_at DESC);
