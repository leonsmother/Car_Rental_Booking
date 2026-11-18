const service = require("./catalogue.service");

const CATEGORIES = ["economy", "compact", "sedan", "suv", "van", "luxury"];
const SEARCH_FIELDS = ["category", "office", "maxPrice"];

// Helper: a whole number greater than 0, or null if it is not one
function positiveInt(value) {
  return /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
}

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
    // Reject anything we do not recognise (from/to are allowed but not used yet)
    const unknown = Object.keys(req.query).filter((k) => !SEARCH_FIELDS.includes(k) && k !== "from" && k !== "to");
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

module.exports = { listOffices, getCar, searchCars };