// shared/auth.js
const db = require('./db');

function parseGroups(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
}

function getClaims(req) {
  // Set by the API Gateway JWT authorizer; serverless-http exposes the event here
  const claims = req.apiGateway?.event?.requestContext?.authorizer?.jwt?.claims;
  if (claims) return claims;

  // sam local does not run authorizers. Only works when ALLOW_LOCAL_AUTH=true,
  // which must NEVER be set in template.yaml (local .env only).
  if (process.env.ALLOW_LOCAL_AUTH === 'true' && req.headers['x-local-user']) {
    return {
      sub: req.headers['x-local-user'],
      'cognito:groups': req.headers['x-local-groups'] || 'customer',
    };
  }
  return null;
}

async function authenticate(req, res, next) {
  try {
    const claims = getClaims(req);
    if (!claims || !claims.sub) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = {
      id: claims.sub,
      groups: parseGroups(claims['cognito:groups']),
      officeId: null,
    };

    // Staff are tied to one office; the id comes from our table, never from the request
        if (req.user.groups.includes('staff')) {
      const r = await db.query(
        'SELECT office_id FROM users.app_users WHERE cognito_sub = $1',
        [req.user.id]
      );
      req.user.officeId = r.rows[0]?.office_id ?? null;
    }
    next();
  } catch (err) {
    console.error(JSON.stringify({ msg: 'auth failed', error: err.message }));
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { authenticate, parseGroups };