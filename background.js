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

const migrationState = {
  failed: false,
};

function logMigrationError(step, key, exception) {
  console.error("Storage migration error", { step, key, exception });
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
    migrationState.failed = true;
    logMigrationError("read", STORAGE_VERSION_KEY, error);
    return;
  }

  if (storedVersion >= CURRENT_STORAGE_VERSION) {
    return;
  }

  for (let step = storedVersion + 1; step <= CURRENT_STORAGE_VERSION; step += 1) {
    try {
      await applyMigration(step);
    } catch (error) {
      migrationState.failed = true;
      logMigrationError(step, "migration", error);
      return;
    }
  }

  try {
    await chrome.storage.local.set({ [STORAGE_VERSION_KEY]: CURRENT_STORAGE_VERSION });
  } catch (error) {
    migrationState.failed = true;
    logMigrationError("write", STORAGE_VERSION_KEY, error);
  }
}

const migrationPromise = runStartupMigration();

async function openDashboard(payload) {
  const dashboardUrl = chrome.runtime.getURL("dashboard/index.html");
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
    templates = templates.filter((template) => template.folderId === payload.folderId);
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
    const stored = await chrome.storage.local.get("minutario_org_id");
    const orgId = stored.minutario_org_id;

    if (!orgId) {
      return { updated: false, error: "No org ID configured" };
    }

    if (typeof MinutarioSync === "undefined" || !MinutarioSync.syncTemplates) {
      return { updated: false, error: "Sync module not available" };
    }

    const result = await MinutarioSync.syncTemplates(orgId);

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
        case "GET_TEMPLATES": {
          sendResponse(await getTemplates(message.payload));
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
