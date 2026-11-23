const test = require("node:test");
const assert = require("node:assert");
const { authorize } = require("../src/middleware/roleCheck");

test("authorize() throws 401 when req.user is missing", (t, done) => {
  const req = {};
  const res = {};
  const middleware = authorize("admin");

  middleware(req, res, (err) => {
    assert.ok(err);
    assert.strictEqual(err.statusCode, 401);
    assert.match(err.message, /Authentication required/);
    done();
  });
});

test("authorize() throws 403 when req.user.role does not match allowed roles", (t, done) => {
  const req = { user: { role: "citizen" } };
  const res = {};
  const middleware = authorize("admin", "manager");

  middleware(req, res, (err) => {
    assert.ok(err);
    assert.strictEqual(err.statusCode, 403);
    assert.match(err.message, /not authorized/);
    done();
  });
});

test("authorize() calls next() without error when user has valid role", (t, done) => {
  const req = { user: { role: "manager" } };
  const res = {};
  const middleware = authorize("admin", "manager");

  middleware(req, res, (err) => {
    assert.strictEqual(err, undefined);
    done();
  });
});

test("authorize() permits admin role when included", (t, done) => {
  const req = { user: { role: "admin" } };
  const res = {};
  const middleware = authorize("admin");

  middleware(req, res, (err) => {
    assert.strictEqual(err, undefined);
    done();
  });
});
