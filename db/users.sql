CREATE SCHEMA IF NOT EXISTS users;

CREATE TABLE users.app_users (
  id          TEXT PRIMARY KEY,                 -- Cognito sub
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff')),
  office_id   UUID,                             -- staff only; no FK (offices live in Catalogue)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);