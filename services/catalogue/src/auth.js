// Login and role checks for the Catalogue service (owner: Jana)
// (When Ghada's shared/auth.js is ready, this can move there.)
//
// HOW IT WORKS ON AWS
//   API Gateway's JWT authorizer checks the Cognito token BEFORE our code runs
//   (bad or missing token -> 401 at the gateway). It then passes the token's
//   claims to Lambda. We read: sub (the user's id) and cognito:groups (customer/staff).
//
// HOW IT WORKS ON YOUR LAPTOP
//   There is no API Gateway locally, so for testing you can pretend to be a user
//   with the header  x-dev-user: staff:1  (staff of office 1)  or  x-dev-user: customer
//   This ONLY works when LOCAL_AUTH=true AND the code is NOT running in Lambda,
//   so it can never be used to fake a login in the cloud.

const service = require("./catalogue.service");

const IN_LAMBDA = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

// API Gateway sends groups as a string like "[staff]" or "[customer staff]"
function parseGroups(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value).replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
}

// Who is calling? Returns { id, groups, officeId } or null if nobody is logged in
function readUser(req) {
  const claims = req.lambdaEvent?.requestContext?.authorizer?.jwt?.claims;
  if (claims && claims.sub) {
    return { id: claims.sub, groups: parseGroups(claims["cognito:groups"]), officeId: null };
  }

  if (!IN_LAMBDA && process.env.LOCAL_AUTH === "true") {
    const dev = req.get("x-dev-user"); // "staff:1" or "customer"
    if (dev) {
      const [role, office] = dev.split(":");
      return {
        id: `dev-${role}${office ? "-" + office : ""}`,
        groups: [role],
        officeId: office ? Number(office) : null,
      };
    }
  }
  return null;
}

// Must be logged in, otherwise 401
function requireLogin(req, res, next) {
  const user = readUser(req);
  if (!user) return res.status(401).json({ error: "Please log in" });
  req.user = user;
  next();
}

// Must be staff (otherwise 403), and we find out which office they belong to
async function requireStaff(req, res, next) {
  try {
    if (!req.user.groups.includes("staff")) {
      return res.status(403).json({ error: "Only rental office staff can do this" });
    }
    if (!req.user.officeId) {
      req.user.officeId = await service.getStaffOfficeId(req.user.id);
    }
    if (!req.user.officeId) {
      return res.status(403).json({ error: "Your staff account is not linked to an office" });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireLogin, requireStaff, parseGroups };
