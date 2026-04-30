(function (global) {
  var CONFIG = global.MinutarioConfig || {};

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = global.indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

      request.onerror = function () {
        reject(request.error);
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onupgradeneeded = function (event) {
        var db = event.target.result;

        if (!db.objectStoreNames.contains("templates")) {
          var templatesStore = db.createObjectStore("templates", { keyPath: "id" });
          templatesStore.createIndex("shortcut", "shortcut", { unique: false });
          templatesStore.createIndex("org_id", "org_id", { unique: false });
        }

        if (!db.objectStoreNames.contains("folders")) {
          db.createObjectStore("folders", { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
    });
  }

  function withStore(storeName, mode, callback) {
    return new Promise(function (resolve, reject) {
      openDatabase().then(function (db) {
        var transaction = db.transaction([storeName], mode);
        var store = transaction.objectStore(storeName);
        var result = callback(store);
        if (result && typeof result.then === "function") {
          result.then(resolve).catch(reject);
        } else {
          resolve(result);
        }
        transaction.onerror = function () {
          reject(transaction.error);
        };
      }).catch(reject);
    });
  }

  function putTemplate(template) {
    return withStore("templates", "readwrite", function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.put(template);
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function getAllTemplates() {
    return withStore("templates", "readonly", function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.getAll();
        request.onsuccess = function () {
          resolve(request.result || []);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function getTemplateByShortcut(shortcut) {
    return withStore("templates", "readonly", function (store) {
      return new Promise(function (resolve, reject) {
        var index = store.index("shortcut");
        var request = index.getAll(shortcut);
        request.onsuccess = function () {
          var results = request.result || [];
          resolve(results.length > 0 ? results[0] : null);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function deleteAllTemplates() {
    return withStore("templates", "readwrite", function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.clear();
        request.onsuccess = function () {
          resolve();
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function setMeta(key, value) {
    return withStore("meta", "readwrite", function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.put({ key: key, value: value });
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function getMeta(key) {
    return withStore("meta", "readonly", function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.get(key);
        request.onsuccess = function () {
          var result = request.result;
          resolve(result ? result.value : undefined);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  global.MinutarioDB = {
    open: openDatabase,
    putTemplate: putTemplate,
    getAllTemplates: getAllTemplates,
    getTemplateByShortcut: getTemplateByShortcut,
    deleteAllTemplates: deleteAllTemplates,
    setMeta: setMeta,
    getMeta: getMeta,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
