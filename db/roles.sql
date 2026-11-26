CREATE ROLE inspection_role LOGIN PASSWORD '...';   -- set the real password outside git
GRANT USAGE ON SCHEMA inspection TO inspection_role;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA inspection TO inspection_role;  -- no UPDATE/DELETE
GRANT USAGE ON ALL SEQUENCES IN SCHEMA inspection TO inspection_role;
GRANT SELECT ON users.app_users TO inspection_role;  -- only if shared/auth.js loads officeId from it
 *

 -- Booking service role: only touches the bookings table
CREATE ROLE booking_role WITH LOGIN PASSWORD 'REPLACE_ME';

GRANT USAGE ON SCHEMA public TO booking_role;
GRANT SELECT, INSERT, UPDATE ON bookings TO booking_role;