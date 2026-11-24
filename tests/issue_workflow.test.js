const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const app = require("../src/app");
const { TRANSITION_RULES, transitionIssueStatus } = require("../src/services/issueWorkflow");

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

// 1. FSM Transition Rules Structure Unit Tests
test("MGT-03: TRANSITION_RULES defines legal forward and reverse transitions", () => {
  assert.ok(TRANSITION_RULES.Submitted.next.includes("Under Review"));
  assert.ok(TRANSITION_RULES.Submitted.next.includes("Closed"));
  assert.deepStrictEqual(TRANSITION_RULES.Submitted.allowedRoles, ["manager", "admin"]);

  assert.ok(TRANSITION_RULES["Under Review"].next.includes("Assigned"));
  assert.ok(TRANSITION_RULES["Under Review"].next.includes("Closed"));

  assert.ok(TRANSITION_RULES.Assigned.next.includes("In Progress"));
  assert.ok(TRANSITION_RULES.Assigned.allowedRoles.includes("staff"));

  assert.ok(TRANSITION_RULES["In Progress"].next.includes("Resolved"));
  assert.ok(TRANSITION_RULES["In Progress"].allowedRoles.includes("staff"));

  assert.ok(TRANSITION_RULES.Resolved.next.includes("Closed"));
  assert.deepStrictEqual(TRANSITION_RULES.Resolved.allowedRoles, ["manager", "admin"]);

  // Super Admin re-open rule
  assert.deepStrictEqual(TRANSITION_RULES.Closed.next, ["Under Review"]);
  assert.deepStrictEqual(TRANSITION_RULES.Closed.allowedRoles, ["admin"]);
});

// 2. HTTP Endpoint Auth & Role Guards
test("MGT-03: PATCH /api/v1/issues/:id/status without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/000000000000000000000000/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Under Review" }),
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("MGT-03: GET /api/v1/notifications without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/notifications`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("MGT-03: GET /api/v1/notifications/unread-count without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/notifications/unread-count`);
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("MGT-03: PATCH /api/v1/notifications/:id/read without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/notifications/000000000000000000000000/read`, {
    method: "PATCH",
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

test("MGT-03: PATCH /api/v1/notifications/mark-all-read without auth returns 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/api/v1/notifications/mark-all-read`, {
    method: "PATCH",
  });
  assert.strictEqual(res.status, 401);
  const json = await res.json();
  assert.strictEqual(json.success, false);
  assert.match(json.message, /Authentication required/);
});

// 3. Workflow Engine Unit Validation: Illegal Status Transitions
test("MGT-03: transitionIssueStatus rejects illegal jumps (Submitted -> Resolved)", async () => {
  const fakeIssue = {
    _id: "fake_issue_id",
    status: "Submitted",
  };

  // Mock Issue.findById
  const Issue = require("../src/models/Issue");
  const origFindById = Issue.findById;
  Issue.findById = () => ({
    ...fakeIssue,
  });

  try {
    await assert.rejects(
      async () => {
        await transitionIssueStatus("fake_issue_id", "Resolved", { role: "admin" });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Illegal status transition/);
        return true;
      }
    );
  } finally {
    Issue.findById = origFindById;
  }
});

// 4. Workflow Engine Unit Validation: Role Authorization Guards
test("MGT-03: transitionIssueStatus rejects unauthorized role (Citizen -> Under Review)", async () => {
  const fakeIssue = {
    _id: "fake_issue_id",
    status: "Submitted",
  };

  const Issue = require("../src/models/Issue");
  const origFindById = Issue.findById;
  Issue.findById = () => ({
    ...fakeIssue,
  });

  try {
    await assert.rejects(
      async () => {
        await transitionIssueStatus("fake_issue_id", "Under Review", { role: "citizen" });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.message, /Forbidden: Role 'citizen' is not authorized/);
        return true;
      }
    );
  } finally {
    Issue.findById = origFindById;
  }
});

test("MGT-03: transitionIssueStatus requires authenticated user object", async () => {
  await assert.rejects(
    async () => {
      await transitionIssueStatus("fake_id", "Under Review", null);
    },
    (err) => {
      assert.strictEqual(err.statusCode, 401);
      assert.match(err.message, /Authentication required/);
      return true;
    }
  );
});
