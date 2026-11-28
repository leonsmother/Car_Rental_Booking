const express = require('express');
const controller = require('./booking.controller');

const router = express.Router();

// Only IAM-signed callers (API Gateway puts their identity here). Not a Cognito login.
function requireIamCaller(req, res, next) {
  const iam = req.apiGateway?.event?.requestContext?.authorizer?.iam;
  if (iam) return next();
  // Local only: sam local / node do not sign requests. Never set in template.yaml.
  if (process.env.ALLOW_LOCAL_AUTH === 'true' && req.headers['x-local-caller']) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

router.get('/bookings/:id', requireIamCaller, controller.internalGet);
router.post('/bookings/:id/complete', requireIamCaller, controller.internalComplete);

module.exports = router;