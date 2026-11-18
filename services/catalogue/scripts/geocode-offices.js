// One-time setup: give every office that has no map position its coordinates (owner: Jana)
// Run AFTER seed.sql:   npm run geocode-offices
// It asks Nominatim about each office, one per second (their rule), and saves the result.

const service = require("../src/catalogue.service");
const nominatim = require("../src/nominatim");
const { pool } = require("../src/db");

(async () => {
  const offices = await service.listOfficesMissingCoords();
  console.log(`${offices.length} office(s) without a map position`);

  for (const office of offices) {
    try {
      const geo = await nominatim.geocode(`${office.address}, ${office.city}`);
      if (geo) {
        await service.setOfficeCoords(office.id, geo.lat, geo.lon);
        console.log(`OK    ${office.name}: ${geo.lat}, ${geo.lon}`);
      } else {
        console.log(`MISS  ${office.name}: address not found, edit it with C9`);
      }
    } catch (err) {
      console.log(`ERROR ${office.name}: ${err.message}`);
    }
  }
  await pool.end();
})();
