// Database connection for the Catalogue service (owner: Jana)
// Locally:   DATABASE_URL comes from .env (Neon dev branch).
// In the cloud: there is no .env. The template gives DATABASE_URL_PARAM (the SSM name),
//               and we read the connection string from SSM once, when the Lambda starts.
//               The password is never in the code, the template or the Lambda settings.
const { Pool } = require("pg");

let poolPromise = null;

async function getConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;   // local

  const name = process.env.DATABASE_URL_PARAM;                       // cloud
  if (!name) throw new Error("Set DATABASE_URL (local) or DATABASE_URL_PARAM (cloud)");

  // The AWS SDK is built into the Lambda Node.js runtime, so it is only loaded in the cloud
  const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
  const out = await new SSMClient({}).send(
    new GetParameterCommand({ Name: name, WithDecryption: true })
  );
  return out.Parameter.Value;
}

function getPool() {
  if (!poolPromise) {
    poolPromise = getConnectionString()
      .then((connectionString) => new Pool({
        connectionString,
        max: 3,                       // small: Neon free tier + Lambda
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000,
      }))
      .catch((err) => {
        poolPromise = null;           // try again on the next request instead of staying broken
        throw err;
      });
  }
  return poolPromise;
}

async function query(text, params) {
  const pool = await getPool();
  const result = await pool.query(text, params);
  return result.rows;
}

// Close the connections (for scripts and tests that need to exit cleanly)
async function end() {
  if (!poolPromise) return;
  const pool = await poolPromise;
  poolPromise = null;
  await pool.end();
}

module.exports = { query, getPool, end };
