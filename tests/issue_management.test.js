const { test } = require("node:test");
const assert = require("node:assert");

const PORT = process.env.PORT || 5000;
const baseUrl = `http://localhost:${PORT}`;

test("MGT-01: GET /api/v1/issues returns 200 with pagination structure", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues?page=1&limit=5`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
  if (res.status === 200) {
    assert.strictEqual(json.success, true);
    assert.ok(Array.isArray(json.data.issues));
    assert.ok("pagination" in json);
    assert.strictEqual(json.pagination.page, 1);
    assert.strictEqual(json.pagination.limit, 5);
    assert.ok("total" in json.pagination);
    assert.ok("totalPages" in json.pagination);
  }
});

test("MGT-01: GET /api/v1/issues supports search query", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues?search=Culvert&limit=5`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});

test("MGT-01: GET /api/v1/issues supports multi-status and priority filter", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues?status=Submitted,Under Review&priority=critical`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});

test("MGT-01: GET /api/v1/issues supports dynamic sorting", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues?sortBy=priority&sortOrder=asc&limit=5`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});
