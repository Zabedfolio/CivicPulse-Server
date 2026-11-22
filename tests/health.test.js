const test = require("node:test");
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

test("GET /api/v1/health returns 200 with standard response envelope", async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  assert.strictEqual(res.status, 200);

  const json = await res.json();
  assert.strictEqual(json.success, true);
  assert.strictEqual(json.message, "CivicPulse API is operational");
  assert.strictEqual(json.data.status, "healthy");
  assert.strictEqual(typeof json.data.uptime, "number");
});

test("GET /api/v1/nonexistent returns 404 with standard error envelope", async () => {
  const res = await fetch(`${baseUrl}/api/v1/nonexistent`);
  assert.strictEqual(res.status, 404);

  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Endpoint not found/);
});
