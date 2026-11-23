// Catalogue service layer: talks to the database (owner: Jana)
// Only this file contains SQL. Every query uses $1, $2... placeholders (no SQL injection).
// Staff queries always include "office_id = <their office>", so staff can only
// touch their own office's cars (another office's car simply is not found -> 404).

const db = require("./db");

// ---------- public (anyone) ----------

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

// ---------- staff ----------

// Which office does this staff member belong to? (users.app_users is filled by the team)
// NOTE: check the column names with Ghada's db/users.sql (id = Cognito sub, office_id, role).
async function getStaffOfficeId(userId) {
  const rows = await db.query(
    `SELECT office_id FROM users.app_users WHERE cognito_sub = $1 AND role = 'staff'`,
    [userId]
  );
  return rows[0] ? rows[0].office_id : null;
}

// Write one line to the audit log: who did what, to which car, when
async function audit(actorId, action, targetId, details) {
  await db.query(
    `INSERT INTO catalogue.audit_log (actor_id, action, target_id, details)
     VALUES ($1, $2, $3, $4)`,
    [actorId, action, String(targetId), details ? JSON.stringify(details) : null]
  );
}

// C3: add a car to the staff member's OWN office (office comes from the login, never the body)
async function createCar(officeId, car, actorId) {
  const rows = await db.query(
    `INSERT INTO catalogue.cars (office_id, plate, make, model, category, daily_price)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, office_id, plate, make, model, category, daily_price, status`,
    [officeId, car.plate, car.make, car.model, car.category, car.dailyPrice]
  );
  await audit(actorId, "car.create", rows[0].id, car);
  return rows[0];
}

// C4: change category, daily price and/or status of one of the office's cars
async function updateCar(carId, officeId, changes, actorId) {
  const columns = { category: "category", dailyPrice: "daily_price", status: "status" };
  const sets = [];
  const params = [];

  for (const [field, column] of Object.entries(columns)) {
    if (changes[field] !== undefined) {
      params.push(changes[field]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  params.push(carId, officeId);

  const rows = await db.query(
    `UPDATE catalogue.cars
        SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $${params.length - 1} AND office_id = $${params.length} AND status <> 'retired'
      RETURNING id, office_id, plate, make, model, category, daily_price, status`,
    params
  );
  if (rows[0]) await audit(actorId, "car.update", carId, changes);
  return rows[0] || null;
}

// C5: retire a car (no hard delete, so old bookings keep pointing at a real car)
async function retireCar(carId, officeId, actorId) {
  const rows = await db.query(
    `UPDATE catalogue.cars
        SET status = 'retired', updated_at = now()
      WHERE id = $1 AND office_id = $2 AND status <> 'retired'
      RETURNING id`,
    [carId, officeId]
  );
  if (rows[0]) await audit(actorId, "car.retire", carId, null);
  return Boolean(rows[0]);
}

// C6: every car of the office, whatever its status
async function listOfficeCars(officeId) {
  return db.query(
    `SELECT id, plate, make, model, category, daily_price, status, updated_at
       FROM catalogue.cars
      WHERE office_id = $1
      ORDER BY status, make, model`,
    [officeId]
  );
}

// ---------- offices and map positions (C8, C9) ----------

// C8: offices that have map coordinates (the distance is worked out in the controller)
async function listOfficesWithCoords() {
  return db.query(
    `SELECT id, name, city, address, latitude, longitude, phone
       FROM catalogue.offices
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
  );
}

// One office (C9 needs the current address when only the city or only the address changes)
async function getOffice(officeId) {
  const rows = await db.query(
    `SELECT id, name, city, address, latitude, longitude, phone FROM catalogue.offices WHERE id = $1`,
    [officeId]
  );
  return rows[0] || null;
}

// C9: change name/address/city/phone of the staff member's OWN office.
// geo: undefined = address not changed (keep coordinates)
//      { lat, lon } = new coordinates from Nominatim
//      null = address changed but Nominatim failed (clear the old, now wrong, coordinates)
async function updateOffice(officeId, changes, geo, actorId) {
  const columns = { name: "name", address: "address", city: "city", phone: "phone" };
  const sets = [];
  const params = [];

  for (const [field, column] of Object.entries(columns)) {
    if (changes[field] !== undefined) {
      params.push(changes[field]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (geo !== undefined) {
    params.push(geo ? geo.lat : null);
    sets.push(`latitude = $${params.length}`);
    params.push(geo ? geo.lon : null);
    sets.push(`longitude = $${params.length}`);
    sets.push(geo ? "geocoded_at = now()" : "geocoded_at = NULL");
  }
  params.push(officeId);

  const rows = await db.query(
    `UPDATE catalogue.offices
        SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $${params.length}
      RETURNING id, name, city, address, latitude, longitude, phone`,
    params
  );
  if (rows[0]) await audit(actorId, "office.update", officeId, changes);
  return rows[0] || null;
}

// Setup script: offices that still have no coordinates (e.g. right after seed.sql)
async function listOfficesMissingCoords() {
  return db.query(
    `SELECT id, name, city, address FROM catalogue.offices WHERE latitude IS NULL OR longitude IS NULL`
  );
}

async function setOfficeCoords(officeId, lat, lon) {
  await db.query(
    `UPDATE catalogue.offices SET latitude = $1, longitude = $2, geocoded_at = now() WHERE id = $3`,
    [lat, lon, officeId]
  );
}

module.exports = {
  listOffices, getCar, searchCars,
  getStaffOfficeId, createCar, updateCar, retireCar, listOfficeCars,
  listOfficesWithCoords, getOffice, updateOffice, listOfficesMissingCoords, setOfficeCoords,
};
