// One-time setup: give every office that has no map position its coordinates (owner: Jana)
// Run AFTER seed.sql:   npm run geocode-offices
// It asks Nominatim about each office (one request per second, their rule) and saves the result.
//   OK     = exact address found
//   APPROX = address not found, office placed at its city centre (fix the address later with C9)
//   MISS   = nothing found at all

const service = require("../src/catalogue.service");
const nominatim = require("../src/nominatim");
const { pool } = require("../src/db");

(async () => {
  const offices = await service.listOfficesMissingCoords();
  console.log(`${offices.length} office(s) without a map position`);

  for (const office of offices) {
    try {
      const geo = await nominatim.geocodeAddress(office.address, office.city);
      if (geo) {
        await service.setOfficeCoords(office.id, geo.lat, geo.lon);
        console.log(`${geo.approximate ? "APPROX" : "OK    "} ${office.name}: ${geo.lat}, ${geo.lon}  (${geo.label})`);
      } else {
        console.log(`MISS   ${office.name}: nothing found for "${office.address}" or "${office.city}"`);
      }
    } catch (err) {
      console.log(`ERROR  ${office.name}: ${err.message}`);
    }
  }
  await pool.end();
})();
