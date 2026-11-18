// Tests for C8 (nearest offices) and C9 (edit office).
// No database and no internet needed: Nominatim is replaced by a fake for these tests.
process.env.LOCAL_AUTH = "true";

const test = require("node:test");
const assert = require("node:assert");
const nominatim = require("../src/nominatim");
const { app } = require("../src/app");

// The fixed IDs from db/seed.sql
const OFFICE_A = "a1a1a1a1-0000-4000-8000-000000000001";
const OFFICE_B = "a1a1a1a1-0000-4000-8000-000000000002";
const STAFF_A = `staff:${OFFICE_A}`;

async function call(method, path, { user, body } = {}) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const headers = { "Content-Type": "application/json" };
    if (user) headers["x-dev-user"] = user;
    const res = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status };
  } finally {
    server.close();
  }
}

// ----- the distance formula -----
test("distance Cairo -> Alexandria is about 180 km", () => {
  const cairo = { lat: 30.0444, lon: 31.2357 };
  const alex = { lat: 31.2001, lon: 29.9187 };
  const km = nominatim.distanceKm(cairo, alex);
  assert.ok(km > 170 && km < 190, `got ${km}`);
});

// ----- C8 input checks (anyone, no login) -----
test("C8 without a location -> 400", async () => {
  assert.strictEqual((await call("GET", "/offices/nearest")).status, 400);
});

test("C8 location of 1 character -> 400", async () => {
  assert.strictEqual((await call("GET", "/offices/nearest?location=a")).status, 400);
});

test("C8 limit above 20 -> 400", async () => {
  assert.strictEqual((await call("GET", "/offices/nearest?location=Cairo&limit=50")).status, 400);
});

test("C8 unknown filter -> 400", async () => {
  assert.strictEqual((await call("GET", "/offices/nearest?location=Cairo&radius=5")).status, 400);
});

// ----- C8 when Nominatim can't help -----
test("C8 place Nominatim does not know -> 404", async () => {
  const real = nominatim.geocode;
  nominatim.geocode = async () => null;
  try {
    assert.strictEqual((await call("GET", "/offices/nearest?location=Nowhereville")).status, 404);
  } finally {
    nominatim.geocode = real;
  }
});

test("C8 when Nominatim is down -> 502 (not a crash)", async () => {
  const real = nominatim.geocode;
  nominatim.geocode = async () => { throw new Error("timeout"); };
  try {
    assert.strictEqual((await call("GET", "/offices/nearest?location=Cairo")).status, 502);
  } finally {
    nominatim.geocode = real;
  }
});

// ----- C9 security and input checks -----
test("C9 not logged in -> 401", async () => {
  assert.strictEqual((await call("PUT", `/offices/${OFFICE_A}`, { body: { name: "New name" } })).status, 401);
});

test("C9 customer -> 403", async () => {
  assert.strictEqual((await call("PUT", `/offices/${OFFICE_A}`, { user: "customer", body: { name: "New name" } })).status, 403);
});

test("C9 staff of office A edits office B -> 404", async () => {
  assert.strictEqual((await call("PUT", `/offices/${OFFICE_B}`, { user: STAFF_A, body: { name: "Mine now" } })).status, 404);
});

test("C9 nothing to change -> 400", async () => {
  assert.strictEqual((await call("PUT", `/offices/${OFFICE_A}`, { user: STAFF_A, body: {} })).status, 400);
});

test("C9 trying to set coordinates directly -> 400 (only Nominatim sets them)", async () => {
  assert.strictEqual((await call("PUT", `/offices/${OFFICE_A}`, { user: STAFF_A, body: { latitude: 1 } })).status, 400);
});

test("C9 phone with letters -> 400", async () => {
  assert.strictEqual((await call("PUT", `/offices/${OFFICE_A}`, { user: STAFF_A, body: { phone: "call me" } })).status, 400);
});
