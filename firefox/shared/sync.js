(function (global) {
  var DB = global.MinutarioDB;
  var API = global.MinutarioAPI;
  var CONFIG = global.MinutarioConfig || {};

  var syncState = "idle";
  var listeners = [];
  var CURRENT_USER_META_KEY = "minutario_current_user_id";

  function debugLog(message, details) {
    if (!CONFIG.DEBUG_LOGS || !global.console || typeof global.console.log !== "function") {
      return;
    }

    if (typeof details === "undefined") {
      global.console.log("[MinutarioSync] " + message);
      return;
    }

    global.console.log("[MinutarioSync] " + message, details);
  }

  function getLastSyncKey(userId) {
    return String(CONFIG.LAST_SYNC_KEY || "minutario_last_sync") + ":" + String(userId || "anonymous");
  }

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

  function filterTemplatesForUser(templates, userId) {
    return (templates || []).filter(function (template) {
      return !template.user_id || template.user_id === userId;
    });
  }

  function filterFoldersForUser(folders, userId) {
    return (folders || []).filter(function (folder) {
      return !folder.user_id || folder.user_id === userId;
    });
  }

  async function clearLocalData() {
    await DB.deleteAllTemplates();
    if (DB.deleteAllFolders) {
      await DB.deleteAllFolders();
    }
  }

  async function prepareUserContext(userId, previousUserId) {
    var storedUserId = await DB.getMeta(CURRENT_USER_META_KEY);
    var effectivePreviousUserId = previousUserId || storedUserId || null;

    if (effectivePreviousUserId && effectivePreviousUserId !== userId) {
      debugLog("User switch detected. Clearing local IndexedDB before full sync.", {
        previousUserId: effectivePreviousUserId,
        nextUserId: userId,
      });

      await clearLocalData();
      await DB.setMeta(getLastSyncKey(userId), null);
      await DB.setMeta(CURRENT_USER_META_KEY, userId);
      return true;
    }

    if (!storedUserId) {
      await DB.setMeta(CURRENT_USER_META_KEY, userId);
    }

    return false;
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

  async function syncTemplates(userId, options) {
    options = options || {};

    if (!DB || !API) {
      setState("error");
      throw new Error("MinutarioDB or MinutarioAPI not available");
    }

    setState("syncing");

    try {
      if (!options.skipUserContext) {
        var userChanged = await prepareUserContext(userId, options.previousUserId);
        if (userChanged) {
          return await fullSync(userId, { skipUserContext: true });
        }
      }

      var lastSyncKey = getLastSyncKey(userId);
      var lastSync = await DB.getMeta(lastSyncKey);
      var localTemplates = filterTemplatesForUser(await DB.getAllTemplates(), userId);
      var localFolders = filterFoldersForUser(DB.getAllFolders ? await DB.getAllFolders() : [], userId);
      var remoteTemplatesFull = await API.getTemplates(userId);

      debugLog("Starting incremental sync.", {
        userId: userId,
        lastSyncKey: lastSyncKey,
        lastSync: lastSync || null,
        localCount: localTemplates.length,
        remoteCount: remoteTemplatesFull.length,
      });

      await pushLocalTemplates(userId, localTemplates, remoteTemplatesFull);

      localTemplates = filterTemplatesForUser(await DB.getAllTemplates(), userId);
      localFolders = filterFoldersForUser(DB.getAllFolders ? await DB.getAllFolders() : [], userId);

      var remoteTemplates = options.forceFullPull
        ? await API.getTemplates(userId)
        : await API.getTemplates(userId, { since: lastSync });
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
      await DB.setMeta(lastSyncKey, now);
      await DB.setMeta(CURRENT_USER_META_KEY, userId);
      setState("updated");
      return { success: true, count: merged.length, folderCount: mergedFolders.length };
    } catch (err) {
      debugLog("Sync failed.", { userId: userId, error: err && err.message ? err.message : String(err) });
      setState("offline");
      return { success: false, error: err.message };
    }
  }

  async function fullSync(userId, options) {
    options = options || {};

    if (!DB || !API) {
      setState("error");
      throw new Error("MinutarioDB or MinutarioAPI not available");
    }

    setState("syncing");

    try {
      if (!options.skipUserContext) {
        await prepareUserContext(userId, options.previousUserId);
      }

      var lastSyncKey = getLastSyncKey(userId);
      var remoteTemplates = await API.getTemplates(userId);
      var remoteFolders = await API.getFolders(userId);

      debugLog("Starting full sync.", {
        userId: userId,
        lastSyncKey: lastSyncKey,
        remoteCount: remoteTemplates.length,
        remoteFolderCount: remoteFolders.length,
      });

      await clearLocalData();

      for (var i = 0; i < remoteTemplates.length; i++) {
        await DB.putTemplate(Object.assign({}, remoteTemplates[i], { user_id: userId }));
      }

      for (var j = 0; j < remoteFolders.length; j++) {
        var folder = Object.assign({}, remoteFolders[j], { user_id: userId });
        if (DB.putFolder) {
          await DB.putFolder(folder);
        } else if (DB.saveFolder) {
          await DB.saveFolder(folder);
        }
      }

      var now = new Date().toISOString();
      await DB.setMeta(lastSyncKey, now);
      await DB.setMeta(CURRENT_USER_META_KEY, userId);
      setState("updated");
      return { success: true, count: remoteTemplates.length, folderCount: remoteFolders.length };
    } catch (err) {
      debugLog("Full sync failed.", { userId: userId, error: err && err.message ? err.message : String(err) });
      setState("offline");
      return { success: false, error: err.message };
    }
  }

  global.MinutarioSync = {
    syncTemplates: syncTemplates,
    fullSync: fullSync,
    onSyncStateChange: onSyncStateChange,
    getSyncState: getSyncState,
    prepareUserContext: prepareUserContext,
    getLastSyncKey: getLastSyncKey,
    mergeTemplates: mergeTemplates,
    mergeFolders: mergeFolders,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
