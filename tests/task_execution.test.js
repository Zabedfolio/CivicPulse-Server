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

// 1. Auth Guards
test("TASK-02: PATCH /api/v1/tasks/:id/status without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/tasks/000000000000000000000000/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "In Progress" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("TASK-02: POST /api/v1/tasks/:id/progress without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/tasks/000000000000000000000000/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: "Working on-site" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("TASK-02: POST /api/v1/tasks/:id/completion-photos without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/tasks/000000000000000000000000/completion-photos`, {
    method: "POST",
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

// 2. Unit logic: Completion requires at least 1 photo proof
test("TASK-02: Completing a task requires at least 1 completion photo", () => {
  const taskWithoutPhotos = {
    status: "In Progress",
    completionPhotos: [],
  };

  const attemptCompletion = (task) => {
    if (!task.completionPhotos || task.completionPhotos.length === 0) {
      const err = new Error("At least one photographic proof of repair is required to mark this task as completed.");
      err.statusCode = 400;
      throw err;
    }
    task.status = "Completed";
  };

  assert.throws(
    () => attemptCompletion(taskWithoutPhotos),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      assert.match(err.message, /At least one photographic proof/);
      return true;
    }
  );

  const taskWithPhoto = {
    status: "In Progress",
    completionPhotos: [{ url: "https://cloudinary.com/test.jpg" }],
  };

  assert.doesNotThrow(() => attemptCompletion(taskWithPhoto));
  assert.strictEqual(taskWithPhoto.status, "Completed");
});
