importScripts(
  "lib/supabase.min.js",
  "shared/config.js",
  "shared/db.js",
  "shared/api.js",
  "shared/sync.js"
);

const STORAGE_VERSION_KEY = "storageVersion";
const CURRENT_STORAGE_VERSION = 1;
const RECENT_KEY = "recent";
const MAX_RECENT = 3;
const SYNC_ALARM_NAME = "minutario-sync";
const SYNC_INTERVAL_MINUTES = 5;
const QUICK_ACCESS_WINDOW_WIDTH = 1120;
const QUICK_ACCESS_WINDOW_HEIGHT = 760;

const migrationState = {
  failed: false,
};

function getErrorMessage(exception) {
  if (!exception) {
    return "";
  }

  if (typeof exception === "string") {
    return exception;
  }

  if (typeof exception.message === "string") {
    return exception.message;
  }

  if (exception.lastError && typeof exception.lastError.message === "string") {
    return exception.lastError.message;
  }

  if (exception.cause) {
    var causeMessage = getErrorMessage(exception.cause);
    if (causeMessage) {
      return causeMessage;
    }
  }

  if (exception.error) {
    var nestedErrorMessage = getErrorMessage(exception.error);
    if (nestedErrorMessage) {
      return nestedErrorMessage;
    }
  }

  try {
    var serialized = JSON.stringify(exception);
    if (serialized && serialized !== "{}") {
      return serialized;
    }
  } catch (serializationError) {
    // Ignore serialization failures and continue to generic string conversion.
  }

  try {
    return String(exception);
  } catch (error) {
    return "";
  }
}

function isBenignStorageMigrationError(exception) {
  var message = getErrorMessage(exception).toLowerCase();
  return message.indexOf("context invalidated") !== -1;
}

function logMigrationError(step, key, exception) {
  if (isBenignStorageMigrationError(exception)) {
    return;
  }

  console.error("Storage migration error", {
    step,
    key,
    message: getErrorMessage(exception),
    exception,
  });
}

function handleMigrationError(step, key, exception) {
  if (isBenignStorageMigrationError(exception)) {
    return false;
  }

  migrationState.failed = true;
  logMigrationError(step, key, exception);
  return true;
}

async function applyMigration(step) {
  if (step === 1) {
    return;
  }
}

async function runStartupMigration() {
  let storedVersion = 0;

  try {
    const stored = await chrome.storage.local.get(STORAGE_VERSION_KEY);
    const rawVersion = stored[STORAGE_VERSION_KEY];
    storedVersion = Number.isInteger(rawVersion) ? rawVersion : 0;
  } catch (error) {
    handleMigrationError("read", STORAGE_VERSION_KEY, error);
    return;
  }

  if (storedVersion >= CURRENT_STORAGE_VERSION) {
    return;
  }

  for (let step = storedVersion + 1; step <= CURRENT_STORAGE_VERSION; step += 1) {
    try {
      await applyMigration(step);
    } catch (error) {
      handleMigrationError(step, "migration", error);
      return;
    }
  }

  try {
    await chrome.storage.local.set({ [STORAGE_VERSION_KEY]: CURRENT_STORAGE_VERSION });
  } catch (error) {
    handleMigrationError("write", STORAGE_VERSION_KEY, error);
  }
}

const migrationPromise = runStartupMigration();

