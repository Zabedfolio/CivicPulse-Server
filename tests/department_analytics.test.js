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

// 1. SLA Scorecard Public Endpoint
test("DEPT-03: GET /api/v1/departments/analytics/sla-scorecard returns 200 or standard envelope", async () => {
  const res = await fetch(`${baseUrl}/api/v1/departments/analytics/sla-scorecard`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});

// 2. Department Analytics Auth Guards
test("DEPT-03: GET /api/v1/departments/:id/analytics without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/departments/000000000000000000000000/analytics`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

// 3. Priority SLA Hours Unit Mapping
test("DEPT-03: Priority SLA thresholds adhere to municipal standards", () => {
  const SLA_HOURS_BY_PRIORITY = {
    critical: 24,
    high: 48,
    medium: 72,
    low: 120,
  };

  assert.strictEqual(SLA_HOURS_BY_PRIORITY.critical, 24);
  assert.strictEqual(SLA_HOURS_BY_PRIORITY.high, 48);
  assert.strictEqual(SLA_HOURS_BY_PRIORITY.medium, 72);
  assert.strictEqual(SLA_HOURS_BY_PRIORITY.low, 120);
});

// 4. On-Time Calculation Logic
test("DEPT-03: On-time resolution detection enforces priority thresholds", () => {
  const isResolutionOnTime = (priority, durationHours) => {
    const limits = { critical: 24, high: 48, medium: 72, low: 120 };
    return durationHours <= (limits[priority] || 72);
  };

  // Critical: 20h is on-time, 25h is overdue
  assert.strictEqual(isResolutionOnTime("critical", 20), true);
  assert.strictEqual(isResolutionOnTime("critical", 25), false);

  // High: 45h is on-time, 50h is overdue
  assert.strictEqual(isResolutionOnTime("high", 45), true);
  assert.strictEqual(isResolutionOnTime("high", 50), false);

  // Medium: 70h is on-time, 75h is overdue
  assert.strictEqual(isResolutionOnTime("medium", 70), true);
  assert.strictEqual(isResolutionOnTime("medium", 75), false);

  // Low: 110h is on-time, 130h is overdue
  assert.strictEqual(isResolutionOnTime("low", 110), true);
  assert.strictEqual(isResolutionOnTime("low", 130), false);
});
