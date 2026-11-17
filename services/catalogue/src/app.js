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

// C1, C2, C7 (more routes are added in catalogue.routes.js)
app.use(catalogueRoutes);

// Anything not listed above
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Any unexpected error: log it, but never send database details to the user
app.use((err, req, res, next) => {
  console.error(JSON.stringify({ level: "error", path: req.path, message: err.message }));
  res.status(500).json({ error: "Something went wrong" });
});

module.exports.app = app;
module.exports.handler = serverless(app);