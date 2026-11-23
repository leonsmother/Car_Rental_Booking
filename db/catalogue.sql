-- Catalogue schema (owner: Jana)
-- Run on the Neon DEV branch first, then on main.
-- IDs are UUIDs (like 3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90), the same type the whole team uses,
-- e.g. users.app_users.office_id. UUIDs also cannot be guessed (/cars/2, /cars/3...).
-- Permissions for catalogue_role are in db/catalogue_role.sql.

CREATE SCHEMA IF NOT EXISTS catalogue;

-- Offices are created by the team (seed.sql), edited by their own staff (C9)
CREATE TABLE IF NOT EXISTS catalogue.offices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  city         VARCHAR(60)  NOT NULL,
  address      VARCHAR(200) NOT NULL,
  latitude     NUMERIC(9,6),            -- filled by Nominatim; NULL if it was down
  longitude    NUMERIC(9,6),
  phone        VARCHAR(20),
  geocoded_at  TIMESTAMPTZ,             -- when the coordinates were last looked up
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cars are never hard-deleted: C5 sets status = 'retired' so bookings keep their history
CREATE TABLE IF NOT EXISTS catalogue.cars (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id    UUID         NOT NULL REFERENCES catalogue.offices(id),
  plate        VARCHAR(15)  NOT NULL UNIQUE,
  make         VARCHAR(40)  NOT NULL,
  model        VARCHAR(40)  NOT NULL,
  category     VARCHAR(20)  NOT NULL
               CHECK (category IN ('economy', 'compact', 'sedan', 'suv', 'van', 'luxury')),
  daily_price  NUMERIC(10,2) NOT NULL CHECK (daily_price > 0),   -- in EGP
  status       VARCHAR(12)  NOT NULL DEFAULT 'available'
               CHECK (status IN ('available', 'maintenance', 'retired')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cars_office_idx ON catalogue.cars (office_id);
CREATE INDEX IF NOT EXISTS cars_search_idx ON catalogue.cars (category, status, daily_price);

-- Who changed which car or office, and when (insert and read only)
CREATE TABLE IF NOT EXISTS catalogue.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    TEXT        NOT NULL,     -- Cognito user id (sub) from the token
  action      VARCHAR(40) NOT NULL,     -- e.g. car.create, car.update, car.retire, office.update
  target_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
