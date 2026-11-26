// Checks that bad input is rejected with 400 BEFORE the database is used.
// These tests do not need a database, so they also run on GitHub.
const test = require("node:test");
const assert = require("node:assert");
const { app } = require("../src/app");

async function get(path) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("car id that is not a UUID -> 400", async () => {
  const { status } = await get("/cars/abc");
  assert.strictEqual(status, 400);
});

test("unknown category -> 400", async () => {
  const { status } = await get("/cars?category=spaceship");
  assert.strictEqual(status, 400);
});

test("negative max price -> 400", async () => {
  const { status } = await get("/cars?maxPrice=-5");
  assert.strictEqual(status, 400);
});

test("unknown filter -> 400", async () => {
  const { status } = await get("/cars?colour=red");
  assert.strictEqual(status, 400);
});

test("SQL injection attempt in the id -> 400, never reaches the database", async () => {
  const { status } = await get("/cars/1;DROP%20TABLE%20cars");
  assert.strictEqual(status, 400);
});

test("a plain number as car id -> 400 (IDs are UUIDs)", async () => {
  const { status } = await get("/cars/1");
  assert.strictEqual(status, 400);
});

test("office filter that is not a UUID -> 400", async () => {
  const { status } = await get("/cars?office=1");
  assert.strictEqual(status, 400);
});
