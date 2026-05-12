const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function bootstrap() {
  // Minimal mocks
  global.MinutarioConfig = {
    DB_NAME: "TestDB",
    DB_VERSION: 1,
    LAST_SYNC_KEY: "minutario_last_sync",
    TEMPLATES_TABLE: "templates",
  };

  global.MinutarioDB = {
    _templates: [],
    _folders: [],
    _meta: {},
    getAllTemplates: async function () {
      return this._templates;
    },
    getAllFolders: async function () {
      return this._folders;
    },
    putTemplate: async function (t) {
      this._templates = this._templates.filter(function (x) { return x.id !== t.id; });
      this._templates.push(t);
    },
    putFolder: async function (folder) {
      this._folders = this._folders.filter(function (x) { return x.id !== folder.id; });
      this._folders.push(folder);
    },
    deleteAllTemplates: async function () {
      this._templates = [];
    },
    deleteAllFolders: async function () {
      this._folders = [];
    },
    setMeta: async function (key, value) {
      this._meta[key] = value;
    },
    getMeta: async function (key) {
      return this._meta[key];
    },
  };

  global.MinutarioAPI = {
    _templates: [],
    _folders: [],
    _created: [],
    _updated: [],
    _getTemplateCalls: [],
    getTemplates: async function (orgId, options) {
      options = options || {};
      this._getTemplateCalls.push({ orgId: orgId, options: options });
      if (options.since) {
        return this._templates.filter(function (t) {
          return t.updated_at >= options.since;
        });
      }
      return this._templates;
    },
    getFolders: async function () {
      return this._folders;
    },
    getTemplateByShortcut: async function (userId, shortcut) {
      var normalized = String(shortcut || "").toLowerCase();
      var found = this._templates.find(function (t) {
        return String(t.shortcut || "").toLowerCase() === normalized;
      });
      return found || null;
    },
    createTemplate: async function (template) {
      this._created.push(template);
      this._templates.push(template);
      return template;
    },
    updateTemplate: async function (id, updates) {
      this._updated.push({ id: id, updates: updates });
      this._templates = this._templates.map(function (t) {
        return t.id === id ? Object.assign({}, t, updates) : t;
      });
      return updates;
    },
  };

  delete require.cache[require.resolve("../shared/sync.js")];
  require(path.join(__dirname, "..", "shared", "sync.js"));
  return global.MinutarioSync;
}

test("mergeTemplates prefers remote when newer", () => {
  var Sync = bootstrap();
  var local = [
    { id: "1", name: "Local", updated_at: "2024-01-01T00:00:00Z" },
  ];
  var remote = [
    { id: "1", name: "Remote", updated_at: "2024-02-01T00:00:00Z" },
  ];
  var merged = Sync.mergeTemplates(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Remote");
});

test("mergeTemplates keeps local when newer", () => {
  var Sync = bootstrap();
  var local = [
    { id: "1", name: "Local", updated_at: "2024-03-01T00:00:00Z" },
  ];
  var remote = [
    { id: "1", name: "Remote", updated_at: "2024-02-01T00:00:00Z" },
  ];
  var merged = Sync.mergeTemplates(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Local");
});

test("mergeTemplates adds new remote templates", () => {
  var Sync = bootstrap();
  var local = [{ id: "1", name: "A", updated_at: "2024-01-01T00:00:00Z" }];
  var remote = [
    { id: "1", name: "A", updated_at: "2024-01-01T00:00:00Z" },
    { id: "2", name: "B", updated_at: "2024-01-01T00:00:00Z" },
  ];
  var merged = Sync.mergeTemplates(local, remote);
  assert.equal(merged.length, 2);
});

test("syncTemplates performs delta sync and updates meta", async () => {
  var Sync = bootstrap();
  global.MinutarioAPI._templates = [
    { id: "1", name: "Remote1", shortcut: "remote1", updated_at: "2024-06-01T00:00:00Z" },
  ];

  var result = await Sync.syncTemplates("org1");
  assert.equal(result.success, true);
  assert.equal(result.count, 1);

  var all = await global.MinutarioDB.getAllTemplates();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, "Remote1");

  var lastSync = await global.MinutarioDB.getMeta("minutario_last_sync");
  assert.equal(lastSync, undefined);

  lastSync = await global.MinutarioDB.getMeta("minutario_last_sync:org1");
  assert.ok(lastSync);
});

test("fullSync replaces all local with remote", async () => {
  var Sync = bootstrap();
  global.MinutarioDB._templates = [
    { id: "old", name: "Old", shortcut: "old", updated_at: "2024-01-01T00:00:00Z" },
  ];
  global.MinutarioAPI._templates = [
    { id: "new", name: "New", shortcut: "new", updated_at: "2024-06-01T00:00:00Z" },
  ];

  var result = await Sync.fullSync("org1");
  assert.equal(result.success, true);
  assert.equal(result.count, 1);

  var all = await global.MinutarioDB.getAllTemplates();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, "New");
});

