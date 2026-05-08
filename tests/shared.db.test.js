const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Simple in-memory IndexedDB mock
function createMockIndexedDB() {
  var databases = {};

  function createNameList(items) {
    return {
      _items: items,
      contains: function (name) {
        return this._items.indexOf(name) !== -1;
      },
    };
  }

  function createStoreHandle(store) {
    return {
      createIndex: function (idxName, keyPath, opts) {
        store.indexes[idxName] = { keyPath: keyPath, data: {} };
      },
      deleteIndex: function (idxName) {
        delete store.indexes[idxName];
      },
      get indexNames() {
        return createNameList(Object.keys(store.indexes));
      },
    };
  }

  function MockDB(name, version) {
    this.name = name;
    this.version = version;
    this.objectStoreNames = createNameList([]);
    this._stores = {};
  }

  MockDB.prototype.createObjectStore = function (name, options) {
    var store = { name: name, keyPath: options ? options.keyPath : null, indexes: {}, data: {} };
    this._stores[name] = store;
    this.objectStoreNames._items.push(name);
    return createStoreHandle(store);
  };

  MockDB.prototype.transaction = function (storeNames, mode) {
    var self = this;
    return {
      objectStore: function (name) {
        var store = self._stores[name];
        return {
          put: function (value) {
            var key = value[store.keyPath];
            store.data[key] = value;
            for (var idxName in store.indexes) {
              var idx = store.indexes[idxName];
              var idxKey = value[idx.keyPath];
              if (!idx.data[idxKey]) idx.data[idxKey] = [];
              // replace if same key
              idx.data[idxKey] = [value];
            }
            return { set onsuccess(fn) { setTimeout(fn, 0); }, result: key };
          },
          getAll: function () {
            var values = Object.values(store.data);
            return { set onsuccess(fn) { setTimeout(function () { fn(); }, 0); }, result: values };
          },
          get: function (key) {
            return { set onsuccess(fn) { setTimeout(function () { fn(); }, 0); }, result: store.data[key] || null };
          },
          clear: function () {
            store.data = {};
            for (var idxName in store.indexes) {
              store.indexes[idxName].data = {};
            }
            return { set onsuccess(fn) { setTimeout(fn, 0); }, result: undefined };
          },
          delete: function (key) {
            delete store.data[key];
            for (var idxName in store.indexes) {
              store.indexes[idxName].data = {};
              Object.values(store.data).forEach(function (value) {
                var idx = store.indexes[idxName];
                var idxKey = value[idx.keyPath];
                if (!idx.data[idxKey]) idx.data[idxKey] = [];
                idx.data[idxKey].push(value);
              });
            }
            return { set onsuccess(fn) { setTimeout(fn, 0); }, result: undefined };
          },
          index: function (idxName) {
            var idx = store.indexes[idxName];
            return {
              getAll: function (key) {
                var values = idx.data[key] || [];
                return { set onsuccess(fn) { setTimeout(function () { fn(); }, 0); }, result: values };
              },
            };
          },
        };
      },
      set onerror(fn) {},
    };
  };

  return {
    open: function (name, version) {
      var req = {
        set onsuccess(fn) { this._onsuccess = fn; },
        set onerror(fn) { this._onerror = fn; },
        set onupgradeneeded(fn) { this._onupgrade = fn; },
        result: null,
      };
      setTimeout(function () {
        var db = databases[name];
        var needsUpgrade = !db || (typeof version === "number" && version > db.version);

        if (!db) {
          db = new MockDB(name, version);
          databases[name] = db;
        } else if (needsUpgrade) {
          db.version = version;
        }

        if (needsUpgrade && req._onupgrade) {
          req.result = db;
          req.transaction = {
            objectStore: function (storeName) {
              return createStoreHandle(db._stores[storeName]);
            },
          };
          req._onupgrade({ target: req });
        }

        req.result = db;
        if (req._onsuccess) req._onsuccess();
      }, 0);
      return req;
    },
  };
}

function bootstrap() {
  global.indexedDB = createMockIndexedDB();
  delete require.cache[require.resolve("../shared/config.js")];
  delete require.cache[require.resolve("../shared/db.js")];
  require(path.join(__dirname, "..", "shared", "config.js"));
  require(path.join(__dirname, "..", "shared", "db.js"));
  return global.MinutarioDB;
}

