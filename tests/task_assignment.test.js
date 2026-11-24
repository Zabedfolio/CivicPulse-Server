const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const app = require("../src/app");
const Task = require("../src/models/Task");

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

// 1. Task Model Constants Unit Tests
test("TASK-01: Task model defines standard statuses and priorities", () => {
  assert.ok(Array.isArray(Task.TASK_STATUSES));
  assert.ok(Task.TASK_STATUSES.includes("Pending"));
  assert.ok(Task.TASK_STATUSES.includes("In Progress"));
  assert.ok(Task.TASK_STATUSES.includes("Completed"));
  assert.ok(Task.TASK_STATUSES.includes("Cancelled"));

  assert.ok(Array.isArray(Task.TASK_PRIORITIES));
  assert.ok(Task.TASK_PRIORITIES.includes("low"));
  assert.ok(Task.TASK_PRIORITIES.includes("medium"));
  assert.ok(Task.TASK_PRIORITIES.includes("high"));
  assert.ok(Task.TASK_PRIORITIES.includes("critical"));
});

// 2. HTTP Endpoint Auth Guards
test("TASK-01: POST /api/v1/tasks without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      issueId: "000000000000000000000000",
      assignedTo: "111111111111111111111111",
      instructions: "Inspect and repair",
    }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("TASK-01: GET /api/v1/tasks without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/tasks`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("TASK-01: GET /api/v1/tasks/workload without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/tasks/workload`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("TASK-01: GET /api/v1/tasks/staff without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/tasks/staff`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("TASK-01: GET /api/v1/tasks/:id without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/tasks/000000000000000000000000`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});
