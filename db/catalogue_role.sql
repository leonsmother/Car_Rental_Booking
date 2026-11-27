-- The role itself is created separately in Neon (never committed):
--   CREATE ROLE catalogue_role LOGIN PASSWORD '<set in Neon>';
-- Catalogue tables: read, add, change. No DELETE: cars are retired, never deleted.
GRANT USAGE ON SCHEMA catalogue TO catalogue_role;
GRANT SELECT, UPDATE ON catalogue.offices TO catalogue_role;
GRANT SELECT, INSERT, UPDATE ON catalogue.cars TO catalogue_role;

-- Audit log: add lines and read them, but never edit or delete them
GRANT SELECT, INSERT ON catalogue.audit_log TO catalogue_role;
GRANT USAGE ON SEQUENCE catalogue.audit_log_id_seq TO catalogue_role;

-- Users table: read-only, to find which office a staff member works at
GRANT USAGE ON SCHEMA users TO catalogue_role;
GRANT SELECT (cognito_sub, office_id, role) ON users.app_users TO catalogue_role;