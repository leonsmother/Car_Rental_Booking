const db = require("./db");

// C7: all offices with their map position
async function listOffices() {
  return db.query(
    `SELECT id, name, city, address, latitude, longitude, phone
       FROM catalogue.offices
      ORDER BY city, name`
  );
}

// C2: one car (retired cars are hidden from customers)
async function getCar(carId) {
  const rows = await db.query(
    `SELECT c.id, c.office_id, o.name AS office_name, o.city,
            c.make, c.model, c.category, c.daily_price, c.status
       FROM catalogue.cars c
       JOIN catalogue.offices o ON o.id = c.office_id
      WHERE c.id = $1 AND c.status <> 'retired'`,
    [carId]
  );
  return rows[0] || null;
}

// C1 (without dates for now): search available cars by category, office and max price.
// Filters are optional; only the ones given are added, each as a placeholder.
async function searchCars({ category, officeId, maxPrice }) {
  const conditions = ["c.status = 'available'"];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`c.category = $${params.length}`);
  }
  if (officeId) {
    params.push(officeId);
    conditions.push(`c.office_id = $${params.length}`);
  }
  if (maxPrice) {
    params.push(maxPrice);
    conditions.push(`c.daily_price <= $${params.length}`);
  }

  return db.query(
    `SELECT c.id, c.office_id, o.name AS office_name, o.city,
            c.make, c.model, c.category, c.daily_price
       FROM catalogue.cars c
       JOIN catalogue.offices o ON o.id = c.office_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY c.daily_price`,
    params
  );
}

module.exports = { listOffices, getCar, searchCars };
