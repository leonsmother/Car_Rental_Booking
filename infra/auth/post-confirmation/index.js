// infra/auth/post-confirmation/index.js
// Cognito calls this right after a user confirms their email.
// It does two things, both safe to repeat:
//   1. puts the user in the "customer" group
//   2. inserts a row in users.app_users (id = Cognito sub, role defaults to customer)
// Staff are NEVER created here. An admin adds them to the "staff" group and sets office_id by hand.
// The database role used (auth_trigger_role) can only INSERT into users.app_users.

let pool = null;

async function getPool() {
  if (pool) return pool;
  let url = process.env.DATABASE_URL;                       // local testing only
  if (!url) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const out = await new SSMClient({}).send(
      new GetParameterCommand({ Name: process.env.DATABASE_URL_PARAM, WithDecryption: true })
    );
    url = out.Parameter.Value;
  }
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  return pool;
}

async function defaultAddToGroup(userPoolId, username) {
  const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } =
    require('@aws-sdk/client-cognito-identity-provider');
  await new CognitoIdentityProviderClient({}).send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: 'customer' })
  );
}

async function defaultInsertUser(id, email) {
  const p = await getPool();
  await p.query(
    'INSERT INTO users.app_users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [id, email]
  );
}

// Dependencies can be swapped so the logic is testable without AWS or a database.
function createHandler({ addToGroup = defaultAddToGroup, insertUser = defaultInsertUser } = {}) {
  return async function handler(event) {
    // Only for a brand-new signup, not for "forgot password" confirmations
    if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;

    const sub = event.request.userAttributes.sub;
    const email = event.request.userAttributes.email;
    if (!sub || !email) throw new Error('Missing sub or email');

    try {
      await insertUser(sub, email);
      await addToGroup(event.userPoolId, event.userName);
      console.log(JSON.stringify({ level: 'info', msg: 'new customer created', userId: sub }));
    } catch (err) {
      // Log without personal data, then fail loudly so the problem shows up in CloudWatch.
      console.error(JSON.stringify({ level: 'error', msg: 'post-confirmation failed', userId: sub, error: err.message }));
      throw err;
    }
    return event; // Cognito requires the event to be returned
  };
}

module.exports = { handler: createHandler(), createHandler };