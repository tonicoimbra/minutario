(function (global) {
  var CONFIG = global.MinutarioConfig || {};

  function ensureIndex(store, name, keyPath, options) {
    if (!store.indexNames || !store.indexNames.contains || !store.indexNames.contains(name)) {
      store.createIndex(name, keyPath, options);
    }
  }

  function deleteIndexIfExists(store, name) {
    if (store.indexNames && store.indexNames.contains && store.indexNames.contains(name)) {
      store.deleteIndex(name);
    }
  }

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
        var upgradeTransaction = event.target.transaction;

        if (!db.objectStoreNames.contains("templates")) {
          var templatesStore = db.createObjectStore("templates", { keyPath: "id" });
          templatesStore.createIndex("shortcut", "shortcut", { unique: false });
          templatesStore.createIndex("user_id", "user_id", { unique: false });
        } else if (upgradeTransaction) {
          var existingTemplatesStore = upgradeTransaction.objectStore("templates");
          ensureIndex(existingTemplatesStore, "shortcut", "shortcut", { unique: false });
          deleteIndexIfExists(existingTemplatesStore, "org_id");
          ensureIndex(existingTemplatesStore, "user_id", "user_id", { unique: false });
        }

        if (!db.objectStoreNames.contains("folders")) {
          var foldersStore = db.createObjectStore("folders", { keyPath: "id" });
          foldersStore.createIndex("user_id", "user_id", { unique: false });
        } else if (upgradeTransaction) {
          var existingFoldersStore = upgradeTransaction.objectStore("folders");
          ensureIndex(existingFoldersStore, "user_id", "user_id", { unique: false });
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

  function saveTemplate(template) {
    return putTemplate(template);
  }

  function putFolder(folder) {
    return withStore("folders", "readwrite", function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.put(folder);
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function saveFolder(folder) {
    return putFolder(folder);
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

  function getAllFolders() {
    return withStore("folders", "readonly", function (store) {
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

  function deleteTemplate(id) {
    return withStore("templates", "readwrite", function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.delete(id);
        request.onsuccess = function () {
          resolve();
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function deleteFolder(id) {
    return withStore("folders", "readwrite", function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.delete(id);
        request.onsuccess = function () {
          resolve();
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function deleteAllFolders() {
    return withStore("folders", "readwrite", function (store) {
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
    saveTemplate: saveTemplate,
    putFolder: putFolder,
    saveFolder: saveFolder,
    getAllTemplates: getAllTemplates,
    getAllFolders: getAllFolders,
    getTemplateByShortcut: getTemplateByShortcut,
    deleteAllTemplates: deleteAllTemplates,
    deleteTemplate: deleteTemplate,
    deleteFolder: deleteFolder,
    deleteAllFolders: deleteAllFolders,
    setMeta: setMeta,
    getMeta: getMeta,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
