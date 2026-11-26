// Tests for the staff routes C3-C6: login (401), role (403), input (400), other office (404).
// None of these need the database: every case is stopped before the first query.
process.env.LOCAL_AUTH = "true"; // lets the tests pretend to be users with the x-dev-user header

const test = require("node:test");
const assert = require("node:assert");
const { app } = require("../src/app");

// The fixed IDs from db/seed.sql
const OFFICE_A = "a1a1a1a1-0000-4000-8000-000000000001"; // Downtown Cairo
const OFFICE_B = "a1a1a1a1-0000-4000-8000-000000000002"; // Heliopolis
const CAR_1 = "c0c0c0c0-0000-4000-8000-000000000001";    // in office A

const STAFF_1 = `staff:${OFFICE_A}`; // staff member of office A
const CUSTOMER = "customer";

async function call(method, path, { user, body } = {}) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const headers = { "Content-Type": "application/json" };
    if (user) headers["x-dev-user"] = user;
    const res = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status };
  } finally {
    server.close();
  }
}

const goodCar = { plate: "XYZ 123", make: "Toyota", model: "Yaris", category: "economy", dailyPrice: 950 };

// ----- 401: not logged in -----
test("C3 add car without logging in -> 401", async () => {
  assert.strictEqual((await call("POST", "/cars", { body: goodCar })).status, 401);
});

test("C6 office cars without logging in -> 401", async () => {
  assert.strictEqual((await call("GET", `/offices/${OFFICE_A}/cars`)).status, 401);
});

// ----- 403: logged in but not staff -----
test("C3 customer tries to add a car -> 403", async () => {
  assert.strictEqual((await call("POST", "/cars", { user: CUSTOMER, body: goodCar })).status, 403);
});

test("C5 customer tries to retire a car -> 403", async () => {
  assert.strictEqual((await call("DELETE", `/cars/${CAR_1}`, { user: CUSTOMER })).status, 403);
});

// ----- 400: staff, but bad input -----
test("C3 car with missing fields -> 400", async () => {
  assert.strictEqual((await call("POST", "/cars", { user: STAFF_1, body: { make: "Toyota" } })).status, 400);
});

test("C3 car with a negative price -> 400", async () => {
  const bad = { ...goodCar, dailyPrice: -10 };
  assert.strictEqual((await call("POST", "/cars", { user: STAFF_1, body: bad })).status, 400);
});

test("C3 trying to choose the office in the body -> 400 (office comes from the login)", async () => {
  const sneaky = { ...goodCar, officeId: OFFICE_B };
  assert.strictEqual((await call("POST", "/cars", { user: STAFF_1, body: sneaky })).status, 400);
});

test("C3 broken JSON -> 400", async () => {
  assert.strictEqual((await call("POST", "/cars", { user: STAFF_1, body: "{not json" })).status, 400);
});

test("C4 edit with nothing to change -> 400", async () => {
  assert.strictEqual((await call("PUT", `/cars/${CAR_1}`, { user: STAFF_1, body: {} })).status, 400);
});

test("C4 trying to change the plate -> 400 (only category, price, status)", async () => {
  assert.strictEqual((await call("PUT", `/cars/${CAR_1}`, { user: STAFF_1, body: { plate: "NEW 1" } })).status, 400);
});

test("C4 setting status to retired -> 400 (retire uses DELETE)", async () => {
  assert.strictEqual((await call("PUT", `/cars/${CAR_1}`, { user: STAFF_1, body: { status: "retired" } })).status, 400);
});

test("C5 retire with a bad id -> 400", async () => {
  assert.strictEqual((await call("DELETE", "/cars/abc", { user: STAFF_1 })).status, 400);
});

// ----- 404: another office -----
test("C6 staff of office A asks for office B's cars -> 404", async () => {
  assert.strictEqual((await call("GET", `/offices/${OFFICE_B}/cars`, { user: STAFF_1 })).status, 404);
});

test("C6 office id that is not a UUID -> 400", async () => {
  assert.strictEqual((await call("GET", "/offices/1/cars", { user: STAFF_1 })).status, 400);
});