test("getSyncState returns current state", () => {
  var Sync = bootstrap();
  assert.equal(Sync.getSyncState(), "idle");
});

test("onSyncStateChange receives state updates", async () => {
  var Sync = bootstrap();
  var states = [];
  Sync.onSyncStateChange(function (state) {
    states.push(state);
  });

  global.MinutarioAPI._templates = [{ id: "1", name: "A", shortcut: "a", updated_at: "2024-06-01T00:00:00Z" }];
  await Sync.syncTemplates("org1");

  assert.ok(states.indexOf("syncing") !== -1);
  assert.ok(states.indexOf("updated") !== -1);
});

test("syncTemplates pushes local-only template to remote", async () => {
  var Sync = bootstrap();
  global.MinutarioDB._templates = [
    {
      id: "local-1",
      user_id: "org1",
      name: "Local only",
      shortcut: "atalho-local",
      content: "<p>conteudo</p>",
      plain_text: "conteudo",
      updated_at: "2024-06-02T00:00:00Z",
    },
  ];

  global.MinutarioAPI._templates = [];

  var result = await Sync.syncTemplates("org1");
  assert.equal(result.success, true);
  assert.equal(global.MinutarioAPI._created.length, 1);
  assert.equal(global.MinutarioAPI._created[0].shortcut, "atalho-local");
});

test("syncTemplates forceFullPull fetches remote templates without since filter", async () => {
  var Sync = bootstrap();
  await global.MinutarioDB.setMeta("minutario_last_sync:org1", "2024-06-01T00:00:00Z");
  global.MinutarioAPI._templates = [
    { id: "remote-1", user_id: "org1", name: "Remote", shortcut: "remote", updated_at: "2024-06-01T00:00:00Z" },
  ];

  var result = await Sync.syncTemplates("org1", { forceFullPull: true });

  assert.equal(result.success, true);
  var lastCall = global.MinutarioAPI._getTemplateCalls[global.MinutarioAPI._getTemplateCalls.length - 1];
  assert.deepEqual(lastCall.options, {});
});

test("syncTemplates full syncs and clears local data when user changes", async () => {
  var Sync = bootstrap();

  await global.MinutarioDB.setMeta("minutario_current_user_id", "user-a");
  global.MinutarioDB._templates = [
    { id: "a-local", user_id: "user-a", name: "A", shortcut: "a", updated_at: "2024-01-01T00:00:00Z" },
  ];
  global.MinutarioDB._folders = [
    { id: "folder-a", user_id: "user-a", name: "Pasta A" },
  ];
  global.MinutarioAPI._templates = [
    { id: "b-remote", user_id: "user-b", name: "B", shortcut: "b", updated_at: "2024-06-01T00:00:00Z" },
  ];
  global.MinutarioAPI._folders = [
    { id: "folder-b", user_id: "user-b", name: "Pasta B" },
  ];

  var result = await Sync.syncTemplates("user-b");

  assert.equal(result.success, true);
  assert.equal(global.MinutarioDB._templates.length, 1);
  assert.equal(global.MinutarioDB._templates[0].id, "b-remote");
  assert.equal(global.MinutarioDB._folders.length, 1);
  assert.equal(global.MinutarioDB._folders[0].id, "folder-b");
  assert.equal(await global.MinutarioDB.getMeta("minutario_current_user_id"), "user-b");
  assert.ok(await global.MinutarioDB.getMeta("minutario_last_sync:user-b"));
});
