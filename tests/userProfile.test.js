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

test("PATCH /api/v1/users/me without token returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/users/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Updated Name" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("PATCH /api/v1/users/me/password without token returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/users/me/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentPassword: "Password123!",
      newPassword: "NewSecurePassword456!",
    }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});
