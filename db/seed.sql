-- Test data (owner: Jana). Run AFTER catalogue.sql, on the DEV branch.
-- The IDs are FIXED (not random) so everyone can use the same ones:
--   - Ghada links staff accounts to an office in users.app_users.office_id
--   - catalogue.http and the tests use these exact IDs
-- Coordinates are empty; fill them with:  npm run geocode-offices

INSERT INTO catalogue.offices (id, name, city, address, phone) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000001', 'Downtown Cairo Office', 'Cairo',      'Tahrir Square',                     '+20 2 0000 0001'),
  ('a1a1a1a1-0000-4000-8000-000000000002', 'Heliopolis Office',     'Cairo',      'El Merghany Street, Heliopolis',    '+20 2 0000 0002'),
  ('a1a1a1a1-0000-4000-8000-000000000003', 'Alexandria Office',     'Alexandria', 'Stanley, Alexandria',               '+20 3 0000 0003')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.cars (id, office_id, plate, make, model, category, daily_price) VALUES
  ('c0c0c0c0-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001', 'ABC 101', 'Hyundai',   'Accent',   'economy', 900),
  ('c0c0c0c0-0000-4000-8000-000000000002', 'a1a1a1a1-0000-4000-8000-000000000001', 'ABC 102', 'Toyota',    'Corolla',  'sedan',   1300),
  ('c0c0c0c0-0000-4000-8000-000000000003', 'a1a1a1a1-0000-4000-8000-000000000001', 'ABC 103', 'Kia',       'Sportage', 'suv',     2100),
  ('c0c0c0c0-0000-4000-8000-000000000004', 'a1a1a1a1-0000-4000-8000-000000000002', 'DEF 201', 'Nissan',    'Sunny',    'economy', 850),
  ('c0c0c0c0-0000-4000-8000-000000000005', 'a1a1a1a1-0000-4000-8000-000000000002', 'DEF 202', 'Chevrolet', 'Optra',    'sedan',   1100),
  ('c0c0c0c0-0000-4000-8000-000000000006', 'a1a1a1a1-0000-4000-8000-000000000003', 'GHI 301', 'Toyota',    'Hiace',    'van',     2600),
  ('c0c0c0c0-0000-4000-8000-000000000007', 'a1a1a1a1-0000-4000-8000-000000000003', 'GHI 302', 'Mercedes',  'C200',     'luxury',  4500)
ON CONFLICT (id) DO NOTHING;

-- Staff rows (users.app_users) are added by Ghada once the staff accounts exist in Cognito,
-- using one of the three office IDs above.