async function openDashboard(payload) {
  const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html");
  const tabs = await chrome.tabs.query({ url: dashboardUrl });
  const existingTab = tabs[0];

  if (existingTab && payload?.focusExisting !== false) {
    if (typeof existingTab.id === "number") {
      await chrome.tabs.update(existingTab.id, { active: true });
    }

    if (typeof existingTab.windowId === "number") {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }

  return { ok: true, data: null };
}

async function openQuickAccess(payload) {
  const quickAccessUrl = chrome.runtime.getURL("quick-access/quick-access.html");
  const existingTabs = await chrome.tabs.query({ url: quickAccessUrl });
  const existingTab = existingTabs[0];

  if (existingTab && payload?.focusExisting !== false) {
    if (typeof existingTab.id === "number") {
      await chrome.tabs.update(existingTab.id, { active: true });
    }

    if (typeof existingTab.windowId === "number") {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }

    return { ok: true, data: { reused: true } };
  }

  await chrome.windows.create({
    url: quickAccessUrl,
    type: "popup",
    width: QUICK_ACCESS_WINDOW_WIDTH,
    height: QUICK_ACCESS_WINDOW_HEIGHT,
    focused: true,
  });

  return { ok: true, data: { reused: false } };
}

async function getTemplates(payload) {
  let templates = [];

  try {
    if (typeof MinutarioDB !== "undefined" && MinutarioDB.getAllTemplates) {
      templates = await MinutarioDB.getAllTemplates();
    } else {
      const allItems = await chrome.storage.sync.get(null);
      templates = Object.entries(allItems)
        .filter(([key]) => key.startsWith("tpl_"))
        .map(([, value]) => value)
        .filter((value) => Boolean(value && typeof value === "object"));
    }
  } catch (error) {
    console.error("Failed to get templates:", error);
  }

  if (payload && Object.prototype.hasOwnProperty.call(payload, "folderId")) {
    templates = templates.filter((template) => {
      var folderId = template.folderId || template.folder_id || null;
      return folderId === payload.folderId;
    });
  }

  const rawQuery = typeof payload?.query === "string" ? payload.query.trim().toLowerCase() : "";
  if (rawQuery) {
    templates = templates.filter((template) => {
      const name = typeof template.name === "string" ? template.name.toLowerCase() : "";
      const shortcut = typeof template.shortcut === "string" ? template.shortcut.toLowerCase() : "";
      return name.includes(rawQuery) || shortcut.includes(rawQuery);
    });
  }

  return { ok: true, data: templates };
}

async function getFolders() {
  var folders = [];

  try {
    if (typeof MinutarioDB !== "undefined" && MinutarioDB.getAllFolders) {
      folders = await MinutarioDB.getAllFolders();
    }
  } catch (error) {
    console.error("Failed to get folders:", error);
  }

  folders.sort(function (a, b) {
    var orderA = typeof a.order_idx === "number" ? a.order_idx : typeof a.order === "number" ? a.order : 0;
    var orderB = typeof b.order_idx === "number" ? b.order_idx : typeof b.order === "number" ? b.order : 0;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return { ok: true, data: folders };
}

async function getRecent() {
  try {
    const stored = await chrome.storage.local.get(RECENT_KEY);
    const recent = Array.isArray(stored[RECENT_KEY]) ? stored[RECENT_KEY] : [];
    return { ok: true, data: recent.slice(0, MAX_RECENT) };
  } catch (error) {
    return { ok: false, error: error?.message || "Failed to load recent templates" };
  }
}

async function updateRecent(payload) {
  const templateId = payload?.templateId;

  if (typeof templateId !== "string" || templateId.length === 0) {
    return { ok: false, error: "Invalid templateId" };
  }

  const stored = await chrome.storage.local.get(RECENT_KEY);
  const current = Array.isArray(stored[RECENT_KEY]) ? stored[RECENT_KEY] : [];

  const deduped = [templateId, ...current.filter((id) => id !== templateId)];
  const recent = deduped.slice(0, MAX_RECENT);

  await chrome.storage.local.set({ [RECENT_KEY]: recent });
  return { ok: true };
}

async function performSync() {
  try {
    const stored = await chrome.storage.local.get("minutario_user_id");
    const userId = stored.minutario_user_id;

    if (!userId) {
      return { updated: false, error: "No user ID configured" };
    }

    if (typeof MinutarioSync === "undefined" || !MinutarioSync.syncTemplates) {
      return { updated: false, error: "Sync module not available" };
    }

    const result = await MinutarioSync.syncTemplates(userId);

    if (result.success) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (typeof tab.id === "number") {
          try {
            await chrome.tabs.sendMessage(tab.id, { type: "TEMPLATES_UPDATED" });
          } catch (e) {
            // Tab may not have content script loaded
          }
        }
      }
      return { updated: true, count: result.count };
    }

    return { updated: false, error: result.error };
  } catch (error) {
    console.error("Sync failed:", error);
    return { updated: false, error: error?.message || "Unknown error" };
  }
}

// Alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    void performSync();
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-quick-access") {
    void openQuickAccess({ focusExisting: true });
  }
});

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    await migrationPromise;

    if (migrationState.failed) {
      sendResponse({ ok: false, error: "Storage migration failed" });
      return;
    }

    try {
      switch (message?.type) {
        case "OPEN_DASHBOARD": {
          sendResponse(await openDashboard(message.payload));
          return;
        }
        case "OPEN_QUICK_ACCESS": {
          sendResponse(await openQuickAccess(message.payload));
          return;
        }
        case "GET_TEMPLATES": {
          sendResponse(await getTemplates(message.payload));
          return;
        }
        case "GET_FOLDERS": {
          sendResponse(await getFolders());
          return;
        }
        case "GET_RECENT": {
          sendResponse(await getRecent());
          return;
        }
        case "UPDATE_RECENT": {
          sendResponse(await updateRecent(message.payload));
          return;
        }
        case "FORCE_SYNC": {
          const result = await performSync();
          sendResponse({ ok: true, data: result });
          return;
        }
        case "GET_SYNC_STATE": {
          const state =
            typeof MinutarioSync !== "undefined" && MinutarioSync.getSyncState
              ? MinutarioSync.getSyncState()
              : "idle";
          sendResponse({ ok: true, data: { state } });
          return;
        }
        default: {
          sendResponse({ ok: false, error: "Unknown message type" });
        }
      }
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Unexpected error" });
    }
  })();

  return true;
});
