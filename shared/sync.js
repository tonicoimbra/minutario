(function (global) {
  var DB = global.MinutarioDB;
  var API = global.MinutarioAPI;
  var CONFIG = global.MinutarioConfig || {};

  var syncState = "idle";
  var listeners = [];

  function setState(newState) {
    syncState = newState;
    listeners.forEach(function (listener) {
      listener(newState);
    });
  }

  function getSyncState() {
    return syncState;
  }

  function onSyncStateChange(listener) {
    listeners.push(listener);
    return function () {
      var idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function mergeTemplates(localTemplates, remoteTemplates) {
    var merged = {};

    localTemplates.forEach(function (t) {
      merged[t.id] = t;
    });

    remoteTemplates.forEach(function (remote) {
      var local = merged[remote.id];
      if (!local) {
        merged[remote.id] = remote;
      } else {
        var localTime = new Date(local.updated_at || local.updatedAt || 0).getTime();
        var remoteTime = new Date(remote.updated_at || remote.updatedAt || 0).getTime();
        if (remoteTime >= localTime) {
          merged[remote.id] = remote;
        }
      }
    });

    return Object.values(merged);
  }

  function mergeFolders(localFolders, remoteFolders) {
    var merged = {};

    localFolders.forEach(function (folder) {
      merged[folder.id] = folder;
    });

    remoteFolders.forEach(function (remote) {
      var local = merged[remote.id];
      if (!local) {
        merged[remote.id] = remote;
      } else {
        var localTime = new Date(local.updated_at || local.updatedAt || 0).getTime();
        var remoteTime = new Date(remote.updated_at || remote.updatedAt || 0).getTime();
        if (remoteTime >= localTime) {
          merged[remote.id] = remote;
        }
      }
    });

    return Object.values(merged);
  }

  function toMillis(value) {
    return new Date(value || 0).getTime();
  }

  function normalizeShortcut(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isDuplicateShortcutError(err) {
    if (!err) return false;
    if (err.code === "23505") return true;
    var msg = String(err.message || "");
    return /idx_templates_user_shortcut/i.test(msg);
  }

  async function saveTemplateLocally(template) {
    if (DB.saveTemplate) {
      await DB.saveTemplate(template);
    } else {
      await DB.putTemplate(template);
    }
  }

  async function pushLocalTemplates(userId, localTemplates, remoteTemplates) {
    if (!API || !API.createTemplate || !API.updateTemplate) {
      return;
    }

    var remoteById = {};
    var remoteByShortcut = {};

    (remoteTemplates || []).forEach(function (remote) {
      remoteById[remote.id] = remote;
      var key = normalizeShortcut(remote.shortcut);
      if (key) remoteByShortcut[key] = remote;
    });

    for (var i = 0; i < (localTemplates || []).length; i++) {
      var local = localTemplates[i];
      var shortcutKey = normalizeShortcut(local.shortcut);

      if (!shortcutKey) {
        continue;
      }

      var payload = Object.assign({}, local, { user_id: userId });
      var remoteMatch = remoteById[payload.id] || remoteByShortcut[shortcutKey] || null;

      if (!remoteMatch) {
        try {
          await API.createTemplate(payload);
          continue;
        } catch (err) {
          if (!isDuplicateShortcutError(err) || !API.getTemplateByShortcut) {
            throw err;
          }

          remoteMatch = await API.getTemplateByShortcut(userId, payload.shortcut);
          if (!remoteMatch) {
            throw err;
          }
        }
      }

      if (payload.id !== remoteMatch.id && DB.deleteTemplate) {
        await DB.deleteTemplate(payload.id);
      }

      payload.id = remoteMatch.id;

      if (toMillis(payload.updated_at || payload.updatedAt) >= toMillis(remoteMatch.updated_at || remoteMatch.updatedAt)) {
        await API.updateTemplate(remoteMatch.id, payload);
      }

      await saveTemplateLocally(payload);
    }
  }

  async function syncTemplates(userId) {
    if (!DB || !API) {
      setState("error");
      throw new Error("MinutarioDB or MinutarioAPI not available");
    }

    setState("syncing");

    try {
      var lastSync = await DB.getMeta(CONFIG.LAST_SYNC_KEY);
      var localTemplates = await DB.getAllTemplates();
      var localFolders = DB.getAllFolders ? await DB.getAllFolders() : [];
      var remoteTemplatesFull = await API.getTemplates(userId);

      await pushLocalTemplates(userId, localTemplates, remoteTemplatesFull);

      localTemplates = await DB.getAllTemplates();
      localFolders = DB.getAllFolders ? await DB.getAllFolders() : [];

      var remoteTemplates = await API.getTemplates(userId, { since: lastSync });
      var remoteFolders = await API.getFolders(userId);

      var merged = mergeTemplates(localTemplates, remoteTemplates);
      var mergedFolders = mergeFolders(localFolders, remoteFolders);

      for (var i = 0; i < merged.length; i++) {
        await DB.putTemplate(merged[i]);
      }

      for (var j = 0; j < mergedFolders.length; j++) {
        if (DB.putFolder) {
          await DB.putFolder(mergedFolders[j]);
        } else if (DB.saveFolder) {
          await DB.saveFolder(mergedFolders[j]);
        }
      }

      var now = new Date().toISOString();
      await DB.setMeta(CONFIG.LAST_SYNC_KEY, now);
      setState("updated");
      return { success: true, count: merged.length, folderCount: mergedFolders.length };
    } catch (err) {
      setState("offline");
      return { success: false, error: err.message };
    }
  }

  async function fullSync(userId) {
    if (!DB || !API) {
      setState("error");
      throw new Error("MinutarioDB or MinutarioAPI not available");
    }

    setState("syncing");

    try {
      var remoteTemplates = await API.getTemplates(userId);
      var remoteFolders = await API.getFolders(userId);
      await DB.deleteAllTemplates();
      if (DB.deleteAllFolders) {
        await DB.deleteAllFolders();
      }

      for (var i = 0; i < remoteTemplates.length; i++) {
        await DB.putTemplate(remoteTemplates[i]);
      }

      for (var j = 0; j < remoteFolders.length; j++) {
        if (DB.putFolder) {
          await DB.putFolder(remoteFolders[j]);
        } else if (DB.saveFolder) {
          await DB.saveFolder(remoteFolders[j]);
        }
      }

      var now = new Date().toISOString();
      await DB.setMeta(CONFIG.LAST_SYNC_KEY, now);
      setState("updated");
      return { success: true, count: remoteTemplates.length, folderCount: remoteFolders.length };
    } catch (err) {
      setState("offline");
      return { success: false, error: err.message };
    }
  }

  global.MinutarioSync = {
    syncTemplates: syncTemplates,
    fullSync: fullSync,
    onSyncStateChange: onSyncStateChange,
    getSyncState: getSyncState,
    mergeTemplates: mergeTemplates,
    mergeFolders: mergeFolders,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
