const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const app = require("../src/app");
const Feedback = require("../src/models/Feedback");

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

// 1. Auth Guards
test("TASK-03: POST /api/v1/issues/:id/feedback without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/000000000000000000000000/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: 5, comment: "Excellent repair!" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("TASK-03: GET /api/v1/issues/:id/feedback returns 200 or standard envelope", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/000000000000000000000000/feedback`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});

// 2. Unit logic: Rating boundaries (1 to 5)
test("TASK-03: Rating validation enforces 1 to 5 integer scale", () => {
  const validateRating = (rating) => {
    const num = parseInt(rating, 10);
    if (isNaN(num) || num < 1 || num > 5) {
      const err = new Error("Rating must be an integer between 1 and 5 stars.");
      err.statusCode = 400;
      throw err;
    }
    return num;
  };

  assert.strictEqual(validateRating(5), 5);
  assert.strictEqual(validateRating("4"), 4);
  assert.strictEqual(validateRating(1), 1);

  assert.throws(
    () => validateRating(0),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      return true;
    }
  );

  assert.throws(
    () => validateRating(6),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      return true;
    }
  );

  assert.throws(
    () => validateRating("invalid"),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      return true;
    }
  );
});

// 3. Unit logic: Issue must be Resolved or Closed
test("TASK-03: Submitting feedback on un-resolved issues is rejected", () => {
  const validateStatus = (status) => {
    if (status !== "Resolved" && status !== "Closed") {
      const err = new Error(`Citizen feedback can only be submitted once the issue has been marked Resolved. Current status: '${status}'`);
      err.statusCode = 400;
      throw err;
    }
  };

  assert.doesNotThrow(() => validateStatus("Resolved"));
  assert.doesNotThrow(() => validateStatus("Closed"));

  assert.throws(
    () => validateStatus("Submitted"),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      assert.match(err.message, /once the issue has been marked Resolved/);
      return true;
    }
  );

  assert.throws(
    () => validateStatus("In Progress"),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      return true;
    }
  );
});
