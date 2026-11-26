/ services/inspection/src/auth.js
// Who is calling? Sets req.user = { id, role, officeId }.
//
// ON AWS: API Gateway's JWT authorizer already checked the Cognito token (bad or missing -> 401
// at the gateway, our code never runs). We only read the verified claims it passes on.
// LOCALLY: set ALLOW_LOCAL_AUTH=true in your git-ignored .env and send the headers
//   x-local-user: <uuid>      x-local-groups: staff      (or customer)
// This is ignored inside Lambda, so it can never fake a login in the cloud.

const { query } = require('./db');

const IN_LAMBDA = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

function parseGroups(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
}

function getClaims(req) {
  const claims = req.apiGateway && req.apiGateway.event &&
    req.apiGateway.event.requestContext && req.apiGateway.event.requestContext.authorizer &&
    req.apiGateway.event.requestContext.authorizer.jwt && req.apiGateway.event.requestContext.authorizer.jwt.claims;
  if (claims) return claims;

  if (!IN_LAMBDA && process.env.ALLOW_LOCAL_AUTH === 'true' && req.headers['x-local-user']) {
    return { sub: req.headers['x-local-user'], 'cognito:groups': req.headers['x-local-groups'] || 'customer' };
  }
  return null;
}

async function authenticate(req, res, next) {
  try {
    const claims = getClaims(req);
    if (!claims || !claims.sub) return res.status(401).json({ error: 'Unauthorized' });

    const groups = parseGroups(claims['cognito:groups']);
    const role = groups.includes('staff') ? 'staff' : groups.includes('customer') ? 'customer' : null;
    if (!role) return res.status(403).json({ error: 'No role assigned' });

    let officeId = null;
    if (role === 'staff') {
      // The office comes from OUR table, never from the token or the request
      const { rows } = await query('SELECT office_id FROM users.app_users WHERE cognito_sub = $1', [claims.sub]);
      officeId = rows[0] ? rows[0].office_id : null;
      if (!officeId) return res.status(403).json({ error: 'Your staff account is not linked to an office' });
    }

    req.user = { id: claims.sub, role, officeId };
    next();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'auth failed', error: err.message }));
    res.status(500).json({ error: 'Something went wrong on our side' });
  }
}

module.exports = { authenticate, parseGroups };
