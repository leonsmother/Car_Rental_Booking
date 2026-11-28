// services/catalogue/src/callers.js  (owner: Jana)
// Who is calling an internal route?
//
// API Gateway only lets IAM-signed requests reach /internal/*, but it accepts ANY identity
// in our AWS account. This file narrows it down: only Booking's role may ask for a quote (C10),
// only Inspection's role may put a car into maintenance (C11).
//
// The allowed callers come from the template (environment variables):
//   BOOKING_CALLER     e.g. "car-rental-booking-"     (start of Booking's Lambda role name)
//   INSPECTION_CALLER  e.g. "car-rental-inspection-"  (start of Inspection's Lambda role name)
// A value of "*" switches the check off (only for emulators that do not pass the caller's identity).

// The caller's IAM identity, as API Gateway verified it (HTTP API, payload format 2.0)
function callerArn(req) {
  const event = req.lambdaEvent;
  const iam = event && event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.iam;
  return (iam && iam.userArn) || null;
}

// "arn:aws:sts::123456789012:assumed-role/car-rental-inspection-InspectionFunctionRole-AB12/session"
//   -> "car-rental-inspection-InspectionFunctionRole-AB12"
function roleName(arn) {
  const match = /:assumed-role\/([^/]+)\//.exec(arn || "");
  return match ? match[1] : null;
}

// Returns { ok: true, actor } when the caller may use this route, otherwise { ok: false }.
// actor is what we write in the audit log, e.g. "role:car-rental-inspection-InspectionFunctionRole-AB12".
function checkCaller(req, envName) {
  const allowed = process.env[envName];

  // Local development (npm start): no API Gateway in front, so there is no caller identity
  if (!req.lambdaEvent && process.env.LOCAL_AUTH === "true") return { ok: true, actor: "local:dev" };

  if (allowed === "*") return { ok: true, actor: roleName(callerArn(req)) ? "role:" + roleName(callerArn(req)) : "service:unverified" };

  const role = roleName(callerArn(req));
  if (!allowed || !role || !role.startsWith(allowed)) return { ok: false };
  return { ok: true, actor: "role:" + role };
}

module.exports = { checkCaller, roleName };
