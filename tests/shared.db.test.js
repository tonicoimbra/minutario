const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Simple in-memory IndexedDB mock
function createMockIndexedDB() {
  var databases = {};

  function MockDB(name, version) {
    this.name = name;
    this.version = version;
    this.objectStoreNames = { _stores: [], contains: function (s) { return this._stores.indexOf(s) !== -1; } };
    this._stores = {};
  }

  MockDB.prototype.createObjectStore = function (name, options) {
    var store = { name: name, keyPath: options ? options.keyPath : null, indexes: {}, data: {} };
    this._stores[name] = store;
    this.objectStoreNames._stores.push(name);
    return {
      createIndex: function (idxName, keyPath, opts) {
        store.indexes[idxName] = { keyPath: keyPath, data: {} };
      },
    };
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
        if (!db) {
          db = new MockDB(name, version);
          databases[name] = db;
          if (req._onupgrade) {
            req.result = db;
            req._onupgrade({ target: req });
          }
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

test("putTemplate and getAllTemplates", async () => {
  var DB = bootstrap();
  var template = { id: "t1", name: "Hello", shortcut: "hi", content: "Hi there", org_id: "o1", updated_at: "2024-01-01T00:00:00Z" };
  await DB.putTemplate(template);
  var all = await DB.getAllTemplates();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "t1");
});

test("getTemplateByShortcut", async () => {
  var DB = bootstrap();
  await DB.putTemplate({ id: "t1", name: "Hello", shortcut: "hi", content: "Hi", org_id: "o1", updated_at: "2024-01-01T00:00:00Z" });
  await DB.putTemplate({ id: "t2", name: "Bye", shortcut: "bye", content: "Bye", org_id: "o1", updated_at: "2024-01-01T00:00:00Z" });
  var found = await DB.getTemplateByShortcut("bye");
  assert.ok(found);
  assert.equal(found.id, "t2");
});

test("deleteAllTemplates clears all templates", async () => {
  var DB = bootstrap();
  await DB.putTemplate({ id: "t1", name: "A", shortcut: "a", content: "A", org_id: "o1", updated_at: "2024-01-01T00:00:00Z" });
  await DB.deleteAllTemplates();
  var all = await DB.getAllTemplates();
  assert.equal(all.length, 0);
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
