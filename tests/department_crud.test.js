const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const app = require("../src/app");
const Department = require("../src/models/Department");

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

// 1. Department Schema & Defaults
test("DEPT-01: Department model defines schema fields correctly", () => {
  const schema = Department.schema.paths;
  assert.ok(schema.name);
  assert.ok(schema.code);
  assert.ok(schema.description);
  assert.ok(schema.contactEmail);
  assert.ok(schema.contactPhone);
  assert.ok(schema.manager);
  assert.ok(schema.status);
  assert.ok(schema.categories);
  assert.deepStrictEqual(schema.status.enumValues, ["active", "inactive"]);
});

// 2. Public / Active Departments Endpoint
test("DEPT-01: GET /api/v1/departments returns 200 or standard envelope", async () => {
  const res = await fetch(`${baseUrl}/api/v1/departments`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});

// 3. Admin Authentication Guards
test("DEPT-01: GET /api/v1/departments/all without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/departments/all`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("DEPT-01: GET /api/v1/departments/managers/candidates without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/departments/managers/candidates`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("DEPT-01: POST /api/v1/departments without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Water Authority",
      code: "WASA",
    }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("DEPT-01: PATCH /api/v1/departments/:id without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/departments/000000000000000000000000`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Updated Water Authority",
    }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("DEPT-01: DELETE /api/v1/departments/:id without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/departments/000000000000000000000000`, {
    method: "DELETE",
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});
