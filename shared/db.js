// shared/db.js
const { Pool } = require('pg');

let poolPromise; // lives as long as the Lambda container, so warm calls reuse it

async function getDatabaseUrl() {
  // Local (sam local / your PC): git-ignored .env
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // AWS: each service sets DATABASE_URL_PARAM to its own parameter name
  const name = process.env.DATABASE_URL_PARAM; // e.g. /car-rental/inspection/DATABASE_URL
  if (!name) throw new Error('Neither DATABASE_URL nor DATABASE_URL_PARAM is set');

  const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm'); // only loaded in AWS
  const ssm = new SSMClient({});
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  return out.Parameter.Value;
}

function getPool() {
  if (!poolPromise) {
    poolPromise = getDatabaseUrl()
      .then((url) => new Pool({
        connectionString: url,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
      }))
      .catch((err) => { poolPromise = undefined; throw err; });
  }
  return poolPromise;
}

// Always pass user input through params ($1, $2...), never string concatenation
async function query(text, params) {
  const pool = await getPool();
  return pool.query(text, params);
}

module.exports = { query, getPool };