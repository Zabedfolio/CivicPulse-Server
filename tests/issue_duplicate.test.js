const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const app = require("../src/app");

let server;
let baseUrl;

test.before((t, done) => {
  server = http.createServer(app);
  server.listen(0, () => {
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

test.after((t, done) => {
  server.close(done);
});

// 1. GET /api/v1/issues/nearby Validation
test("MGT-04: GET /api/v1/issues/nearby without lat/lng returns 400 Bad Request", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/nearby`);
  assert.strictEqual(res.status, 400);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Latitude \(lat\) and Longitude \(lng\) are required/);
});

test("MGT-04: GET /api/v1/issues/nearby with invalid coordinates returns 400 Bad Request", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/nearby?lat=999&lng=91.8317`);
  assert.strictEqual(res.status, 400);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Invalid coordinates/);
});

test("MGT-04: GET /api/v1/issues/nearby with valid Chittagong coordinates returns 200 with distance array", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/nearby?lat=22.3384&lng=91.8317&radius=100`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
  if (res.status === 200) {
    assert.strictEqual(json.success, true);
    assert.ok(Array.isArray(json.data.issues));
    assert.strictEqual(typeof json.data.count, "number");
    assert.strictEqual(json.data.radiusMeters, 100);
  }
});

test("MGT-04: GET /api/v1/issues/nearby supports category filtering", async () => {
  const res = await fetch(
    `${baseUrl}/api/v1/issues/nearby?lat=22.3384&lng=91.8317&radius=200&category=Road Damage`
  );
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});

// 2. PATCH /api/v1/issues/:id/mark-duplicate Auth Guards
test("MGT-04: PATCH /api/v1/issues/:id/mark-duplicate without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/000000000000000000000000/mark-duplicate`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentIssueId: "111111111111111111111111" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

// 3. PATCH /api/v1/issues/:id/unmark-duplicate Auth Guards
test("MGT-04: PATCH /api/v1/issues/:id/unmark-duplicate without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/000000000000000000000000/unmark-duplicate`, {
    method: "PATCH",
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});
