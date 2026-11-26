CREATE SCHEMA IF NOT EXISTS inspection;

 
CREATE TABLE inspection.condition_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL,            
  car_id        UUID NOT NULL,            
  office_id     UUID NOT NULL,             
  type          TEXT NOT NULL CHECK (type IN ('pickup','return')),
  odometer_km   INTEGER NOT NULL CHECK (odometer_km >= 0),
  fuel_level    TEXT NOT NULL CHECK (fuel_level IN ('empty','quarter','half','three_quarter','full')),
  notes         TEXT CHECK (char_length(notes) <= 2000),  -- stored and shown as plain text
  recorded_by   TEXT NOT NULL,            -- Cognito sub, from the token, never from the body
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, type)               -- one pickup and one return per booking
);

CREATE TABLE inspection.photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES inspection.condition_reports(id),
  s3_key        TEXT NOT NULL UNIQUE,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inspection.damage_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id        UUID NOT NULL,
  office_id     UUID NOT NULL,
  return_report_id UUID NOT NULL REFERENCES inspection.condition_reports(id),
  pickup_report_id UUID NOT NULL REFERENCES inspection.condition_reports(id),
  description   TEXT NOT NULL CHECK (char_length(description) <= 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inspection.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON inspection.condition_reports (booking_id);
CREATE INDEX ON inspection.condition_reports (car_id);
CREATE INDEX ON inspection.damage_flags (office_id, created_at DESC);

-- Insert-only trigger (defence in depth on top of the role grants)
CREATE OR REPLACE FUNCTION inspection.block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: records are insert-only', TG_OP, TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER no_change_reports BEFORE UPDATE OR DELETE ON inspection.condition_reports
  FOR EACH ROW EXECUTE FUNCTION inspection.block_changes();
CREATE TRIGGER no_change_photos BEFORE UPDATE OR DELETE ON inspection.photos
  FOR EACH ROW EXECUTE FUNCTION inspection.block_changes();
CREATE TRIGGER no_change_flags BEFORE UPDATE OR DELETE ON inspection.damage_flags
  FOR EACH ROW EXECUTE FUNCTION inspection.block_changes();
CREATE TRIGGER no_change_audit BEFORE UPDATE OR DELETE ON inspection.audit_log
  FOR EACH ROW EXECUTE FUNCTION inspection.block_changes();