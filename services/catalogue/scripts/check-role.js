// Logs in AS catalogue_role and tries two things:
// 1) read the catalogue table  -> should be ALLOWED
// 2) read another team's table -> should be DENIED
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tests = [
  'SELECT count(*) FROM catalogue.offices',
  "SELECT office_id FROM users.app_users WHERE role = 'staff' LIMIT 1",
  'SELECT * FROM users.app_users LIMIT 1',
];

  for (const q of tests) {
    try {
      await client.query(q);
      console.log('ALLOWED:', q);
    } catch (e) {
      console.log('DENIED: ', q, '->', e.message);
    }
  }
  await client.end();
}

main();