// services/inspection/src/db.js
// One pg pool per Lambda container. Reads ONLY this service's database URL.
//   AWS:   DATABASE_URL_PARAM = SSM name (/car-rental/inspection/DATABASE_URL), read once at cold start
//   Local: DATABASE_URL in the git-ignored .env (a Neon development branch)

const { Pool } = require('pg');

let poolPromise;

async function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const name = process.env.DATABASE_URL_PARAM;
  if (!name) throw new Error('Neither DATABASE_URL nor DATABASE_URL_PARAM is set');
  const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
  const out = await new SSMClient({}).send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  return out.Parameter.Value;
}

function getPool() {
  if (!poolPromise) {
    poolPromise = getDatabaseUrl()
      .then((url) => {
        const pool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });
        pool.on('error', (e) => console.error(JSON.stringify({ level: 'error', msg: 'pool error', error: e.message })));
        return pool;
      })
      .catch((err) => { poolPromise = undefined; throw err; });
  }
  return poolPromise;
}

// Always pass user input through params ($1, $2...), never string concatenation
async function query(text, params) {
  return (await getPool()).query(text, params);
}

module.exports = { query, getPool };
