CREATE ROLE inspection_role LOGIN PASSWORD '...';   -- set the real password outside git
GRANT USAGE ON SCHEMA inspection TO inspection_role;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA inspection TO inspection_role;  -- no UPDATE/DELETE
GRANT USAGE ON ALL SEQUENCES IN SCHEMA inspection TO inspection_role;
GRANT SELECT ON users.app_users TO inspection_role;  -- only if shared/auth.js loads officeId from it
 *

 CREATE ROLE booking_role LOGIN PASSWORD '...';   -- set the real password outside git
GRANT USAGE ON SCHEMA booking TO booking_role;
GRANT SELECT, INSERT, UPDATE ON booking.bookings TO booking_role;  -- no DELETE: rows are never deleted
GRANT SELECT, INSERT ON booking.audit_log TO booking_role;         -- no UPDATE/DELETE
GRANT SELECT ON users.app_users TO booking_role;   -- shared/auth.js loads officeId from it
GRANT USAGE ON SCHEMA users TO booking_role;       -- needed to reach users.app_users