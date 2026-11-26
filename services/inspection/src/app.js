// services/inspection/src/app.js
// Inspection service: Express app that runs on AWS Lambda (owner: Ghada).
// routes -> controller -> service, same layers as the labs.
// On AWS Lambda calls the exported `handler`. Locally: node src/app.js (http://localhost:3003)

const express = require('express');
const serverless = require('serverless-http');
const inspectionRoutes = require('./inspection.routes');

const app = express();
app.use(express.json({ limit: '50kb' }));       // photos are never sent through us, so bodies stay small

// Public: lets us check a deploy worked
app.get('/health', (req, res) => res.json({ service: 'inspection', status: 'ok' }));

app.use('/inspections', inspectionRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body must be valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Body is too large' });
  console.error(JSON.stringify({ level: 'error', method: req.method, path: req.path, message: err.message }));
  res.status(500).json({ error: 'Something went wrong on our side' });
});

module.exports.app = app;
module.exports.handler = serverless(app);

if (require.main === module) {
  app.listen(3003, () => console.log('Inspection service on http://localhost:3003'));
}
