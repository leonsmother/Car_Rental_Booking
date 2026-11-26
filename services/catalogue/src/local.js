// Runs the Catalogue service on your laptop without AWS: npm start
const { app } = require("./app");

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Catalogue running on http://localhost:${PORT}  (try /health)`);
});