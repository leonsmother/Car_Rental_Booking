
const express = require("express");
const serverless = require("serverless-http");

const app = express();


app.use(express.json({ limit: "100kb" }));


app.get("/health", (req, res) => {
  res.json({ service: "catalogue", status: "ok" });
});


app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

module.exports.app = app;
module.exports.handler = serverless(app);
