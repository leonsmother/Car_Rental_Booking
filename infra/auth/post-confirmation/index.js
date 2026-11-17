const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { Pool } = require("pg");

const cognito = new CognitoIdentityProviderClient({});
let pool;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }
  return pool;
}

exports.handler = async (event) => {
   
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
    return event;
  }

  const { userPoolId, userName } = event;
  const { sub, email, name } = event.request.userAttributes || {};

  try {
     
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: userName,
        GroupName: "customer",
      })
    );
    console.log(JSON.stringify({ msg: "Added user to customer group", sub }));

     
    const db = getPool();
    if (db) {
      await db.query(
        `INSERT INTO users.app_users (cognito_sub, email, full_name, role)
         VALUES ($1, $2, $3, 'customer')
         ON CONFLICT (cognito_sub) DO NOTHING`,
        [sub, email, name || email]
      );
      console.log(JSON.stringify({ msg: "Synced user to users.app_users", sub }));
    }
  } catch (err) {
     
    console.error(JSON.stringify({ msg: "PostConfirmation error", sub, error: err.message }));
  }

  return event;
};