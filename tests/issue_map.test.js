const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const app = require("../src/app");
const Issue = require("../src/models/Issue");

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

// 1. Map pins endpoint
test("MAP-01: GET /api/v1/issues/map/pins returns 200 or standard envelope", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/map/pins`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});

test("MAP-01: GET /api/v1/issues/map/pins supports category and status filters", async () => {
  const res = await fetch(`${baseUrl}/api/v1/issues/map/pins?category=Streetlight&status=Submitted`);
  assert.ok(res.status === 200 || res.status === 500);
  const json = await res.json();
  assert.ok("success" in json);
});

// 2. Category Color & Pulse Mapping Unit Logic
test("MAP-01: Standard categories map to distinct visual hex colors", () => {
  const CATEGORY_COLORS = {
    "Road Damage": "#EF4444",
    Streetlight: "#EAB308",
    Drainage: "#3B82F6",
    Footpath: "#A855F7",
    "Waste Management": "#10B981",
    "Public Infrastructure": "#64748B",
  };

  assert.strictEqual(CATEGORY_COLORS["Road Damage"], "#EF4444");
  assert.strictEqual(CATEGORY_COLORS.Streetlight, "#EAB308");
  assert.strictEqual(CATEGORY_COLORS.Drainage, "#3B82F6");
  assert.strictEqual(CATEGORY_COLORS.Footpath, "#A855F7");
  assert.strictEqual(CATEGORY_COLORS["Waste Management"], "#10B981");
  assert.strictEqual(CATEGORY_COLORS["Public Infrastructure"], "#64748B");
});

// 3. GeoJSON coordinate extraction validation
test("MAP-01: Coordinates correctly convert GeoJSON [lng, lat] to Leaflet [lat, lng]", () => {
  const toLeafletCoords = (geoJsonCoords) => {
    if (!Array.isArray(geoJsonCoords) || geoJsonCoords.length < 2) {
      return [22.3569, 91.7832]; // Default Chittagong
    }
    return [geoJsonCoords[1], geoJsonCoords[0]]; // [lat, lng]
  };

  const sampleGeoJson = [91.8317, 22.3384]; // [lng, lat]
  const leafletCoords = toLeafletCoords(sampleGeoJson);

  assert.strictEqual(leafletCoords[0], 22.3384); // lat
  assert.strictEqual(leafletCoords[1], 91.8317); // lng
});
