// shared/test-perm.js  - checks inspection_role can do what it should and nothing more
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('./db');

const tests = [
  ['allow', 'SELECT 1 FROM inspection.condition_reports LIMIT 1'],
  ['deny',  "UPDATE inspection.condition_reports SET notes = 'changed'"],
  ['deny',  'DELETE FROM inspection.condition_reports'],
  ['deny',  'SELECT 1 FROM booking.bookings LIMIT 1'],
  ['deny',  "UPDATE users.app_users SET role = 'staff'"],
];

(async () => {
  const pool = await db.getPool();
  const who = await pool.query('select current_user');
  console.log('connected as:', who.rows[0].current_user, '\n');
  if (who.rows[0].current_user !== 'inspection_role') {
    console.log('Wrong role in DATABASE_URL, stopping.');
    process.exit(1);
  }

  let failed = 0;
  for (const [expect, sql] of tests) {
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      await client.query(sql);
      result = 'allowed';
    } catch (e) {
      result = 'denied (' + e.message + ')';
    } finally {
      await client.query('ROLLBACK').catch(() => {}); // nothing is ever saved
      client.release();
    }
    const ok = (expect === 'allow') === result.startsWith('allowed');
    if (!ok) failed++;
    console.log(ok ? 'PASS' : 'FAIL', '|', expect.padEnd(5), '|', sql, '\n      ->', result);
  }
  console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll tests passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });