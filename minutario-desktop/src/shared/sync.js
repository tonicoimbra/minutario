(function (global) {
  var DB = global.MinutarioDB;
  var API = global.MinutarioAPI;
  var CONFIG = global.MinutarioConfig || {};

  var syncState = "idle";
  var listeners = [];
  var CURRENT_USER_META_KEY = "minutario_current_user_id";
  var PENDING_TEMPLATE_DELETES_PREFIX = "minutario_pending_template_deletes";
  var PENDING_FOLDER_DELETES_PREFIX = "minutario_pending_folder_deletes";
  var AUTO_SYNC_DEBOUNCE_MS = 800;
  var AUTO_SYNC_RETRY_MS = 5000;
  var AUTO_SYNC_MAX_RETRIES = 3;
  var autoSyncTimer = null;
  var autoSyncUserId = null;
  var autoSyncReason = null;
  var autoSyncInFlight = false;
  var autoSyncRetryCount = 0;

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

  function getPendingDeleteKey(type, userId) {
    var prefix = type === "folder" ? PENDING_FOLDER_DELETES_PREFIX : PENDING_TEMPLATE_DELETES_PREFIX;
    return prefix + ":" + String(userId || "anonymous");
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

  async function readPendingDeletes(type, userId) {
    var value = await DB.getMeta(getPendingDeleteKey(type, userId));
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  async function writePendingDeletes(type, userId, ids) {
    var unique = [];
    (ids || []).forEach(function (id) {
      if (id && unique.indexOf(id) === -1) unique.push(id);
    });
    await DB.setMeta(getPendingDeleteKey(type, userId), unique);
  }

  async function recordPendingDelete(type, userId, id) {
    if (!userId || !id) return;
    var ids = await readPendingDeletes(type, userId);
    if (ids.indexOf(id) === -1) {
      ids.push(id);
      await writePendingDeletes(type, userId, ids);
    }
    debugLog("Recorded pending delete.", { type: type, userId: userId, id: id });
  }

  async function recordTemplateDelete(userId, id) {
    await recordPendingDelete("template", userId, id);
  }

  async function recordFolderDelete(userId, id) {
    await recordPendingDelete("folder", userId, id);
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

  async function pushLocalFolders(userId, localFolders, remoteFolders) {
    if (!API || !API.createFolder || !API.updateFolder) {
      return;
    }

    var remoteById = {};
    (remoteFolders || []).forEach(function (remote) {
      remoteById[remote.id] = remote;
    });

    for (var i = 0; i < (localFolders || []).length; i++) {
      var local = localFolders[i];
      if (!local || !local.id) continue;

      var payload = Object.assign({}, local, { user_id: userId });
      var remoteMatch = remoteById[payload.id] || null;

      if (!remoteMatch) {
        await API.createFolder(payload);
        continue;
      }

      if (toMillis(payload.updated_at || payload.updatedAt) >= toMillis(remoteMatch.updated_at || remoteMatch.updatedAt)) {
        await API.updateFolder(remoteMatch.id, payload);
      }
    }
  }

  async function pushPendingDeletes(userId) {
    if (!API) return;

    var templateDeletes = await readPendingDeletes("template", userId);
    var remainingTemplateDeletes = [];

    for (var i = 0; i < templateDeletes.length; i++) {
      try {
        if (API.deleteTemplate) {
          await API.deleteTemplate(templateDeletes[i], userId);
        }
      } catch (err) {
        remainingTemplateDeletes.push(templateDeletes[i]);
      }
    }

    await writePendingDeletes("template", userId, remainingTemplateDeletes);

    var folderDeletes = await readPendingDeletes("folder", userId);
    var remainingFolderDeletes = [];

    for (var j = 0; j < folderDeletes.length; j++) {
      try {
        if (API.deleteFolder) {
          await API.deleteFolder(folderDeletes[j], userId);
        }
      } catch (folderErr) {
        remainingFolderDeletes.push(folderDeletes[j]);
      }
    }

    await writePendingDeletes("folder", userId, remainingFolderDeletes);

    if (remainingTemplateDeletes.length || remainingFolderDeletes.length) {
      throw new Error("Há exclusões pendentes que não foram sincronizadas.");
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
      var remoteFoldersFull = await API.getFolders(userId);

      // Read pending deletes BEFORE pushing them — we need these IDs to
      // filter the merge result so deleted items are not re-added locally
      var pendingTemplateDeleteIds = await readPendingDeletes("template", userId);
      var pendingFolderDeleteIds = await readPendingDeletes("folder", userId);

      debugLog("Starting incremental sync.", {
        userId: userId,
        lastSyncKey: lastSyncKey,
        lastSync: lastSync || null,
        localCount: localTemplates.length,
        localFolderCount: localFolders.length,
        remoteCount: remoteTemplatesFull.length,
        remoteFolderCount: remoteFoldersFull.length,
        pendingTemplateDeletes: pendingTemplateDeleteIds.length,
        pendingFolderDeletes: pendingFolderDeleteIds.length,
      });

      await pushPendingDeletes(userId);
      await pushLocalFolders(userId, localFolders, remoteFoldersFull);
      await pushLocalTemplates(userId, localTemplates, remoteTemplatesFull);

      localTemplates = filterTemplatesForUser(await DB.getAllTemplates(), userId);
      localFolders = filterFoldersForUser(DB.getAllFolders ? await DB.getAllFolders() : [], userId);

      var shouldFullPullTemplates = options.forceFullPull || !lastSync || localTemplates.length === 0;
      var shouldFullPullFolders = options.forceFullPull || !lastSync || localFolders.length === 0;

      var remoteTemplates = shouldFullPullTemplates
        ? await API.getTemplates(userId)
        : await API.getTemplates(userId, { since: lastSync });
      var remoteFolders = shouldFullPullFolders ? remoteFoldersFull : await API.getFolders(userId);

      var merged = mergeTemplates(localTemplates, remoteTemplates);
      var mergedFolders = mergeFolders(localFolders, remoteFolders);

      // Filter out items that were pending deletion — prevents re-insertion
      // of remotely fetched records whose delete may not have propagated yet
      if (pendingTemplateDeleteIds.length > 0) {
        merged = merged.filter(function(t) {
          return pendingTemplateDeleteIds.indexOf(t.id) === -1;
        });
      }
      if (pendingFolderDeleteIds.length > 0) {
        mergedFolders = mergedFolders.filter(function(f) {
          return pendingFolderDeleteIds.indexOf(f.id) === -1;
        });
      }

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

      // Also clean up local DB in case any deleted item was re-introduced
      for (var di = 0; di < pendingTemplateDeleteIds.length; di++) {
        try { await DB.deleteTemplate(pendingTemplateDeleteIds[di]); } catch (e) { /* ignore */ }
      }
      for (var dj = 0; dj < pendingFolderDeleteIds.length; dj++) {
        try { await DB.deleteFolder(pendingFolderDeleteIds[dj]); } catch (e) { /* ignore */ }
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

  function scheduleAutoSyncRetry(userId, reason) {
    if (autoSyncRetryCount >= AUTO_SYNC_MAX_RETRIES) {
      debugLog("Auto sync retry limit reached.", {
        userId: userId,
        reason: reason,
        retries: autoSyncRetryCount,
      });
      return;
    }

    autoSyncRetryCount += 1;
    debugLog("Scheduling auto sync retry.", {
      userId: userId,
      reason: reason,
      retry: autoSyncRetryCount,
    });

    if (autoSyncTimer) {
      global.clearTimeout(autoSyncTimer);
    }

    autoSyncTimer = global.setTimeout(function () {
      void runAutoSync();
    }, AUTO_SYNC_RETRY_MS);
  }

  async function runAutoSync() {
    if (autoSyncInFlight) {
      return { success: false, error: "Sincronização já em andamento" };
    }

    var targetUserId = autoSyncUserId;
    var reason = autoSyncReason;
    autoSyncTimer = null;

    if (!targetUserId) {
      return { success: false, error: "Usuário não definido para sync automático" };
    }

    autoSyncInFlight = true;
    debugLog("Running auto sync.", { userId: targetUserId, reason: reason || "unknown" });

    try {
      var result = await syncTemplates(targetUserId);
      if (result && result.success) {
        autoSyncRetryCount = 0;
        return result;
      }

      scheduleAutoSyncRetry(targetUserId, reason);
      return result || { success: false, error: "Erro ao sincronizar" };
    } finally {
      autoSyncInFlight = false;
    }
  }

  function enqueueAutoSync(userId, reason, options) {
    options = options || {};
    if (!userId) {
      return Promise.resolve({ success: false, error: "Usuário não definido para sync automático" });
    }

    autoSyncUserId = userId;
    autoSyncReason = reason || autoSyncReason || "mutation";

    if (autoSyncTimer) {
      global.clearTimeout(autoSyncTimer);
    }

    return new Promise(function (resolve) {
      var delay = options.immediate ? 0 : AUTO_SYNC_DEBOUNCE_MS;
      autoSyncTimer = global.setTimeout(function () {
        runAutoSync().then(resolve).catch(function (err) {
          scheduleAutoSyncRetry(userId, reason);
          resolve({ success: false, error: err && err.message ? err.message : String(err) });
        });
      }, delay);
    });
  }

  function flushAutoSync(userId, reason) {
    return enqueueAutoSync(userId, reason, { immediate: true });
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

      // Push pending deletes to Supabase FIRST so they're gone when we pull
      var pendingTemplateDeleteIds = await readPendingDeletes("template", userId);
      var pendingFolderDeleteIds = await readPendingDeletes("folder", userId);
      await pushPendingDeletes(userId);

      var lastSyncKey = getLastSyncKey(userId);
      var remoteTemplates = await API.getTemplates(userId);
      var remoteFolders = await API.getFolders(userId);

      // Safety filter: exclude any items whose delete may not have propagated
      if (pendingTemplateDeleteIds.length > 0) {
        remoteTemplates = remoteTemplates.filter(function(t) {
          return pendingTemplateDeleteIds.indexOf(t.id) === -1;
        });
      }
      if (pendingFolderDeleteIds.length > 0) {
        remoteFolders = remoteFolders.filter(function(f) {
          return pendingFolderDeleteIds.indexOf(f.id) === -1;
        });
      }

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
    enqueueAutoSync: enqueueAutoSync,
    flushAutoSync: flushAutoSync,
    recordTemplateDelete: recordTemplateDelete,
    recordFolderDelete: recordFolderDelete,
    getLastSyncKey: getLastSyncKey,
    mergeTemplates: mergeTemplates,
    mergeFolders: mergeFolders,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
