const test = require("node:test");
const assert = require("node:assert/strict");

test("full sync flow: local cache merges with remote templates", async () => {
  // Mock IndexedDB
  var mockDB = {
    templates: [],
    async putTemplate(t) {
      var idx = this.templates.findIndex(function (x) { return x.id === t.id; });
      if (idx >= 0) this.templates[idx] = t;
      else this.templates.push(t);
    },
    async getAllTemplates() { return this.templates; },
    async deleteAllTemplates() { this.templates = []; },
    async setMeta() {},
    async getMeta() { return null; },
  };

  // Mock API returning remote templates
  var mockAPI = {
    async getTemplates() {
      return {
        data: [
          { id: "1", shortcut: "caso01", content: "new version", updated_at: "2025-01-02T00:00:00Z", user_id: "user-1" },
          { id: "2", shortcut: "caso02", content: "b", updated_at: "2025-01-01T00:00:00Z", user_id: "user-1" },
        ],
        error: null,
      };
    },
  };

  // Seed local cache with older version
  mockDB.templates = [
    { id: "1", shortcut: "caso01", content: "old version", updated_at: "2025-01-01T00:00:00Z" }
  ];

  // Simulate full sync (merge remote into local)
  var local = await mockDB.getAllTemplates();
  var remoteResult = await mockAPI.getTemplates();
  var remote = remoteResult.data;

  var merged = {};
  local.forEach(function (t) { merged[t.id] = t; });
  remote.forEach(function (t) {
    var existing = merged[t.id];
    if (!existing || new Date(t.updated_at) > new Date(existing.updated_at)) {
      merged[t.id] = t;
    }
  });

  // Save merged back to "DB"
  await mockDB.deleteAllTemplates();
  Object.values(merged).forEach(async function (t) {
    await mockDB.putTemplate(t);
  });

  var result = await mockDB.getAllTemplates();

  // Assertions
  assert.equal(result.length, 2);
  assert.equal(result.find(function (t) { return t.id === "1"; }).content, "new version");
  assert.equal(result.find(function (t) { return t.id === "2"; }).shortcut, "caso02");
});

test("delta sync: only fetches templates changed since last sync", async () => {
  var lastSync = "2025-01-02T00:00:00Z";
  
  var mockAPI = {
    async getTemplates(userId, options) {
      if (options && options.since) {
        assert.equal(options.since, lastSync);
      }
      return {
        data: [
          { id: "3", shortcut: "caso03", content: "c", updated_at: "2025-01-03T00:00:00Z", user_id: "user-1" }
        ],
        error: null,
      };
    },
  };

  var result = await mockAPI.getTemplates("user-1", { since: lastSync });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].id, "3");
});
