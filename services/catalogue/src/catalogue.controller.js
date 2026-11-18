// Catalogue controller: checks the input, calls the service, sends the answer (owner: Jana)
// Bad input -> 400 before the database is touched. Not found / not yours -> 404.

const service = require("./catalogue.service");

const CATEGORIES = ["economy", "compact", "sedan", "suv", "van", "luxury"];
const SEARCH_FIELDS = ["category", "office", "maxPrice", "from", "to"];
const CAR_FIELDS = ["plate", "make", "model", "category", "dailyPrice"];
const EDIT_FIELDS = ["category", "dailyPrice", "status"];
const EDIT_STATUSES = ["available", "maintenance"]; // "retired" only through DELETE (C5)

// ---------- small helpers ----------

// A whole number greater than 0, or null if it is not one
function positiveInt(value) {
  return /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
}

// A price > 0, at most 100000, at most 2 decimals; or null
function validPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100000) return null;
  const cents = value * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6 ? value : null;
}

// A trimmed piece of text between min and max characters; or null
function text(value, min, max) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length >= min && t.length <= max ? t : null;
}

// Names of fields the user sent that we do not accept
function unknownFields(body, allowed) {
  return Object.keys(body || {}).filter((k) => !allowed.includes(k));
}

// ---------- public routes ----------

// GET /offices (C7)
async function listOffices(req, res, next) {
  try {
    res.json(await service.listOffices());
  } catch (err) {
    next(err);
  }
}

// GET /cars/:carId (C2)
async function getCar(req, res, next) {
  try {
    const carId = positiveInt(req.params.carId);
    if (!carId) return res.status(400).json({ error: "carId must be a positive whole number" });

    const car = await service.getCar(carId);
    if (!car) return res.status(404).json({ error: "Car not found" });

    res.json(car);
  } catch (err) {
    next(err);
  }
}

// GET /cars?category=&office=&maxPrice= (C1, dates come later)
async function searchCars(req, res, next) {
  try {
    const unknown = unknownFields(req.query, SEARCH_FIELDS);
    if (unknown.length) return res.status(400).json({ error: `Unknown filter: ${unknown.join(", ")}` });

    const { category, office, maxPrice } = req.query;

    if (category && !CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(", ")}` });
    }

    let officeId = null;
    if (office) {
      officeId = positiveInt(office);
      if (!officeId) return res.status(400).json({ error: "office must be a positive whole number" });
    }

    let price = null;
    if (maxPrice) {
      price = Number(maxPrice);
      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ error: "maxPrice must be a number greater than 0" });
      }
    }

    res.json(await service.searchCars({ category, officeId, maxPrice: price }));
  } catch (err) {
    next(err);
  }
}

// ---------- staff routes (requireLogin + requireStaff run first, so req.user is set) ----------

// POST /cars (C3) body: { plate, make, model, category, dailyPrice }
async function createCar(req, res, next) {
  try {
    const body = req.body || {};
    const unknown = unknownFields(body, CAR_FIELDS);
    if (unknown.length) return res.status(400).json({ error: `Unknown field: ${unknown.join(", ")}` });

    const car = {
      plate: text(body.plate, 2, 15),
      make: text(body.make, 1, 40),
      model: text(body.model, 1, 40),
      category: CATEGORIES.includes(body.category) ? body.category : null,
      dailyPrice: validPrice(body.dailyPrice),
    };
    const missing = Object.keys(car).filter((k) => car[k] === null);
    if (missing.length) {
      return res.status(400).json({
        error: `Invalid or missing: ${missing.join(", ")}`,
        rules: "plate 2-15 chars, make/model 1-40 chars, category one of the list, dailyPrice a number > 0 with at most 2 decimals",
      });
    }
    if (!/^[A-Za-z0-9؀-ۿ -]+$/.test(car.plate)) {
      return res.status(400).json({ error: "plate may only contain letters, numbers, spaces and dashes" });
    }

    // The office is ALWAYS the staff member's own office, never taken from the body
    const created = await service.createCar(req.user.officeId, car, req.user.id);
    res.status(201).json(created);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "A car with this plate already exists" });
    next(err);
  }
}

// PUT /cars/:carId (C4) body: any of { category, dailyPrice, status }
async function updateCar(req, res, next) {
  try {
    const carId = positiveInt(req.params.carId);
    if (!carId) return res.status(400).json({ error: "carId must be a positive whole number" });

    const body = req.body || {};
    const unknown = unknownFields(body, EDIT_FIELDS);
    if (unknown.length) return res.status(400).json({ error: `You can only change: ${EDIT_FIELDS.join(", ")}` });
    if (!Object.keys(body).length) return res.status(400).json({ error: "Send at least one field to change" });

    const changes = {};
    if (body.category !== undefined) {
      if (!CATEGORIES.includes(body.category)) return res.status(400).json({ error: "Invalid category" });
      changes.category = body.category;
    }
    if (body.dailyPrice !== undefined) {
      if (validPrice(body.dailyPrice) === null) return res.status(400).json({ error: "Invalid dailyPrice" });
      changes.dailyPrice = body.dailyPrice;
    }
    if (body.status !== undefined) {
      if (!EDIT_STATUSES.includes(body.status)) {
        return res.status(400).json({ error: "status must be available or maintenance (use DELETE to retire)" });
      }
      changes.status = body.status;
    }

    const updated = await service.updateCar(carId, req.user.officeId, changes, req.user.id);
    if (!updated) return res.status(404).json({ error: "Car not found in your office" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// DELETE /cars/:carId (C5): retire, not a real delete
async function retireCar(req, res, next) {
  try {
    const carId = positiveInt(req.params.carId);
    if (!carId) return res.status(400).json({ error: "carId must be a positive whole number" });

    const done = await service.retireCar(carId, req.user.officeId, req.user.id);
    if (!done) return res.status(404).json({ error: "Car not found in your office" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// GET /offices/:officeId/cars (C6): staff can only list THEIR office
async function listOfficeCars(req, res, next) {
  try {
    const officeId = positiveInt(req.params.officeId);
    if (!officeId) return res.status(400).json({ error: "officeId must be a positive whole number" });

    // Another office -> 404, so nobody learns what other offices have
    if (officeId !== req.user.officeId) return res.status(404).json({ error: "Office not found" });

    res.json(await service.listOfficeCars(officeId));
  } catch (err) {
    next(err);
  }
}

module.exports = { listOffices, getCar, searchCars, createCar, updateCar, retireCar, listOfficeCars };
