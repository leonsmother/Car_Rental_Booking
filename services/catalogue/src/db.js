const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,                       // small: Neon free tier + Lambda
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});


async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

module.exports = { query, pool };