test("templates store uses user_id index instead of org_id", async () => {
  var DB = bootstrap();
  var db = await DB.open();

  assert.ok(db._stores.templates.indexes.user_id);
  assert.equal(db._stores.templates.indexes.org_id, undefined);
});

test("existing IndexedDB upgrades templates and folders stores to user_id indexes", async () => {
  global.indexedDB = createMockIndexedDB();
  delete require.cache[require.resolve("../shared/config.js")];
  delete require.cache[require.resolve("../shared/db.js")];
  require(path.join(__dirname, "..", "shared", "config.js"));

  global.MinutarioConfig.DB_VERSION = 1;
  require(path.join(__dirname, "..", "shared", "db.js"));

  var legacyDb = await global.MinutarioDB.open();
  legacyDb.createObjectStore("folders", { keyPath: "id" });
  legacyDb._stores.templates.indexes.org_id = { keyPath: "org_id", data: {} };

  delete require.cache[require.resolve("../shared/db.js")];
  global.MinutarioConfig.DB_VERSION = 2;
  require(path.join(__dirname, "..", "shared", "db.js"));

  var upgradedDb = await global.MinutarioDB.open();

  assert.ok(upgradedDb._stores.templates.indexes.user_id);
  assert.equal(upgradedDb._stores.templates.indexes.org_id, undefined);
  assert.ok(upgradedDb._stores.folders.indexes.user_id);
});

test("putTemplate and getAllTemplates", async () => {
  var DB = bootstrap();
  var template = { id: "t1", name: "Hello", shortcut: "hi", content: "Hi there", user_id: "u1", updated_at: "2024-01-01T00:00:00Z" };
  await DB.putTemplate(template);
  var all = await DB.getAllTemplates();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "t1");
});

test("getTemplateByShortcut", async () => {
  var DB = bootstrap();
  await DB.putTemplate({ id: "t1", name: "Hello", shortcut: "hi", content: "Hi", user_id: "u1", updated_at: "2024-01-01T00:00:00Z" });
  await DB.putTemplate({ id: "t2", name: "Bye", shortcut: "bye", content: "Bye", user_id: "u1", updated_at: "2024-01-01T00:00:00Z" });
  var found = await DB.getTemplateByShortcut("bye");
  assert.ok(found);
  assert.equal(found.id, "t2");
});

test("deleteAllTemplates clears all templates", async () => {
  var DB = bootstrap();
  await DB.putTemplate({ id: "t1", name: "A", shortcut: "a", content: "A", user_id: "u1", updated_at: "2024-01-01T00:00:00Z" });
  await DB.deleteAllTemplates();
  var all = await DB.getAllTemplates();
  assert.equal(all.length, 0);
});

test("deleteTemplate removes only the requested template", async () => {
  var DB = bootstrap();
  await DB.putTemplate({ id: "t1", name: "A", shortcut: "a", content: "A", user_id: "u1", updated_at: "2024-01-01T00:00:00Z" });
  await DB.putTemplate({ id: "t2", name: "B", shortcut: "b", content: "B", user_id: "u1", updated_at: "2024-01-01T00:00:00Z" });

  await DB.deleteTemplate("t1");

  var all = await DB.getAllTemplates();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "t2");
});

test("setMeta and getMeta", async () => {
  var DB = bootstrap();
  await DB.setMeta("foo", "bar");
  var value = await DB.getMeta("foo");
  assert.equal(value, "bar");
});

test("getMeta returns undefined for missing key", async () => {
  var DB = bootstrap();
  var value = await DB.getMeta("missing");
  assert.equal(value, undefined);
});

test("saveFolder and getAllFolders", async () => {
  var DB = bootstrap();
  await DB.saveFolder({ id: "f1", name: "Petições", order: 0 });
  await DB.saveFolder({ id: "f2", name: "Contratos", order_idx: 1 });

  var folders = await DB.getAllFolders();
  assert.equal(folders.length, 2);
  assert.equal(folders[0].id, "f1");
  assert.equal(folders[1].id, "f2");
});

test("deleteFolder removes only the requested folder", async () => {
  var DB = bootstrap();
  await DB.saveFolder({ id: "f1", name: "Petições", order: 0 });
  await DB.saveFolder({ id: "f2", name: "Contratos", order: 1 });

  await DB.deleteFolder("f1");

  var folders = await DB.getAllFolders();
  assert.equal(folders.length, 1);
  assert.equal(folders[0].id, "f2");
});
