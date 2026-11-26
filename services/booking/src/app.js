const express = require('express');
const serverless = require('serverless-http');

const app = express();
app.use(express.json());

// Public route: lets us check that a deployment worked
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'booking' });
});

// Booking routes (B1-B9) will be added here later

// Lambda entry point
module.exports.handler = serverless(app);

// Local run: `npm start` works like a normal Express server
if (require.main === module) {
  app.listen(3000, () => console.log('Booking service on http://localhost:3000'));
}