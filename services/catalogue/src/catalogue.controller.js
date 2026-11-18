// Catalogue controller: checks the input, calls the service, sends the answer (owner: Jana)
// Bad input -> 400 before the database is touched. Not found / not yours -> 404.

const service = require("./catalogue.service");
const nominatim = require("./nominatim");

const CATEGORIES = ["economy", "compact", "sedan", "suv", "van", "luxury"];
const SEARCH_FIELDS = ["category", "office", "maxPrice", "from", "to"];
const CAR_FIELDS = ["plate", "make", "model", "category", "dailyPrice"];
const EDIT_FIELDS = ["category", "dailyPrice", "status"];
const EDIT_STATUSES = ["available", "maintenance"]; // "retired" only through DELETE (C5)
const NEAREST_FIELDS = ["location", "limit"];
const OFFICE_FIELDS = ["name", "address", "city", "phone"];

// ---------- small helpers ----------

// A whole number greater than 0, or null if it is not one
function positiveInt(value) {
  return /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
}

// A UUID like 3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90 (lower-cased), or null if it is not one
function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))
    ? String(value).toLowerCase()
    : null;
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
    const carId = uuid(req.params.carId);
    if (!carId) return res.status(400).json({ error: "carId must be a valid ID (UUID)" });

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
      officeId = uuid(office);
      if (!officeId) return res.status(400).json({ error: "office must be a valid office ID (UUID)" });
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
    const carId = uuid(req.params.carId);
    if (!carId) return res.status(400).json({ error: "carId must be a valid ID (UUID)" });

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
    const carId = uuid(req.params.carId);
    if (!carId) return res.status(400).json({ error: "carId must be a valid ID (UUID)" });

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
    const officeId = uuid(req.params.officeId);
    if (!officeId) return res.status(400).json({ error: "officeId must be a valid ID (UUID)" });

    // Another office -> 404, so nobody learns what other offices have
    if (officeId !== req.user.officeId) return res.status(404).json({ error: "Office not found" });

    res.json(await service.listOfficeCars(officeId));
  } catch (err) {
    next(err);
  }
}

// GET /offices/nearest?location=Nasr City&limit=5 (C8, anyone)
async function nearestOffices(req, res, next) {
  try {
    const unknown = unknownFields(req.query, NEAREST_FIELDS);
    if (unknown.length) return res.status(400).json({ error: `Unknown filter: ${unknown.join(", ")}` });

    const location = text(req.query.location, 2, 100);
    if (!location) return res.status(400).json({ error: "location is required (2-100 characters), e.g. ?location=Nasr City" });

    let limit = 5;
    if (req.query.limit !== undefined) {
      limit = positiveInt(req.query.limit);
      if (!limit || limit > 20) return res.status(400).json({ error: "limit must be a whole number from 1 to 20" });
    }

    // 1. Ask Nominatim where that place is
    let place;
    try {
      place = await nominatim.geocode(location);
    } catch (err) {
      console.error(JSON.stringify({ level: "warn", service: "nominatim", message: err.message }));
      return res.status(502).json({ error: "The map service is not available right now. You can still search cars by office." });
    }
    if (!place) return res.status(404).json({ error: "We could not find that location. Try a city or area name." });

    // 2. Work out each office's distance and sort, nearest first
    const offices = await service.listOfficesWithCoords();
    const nearest = offices
      .map((o) => ({
        ...o,
        distance_km: Math.round(nominatim.distanceKm(place, { lat: Number(o.latitude), lon: Number(o.longitude) }) * 10) / 10,
      }))
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, limit);

    res.json({ location: { query: location, label: place.label, lat: place.lat, lon: place.lon }, offices: nearest });
  } catch (err) {
    next(err);
  }
}

// PUT /offices/:officeId (C9, staff of THAT office) body: any of { name, address, city, phone }
async function updateOffice(req, res, next) {
  try {
    const officeId = uuid(req.params.officeId);
    if (!officeId) return res.status(400).json({ error: "officeId must be a valid ID (UUID)" });
    if (officeId !== req.user.officeId) return res.status(404).json({ error: "Office not found" });

    const body = req.body || {};
    const unknown = unknownFields(body, OFFICE_FIELDS);
    if (unknown.length) return res.status(400).json({ error: `You can only change: ${OFFICE_FIELDS.join(", ")}` });
    if (!Object.keys(body).length) return res.status(400).json({ error: "Send at least one field to change" });

    const changes = {};
    if (body.name !== undefined) {
      changes.name = text(body.name, 2, 100);
      if (!changes.name) return res.status(400).json({ error: "name must be 2-100 characters" });
    }
    if (body.address !== undefined) {
      changes.address = text(body.address, 5, 200);
      if (!changes.address) return res.status(400).json({ error: "address must be 5-200 characters" });
    }
    if (body.city !== undefined) {
      changes.city = text(body.city, 2, 60);
      if (!changes.city) return res.status(400).json({ error: "city must be 2-60 characters" });
    }
    if (body.phone !== undefined) {
      if (typeof body.phone !== "string" || !/^[+0-9 ()-]{6,20}$/.test(body.phone)) {
        return res.status(400).json({ error: "phone may only contain digits, spaces, + - ( ) and be 6-20 characters" });
      }
      changes.phone = body.phone;
    }

    // Address or city changed -> look up the new map position.
    // If Nominatim fails, we still save (as the proposal says) but clear the old, now wrong, position.
    let geo;
    let warning = null;
    if (changes.address || changes.city) {
      const current = await service.getOffice(officeId);
      if (!current) return res.status(404).json({ error: "Office not found" });
      try {
        geo = await nominatim.geocodeAddress(changes.address ?? current.address, changes.city ?? current.city);
        if (!geo) warning = "Saved, but the new address was not found on the map, so it will not appear in nearest-office results";
        else if (geo.approximate) warning = "Saved, but the exact address was not found, so the office is shown at the city centre";
        if (geo) geo = { lat: geo.lat, lon: geo.lon };
      } catch (err) {
        geo = null;
        warning = "Saved, but the map service is down, so the map position could not be updated";
      }
    }

    const updated = await service.updateOffice(officeId, changes, geo, req.user.id);
    if (!updated) return res.status(404).json({ error: "Office not found" });
    res.json(warning ? { ...updated, warning } : updated);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listOffices, getCar, searchCars, createCar, updateCar, retireCar, listOfficeCars,
  nearestOffices, updateOffice,
};
