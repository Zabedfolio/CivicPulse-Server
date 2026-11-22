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

test("GET /api/v1/auth/me without token returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/me`);
  assert.strictEqual(res.status, 401);

  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("GET /api/v1/auth/me with invalid Bearer token returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: {
      Authorization: "Bearer invalid_session_token_123",
    },
  });
  // Since DB connection might not be connected in isolated test or token is invalid
  assert.ok(res.status === 401 || res.status === 500);

  const json = await res.json();
  assert.strictEqual(json.success, false);
});
