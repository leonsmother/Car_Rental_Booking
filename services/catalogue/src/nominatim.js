// OpenStreetMap Nominatim client: turns an address into map coordinates (owner: Jana)
//
// Nominatim's usage policy (we follow all of it):
//   - at most 1 request per second       -> waitForTurn() spaces requests 1.1 s apart
//   - send an identifying User-Agent     -> USER_AGENT below
//   - cache results, don't ask twice     -> office coordinates are saved in the database;
//                                           customer searches are kept in a small memory cache
//   - credit OpenStreetMap on the map    -> done on the frontend map page
// If Nominatim is slow or down, geocode() throws, and the controller answers 502
// (search by category/price/office still works without it).

const BASE_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || "car-rental-group24/1.0 (university cloud project)";
const COUNTRY = process.env.NOMINATIM_COUNTRY || "eg"; // our offices are in Egypt
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 5000;
const CACHE_MAX = 100;

const cache = new Map();
let nextSlot = 0;

// Wait until at least 1.1 s have passed since the previous request
async function waitForTurn() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
}

// "Nasr City, Cairo" -> { lat, lon, label } or null if Nominatim found nothing
async function geocode(query) {
  const key = query.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);

  await waitForTurn();
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", countrycodes: COUNTRY });
  const res = await fetch(`${BASE_URL}?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);

  const results = await res.json();
  const place = results[0]
    ? { lat: Number(results[0].lat), lon: Number(results[0].lon), label: results[0].display_name }
    : null;

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // forget the oldest
  cache.set(key, place);
  return place;
}

// Find an office address. Nominatim is strict about extra words, so we try up to 3 versions:
//   1. address + city (city not repeated if the address already contains it)
//   2. the address on its own
//   3. just the city -> approximate (the office is placed at the city centre)
// Returns { lat, lon, label, approximate } or null if nothing was found.
async function geocodeAddress(address, city) {
  const hasCity = address.toLowerCase().includes(city.toLowerCase());
  const candidates = [...new Set([hasCity ? address : `${address}, ${city}`, address, city])];

  for (const query of candidates) {
    const place = await geocode(query);
    if (place) return { ...place, approximate: query === city };
  }
  return null;
}

// Straight-line distance between two points on Earth, in km (haversine formula)
function distanceKm(a, b) {
  const R = 6371;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { geocode, geocodeAddress, distanceKm };