(function (global) {
  var invoke = null;

  function ensureInvoke() {
    if (invoke) return;
    if (global.window && global.window.__TAURI__ && global.window.__TAURI__.core) {
      invoke = global.window.__TAURI__.core.invoke;
    }
    if (!invoke) {
      throw new Error("Tauri core.invoke not available");
    }
  }

  function call(cmd, args) {
    ensureInvoke();
    return invoke(cmd, args);
  }

  function getAllTemplates() {
    var userId = localStorage.getItem("minutario_user_id");
    if (!userId) return Promise.resolve([]);
    return call("get_templates", { userId: userId });
  }

  function saveTemplate(tpl) {
    return call("save_template", { tpl: tpl });
  }

  function putTemplate(tpl) {
    return saveTemplate(tpl);
  }

  function deleteTemplate(id) {
    return call("delete_template", { id: id });
  }

  function deleteAllTemplates() {
    var userId = localStorage.getItem("minutario_user_id");
    if (!userId) return Promise.resolve();
    return call("delete_all_templates", { userId: userId });
  }

  function getTemplateByShortcut(shortcut) {
    var userId = localStorage.getItem("minutario_user_id");
    if (!userId) return Promise.resolve(null);
    return call("get_template_by_shortcut", { userId: userId, shortcut: shortcut });
  }

  function getAllFolders() {
    var userId = localStorage.getItem("minutario_user_id");
    if (!userId) return Promise.resolve([]);
    return call("get_folders", { userId: userId });
  }

  function saveFolder(folder) {
    return call("save_folder", { folder: folder });
  }

  function putFolder(folder) {
    return saveFolder(folder);
  }

  function deleteFolder(id) {
    return call("delete_folder", { id: id });
  }

  function deleteAllFolders() {
    var userId = localStorage.getItem("minutario_user_id");
    if (!userId) return Promise.resolve();
    return call("delete_all_folders", { userId: userId });
  }

  function setMeta(key, value) {
    var serialized = JSON.stringify(value);
    if (typeof serialized === "undefined") serialized = "null";
    return call("set_setting", { key: key, value: serialized });
  }

  function getMeta(key) {
    return call("get_setting", { key: key }).then(function (result) {
      if (result === null || result === undefined) return undefined;

      try {
        return JSON.parse(result);
      } catch (err) {
        return result;
      }
    });
  }

  function open() {
    return Promise.resolve();
  }

  global.MinutarioDB = {
    open: open,
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
    generateId: function () {
      return call("generate_id", {});
    },
    nowIso: function () {
      return call("now_iso", {});
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
