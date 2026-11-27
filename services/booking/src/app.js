// Booking service: Express app that runs on AWS Lambda (owner: Eman)
// Locally:  npm start  (http://localhost:3000)
// On AWS:   Lambda calls the exported `handler`.

const express = require('express');
const serverless = require('serverless-http');
const bookingRoutes = require('./booking.routes');

const app = express();

// CORS: only our own website may call this API from a browser.
app.use((req, res, next) => {
  const allowed = process.env.FRONTEND_ORIGIN;
  if (allowed && req.headers.origin === allowed) {
    res.set('Access-Control-Allow-Origin', allowed);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end(); // browser's "may I?" check
  next();
});

// Reject large request bodies (part of our size limiting)
app.use(express.json({ limit: '100kb' }));

// Public route: lets us check that a deployment worked
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'booking' });
});

app.use('/bookings', bookingRoutes);
app.use('/internal', require('./internal.routes'));
// Anything not listed above
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Errors: clear answers for bad JSON, never send internal details to the user
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body must be valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Body is too large' });
  console.error(JSON.stringify({ level: 'error', method: req.method, path: req.path, message: err.message }));
  res.status(500).json({ error: 'Something went wrong' });
});

module.exports.app = app;

// Lambda entry point
module.exports.handler = serverless(app);

// Local run: `npm start` works like a normal Express server
if (require.main === module) {
  app.listen(3000, () => console.log('Booking service on http://localhost:3000'));
}