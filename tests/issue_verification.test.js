const { test } = require("node:test");
const assert = require("node:assert");
const app = require("../src/app");
const http = require("http");

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

test("MGT-02: PATCH /api/v1/issues/:id/verify without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/000000000000000000000000/verify`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: "Verified in inspection" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("MGT-02: PATCH /api/v1/issues/:id/priority without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/000000000000000000000000/priority`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priority: "critical" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("MGT-02: PATCH /api/v1/issues/:id/reroute without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/000000000000000000000000/reroute`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ departmentId: "000000000000000000000000" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});
