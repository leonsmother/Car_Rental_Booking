// Catalogue service: Express app that runs on AWS Lambda (owner: Jana)
// Same routes -> controller -> service structure as the labs.
// Locally:  npm start  (runs src/local.js on http://localhost:3001)
// On AWS:   Lambda calls the exported `handler`.

const express = require("express");
const serverless = require("serverless-http");
const catalogueRoutes = require("./catalogue.routes");

const app = express();

// Reject large request bodies (part of our rate/size limiting)
app.use(express.json({ limit: "100kb" }));

// GET /health: just says the service is alive. Used to check a deploy worked.
app.get("/health", (req, res) => {
  res.json({ service: "catalogue", status: "ok" });
});

// C1-C7 (all routes live in catalogue.routes.js)
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
// so auth.js can read the login details (claims) the JWT authorizer checked.
module.exports.handler = serverless(app, {
  request(req, event) {
    req.lambdaEvent = event;
  },
});
