
const test = require("node:test");
const assert = require("node:assert");
const { app } = require("../src/app");

test("GET /health says the catalogue service is ok", async () => {
  const server = app.listen(0); // 0 = any free port
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { service: "catalogue", status: "ok" });
  } finally {
    server.close();
  }
});

test("an unknown URL returns 404", async () => {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/nope`);
    assert.strictEqual(res.status, 404);
  } finally {
    server.close();
  }
});
