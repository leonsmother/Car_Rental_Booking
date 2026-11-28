// Catalogue service: Express app that runs on AWS Lambda (owner: Jana)
// Same routes -> controller -> service structure as the labs.
// Locally:  npm start  (runs src/local.js on http://localhost:3001)
// On AWS:   Lambda calls the exported `handler`.

const express = require("express");
const serverless = require("serverless-http");
const catalogueRoutes = require("./catalogue.routes");

const app = express();

// Don't announce which framework we use (removes the "X-Powered-By: Express" header)
app.disable("x-powered-by");

// CORS: only our own website may call this API from a browser.
// (Real AWS also does this in API Gateway; Floci does not, so the app does it too.)
app.use((req, res, next) => {
  const allowed = process.env.FRONTEND_ORIGIN;
  if (allowed && req.headers.origin === allowed) {
    res.set("Access-Control-Allow-Origin", allowed);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id");
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.set("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.status(204).end();   // browser's "may I?" check
  next();
});

// Safety headers on every answer:
//   nosniff      -> browsers must treat our JSON as JSON, never guess it is a script or page
//   no-store     -> browsers and proxies must not keep copies (staff data, quotes)
//   no-referrer  -> don't leak our URLs to other sites
//   HSTS         -> browsers only ever talk to this API over HTTPS (ignored on plain-HTTP Floci)
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// Reject large request bodies (part of our rate/size limiting)
app.use(express.json({ limit: "100kb" }));

// GET /health: just says the service is alive. Used to check a deploy worked.
app.get("/health", (req, res) => {
  res.json({ service: "catalogue", status: "ok" });
});

// C1-C11 (all routes live in catalogue.routes.js)
app.use(catalogueRoutes);

// Anything not listed above
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Errors: clear answers for bad JSON, and never send database details to the user
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Body must be valid JSON" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Body is too large" });
  console.error(JSON.stringify({ level: "error", method: req.method, path: req.path, message: err.message }));
  res.status(500).json({ error: "Something went wrong" });
});

module.exports.app = app;

// On Lambda: keep the original API Gateway event on the request,
// so auth.js can read the login details (claims) the JWT authorizer checked,
// and callers.js can read which AWS role signed an internal request.
module.exports.handler = serverless(app, {
  request(req, event) {
    req.lambdaEvent = event;
  },
});
