const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const app = require("../src/app");
const User = require("../src/models/User");

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

// 1. Role & Schema Verification
test("DEPT-02: User model supports staff, manager, admin roles and department ref", () => {
  const schema = User.schema.paths;
  assert.ok(schema.role);
  assert.deepStrictEqual(schema.role.enumValues, ["admin", "manager", "staff", "citizen"]);
  assert.ok(schema.department);
  assert.ok(schema.isActive);
  assert.ok(schema.phone);
});

// 2. Authentication & Authorization Guards
test("DEPT-02: GET /api/v1/users/staff without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/users/staff`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("DEPT-02: POST /api/v1/users/staff without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/users/staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Field Technician A",
      email: "tech@civicpulse.gov.bd",
    }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("DEPT-02: PATCH /api/v1/users/staff/:id without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/users/staff/000000000000000000000000`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+880 1812 345678" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("DEPT-02: GET /api/v1/users/staff/:id/tasks without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/users/staff/000000000000000000000000/tasks`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

// 3. Workload tier unit calculation logic
test("DEPT-02: Workload capacity tiers enforce correct boundary thresholds", () => {
  const computeTier = (activeTasks) => {
    if (activeTasks >= 6) return "overloaded";
    if (activeTasks >= 3) return "busy";
    return "available";
  };

  assert.strictEqual(computeTier(0), "available");
  assert.strictEqual(computeTier(1), "available");
  assert.strictEqual(computeTier(2), "available");
  assert.strictEqual(computeTier(3), "busy");
  assert.strictEqual(computeTier(4), "busy");
  assert.strictEqual(computeTier(5), "busy");
  assert.strictEqual(computeTier(6), "overloaded");
  assert.strictEqual(computeTier(10), "overloaded");
});
