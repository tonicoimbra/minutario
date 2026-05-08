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

  async function syncTemplates(userId) {
    if (!DB || !API) {
      setState("error");
      throw new Error("MinutarioDB or MinutarioAPI not available");
    }

    setState("syncing");

    try {
      var lastSync = await DB.getMeta(CONFIG.LAST_SYNC_KEY);
      var remoteTemplates = await API.getTemplates(userId, { since: lastSync });
      var remoteFolders = await API.getFolders(userId);
      var localTemplates = await DB.getAllTemplates();
      var localFolders = DB.getAllFolders ? await DB.getAllFolders() : [];

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
