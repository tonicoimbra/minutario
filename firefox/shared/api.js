(function (global) {
  var CONFIG = global.MinutarioConfig || {};
  var supabaseClient = null;
  var AUTH_ACCESS_TOKEN_KEY = "minutario_access_token";
  var AUTH_REFRESH_TOKEN_KEY = "minutario_refresh_token";
  var AUTH_SERVICE_NAME = "com.minutario.desktop.auth";
  var memorySession = null;

  function debugLog(message, details) {
    if (!CONFIG.DEBUG_LOGS || !global.console || typeof global.console.log !== "function") {
      return;
    }

    if (typeof details === "undefined") {
      global.console.log("[MinutarioAPI] " + message);
      return;
    }

    global.console.log("[MinutarioAPI] " + message, details);
  }

  function getClient() {
    if (!supabaseClient && global.supabase && typeof global.supabase.createClient === "function") {
      supabaseClient = global.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return supabaseClient;
  }

  function getExtensionStorageSession() {
    if (!global.chrome || !global.chrome.storage) return null;
    if (!global.chrome.storage.session) return null;
    return global.chrome.storage.session;
  }

  function getExtensionStorageLocal() {
    if (!global.chrome || !global.chrome.storage) return null;
    if (!global.chrome.storage.local) return null;
    return global.chrome.storage.local;
  }

  function getTauriInvoke() {
    try {
      return global.__TAURI__ && global.__TAURI__.core && typeof global.__TAURI__.core.invoke === "function"
        ? global.__TAURI__.core.invoke
        : null;
    } catch (err) {
      return null;
    }
  }

  function readLegacyLocalToken(key) {
    try {
      return global.localStorage && global.localStorage.getItem ? global.localStorage.getItem(key) : null;
    } catch (err) {
      return null;
    }
  }

  function clearLegacyLocalToken(key) {
    try {
      if (global.localStorage && global.localStorage.removeItem) {
        global.localStorage.removeItem(key);
      }
    } catch (err) {
      // ignore
    }
  }

  async function storageGet(area, keys) {
    if (!area || typeof area.get !== "function") return {};
    try {
      return await area.get(keys);
    } catch (err) {
      return {};
    }
  }

  async function storageSet(area, items) {
    if (!area || typeof area.set !== "function") return false;
    try {
      await area.set(items);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function storageRemove(area, keys) {
    if (!area || typeof area.remove !== "function") return;
    try {
      await area.remove(keys);
    } catch (err) {
      // ignore
    }
  }

  async function saveAuthSession(session) {
    if (!session || !session.access_token || !session.refresh_token) {
      return;
    }
    memorySession = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    };

    var tauriInvoke = getTauriInvoke();
    if (tauriInvoke) {
      await tauriInvoke("store_auth_session", {
        service: AUTH_SERVICE_NAME,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      });
      clearLegacyLocalToken(AUTH_ACCESS_TOKEN_KEY);
      clearLegacyLocalToken(AUTH_REFRESH_TOKEN_KEY);
      return;
    }

    var sessionArea = getExtensionStorageSession();
    var savedInSessionArea = await storageSet(sessionArea, {
      [AUTH_ACCESS_TOKEN_KEY]: session.access_token,
      [AUTH_REFRESH_TOKEN_KEY]: session.refresh_token,
    });

    if (!savedInSessionArea) {
      await storageSet(getExtensionStorageLocal(), {
        [AUTH_ACCESS_TOKEN_KEY]: session.access_token,
        [AUTH_REFRESH_TOKEN_KEY]: session.refresh_token,
      });
    }

    clearLegacyLocalToken(AUTH_ACCESS_TOKEN_KEY);
    clearLegacyLocalToken(AUTH_REFRESH_TOKEN_KEY);
  }

  async function clearAuthSession() {
    memorySession = null;

    var tauriInvoke = getTauriInvoke();
    if (tauriInvoke) {
      try {
        await tauriInvoke("clear_auth_session", { service: AUTH_SERVICE_NAME });
      } catch (err) {
        // ignore
      }
    }

    await storageRemove(getExtensionStorageSession(), [AUTH_ACCESS_TOKEN_KEY, AUTH_REFRESH_TOKEN_KEY]);
    await storageRemove(getExtensionStorageLocal(), [AUTH_ACCESS_TOKEN_KEY, AUTH_REFRESH_TOKEN_KEY]);
    clearLegacyLocalToken(AUTH_ACCESS_TOKEN_KEY);
    clearLegacyLocalToken(AUTH_REFRESH_TOKEN_KEY);
  }

  async function readStoredSession() {
    var tauriInvoke = getTauriInvoke();
    var accessToken = null;
    var refreshToken = null;
    var stored = null;

    if (tauriInvoke) {
      try {
        stored = await tauriInvoke("read_auth_session", { service: AUTH_SERVICE_NAME });
        accessToken = stored && stored.access_token ? stored.access_token : null;
        refreshToken = stored && stored.refresh_token ? stored.refresh_token : null;
      } catch (err) {
        accessToken = null;
        refreshToken = null;
      }
      if (accessToken && refreshToken) {
        memorySession = { access_token: accessToken, refresh_token: refreshToken };
        return memorySession;
      }
    }

    if (memorySession && memorySession.access_token && memorySession.refresh_token) {
      return memorySession;
    }

    stored = await storageGet(getExtensionStorageSession(), [AUTH_ACCESS_TOKEN_KEY, AUTH_REFRESH_TOKEN_KEY]);
    accessToken = stored && stored[AUTH_ACCESS_TOKEN_KEY];
    refreshToken = stored && stored[AUTH_REFRESH_TOKEN_KEY];
    if (accessToken && refreshToken) {
      memorySession = { access_token: accessToken, refresh_token: refreshToken };
      return memorySession;
    }

    stored = await storageGet(getExtensionStorageLocal(), [AUTH_ACCESS_TOKEN_KEY, AUTH_REFRESH_TOKEN_KEY]);
    accessToken = stored && stored[AUTH_ACCESS_TOKEN_KEY];
    refreshToken = stored && stored[AUTH_REFRESH_TOKEN_KEY];
    if (accessToken && refreshToken) {
      memorySession = { access_token: accessToken, refresh_token: refreshToken };
      return memorySession;
    }

    accessToken = readLegacyLocalToken(AUTH_ACCESS_TOKEN_KEY);
    refreshToken = readLegacyLocalToken(AUTH_REFRESH_TOKEN_KEY);
    if (accessToken && refreshToken) {
      memorySession = { access_token: accessToken, refresh_token: refreshToken };
      await saveAuthSession(memorySession);
      return memorySession;
    }

    return null;
  }

  async function restoreSessionFromStorage(client) {
    if (!client || !client.auth || !client.auth.getSession || !client.auth.setSession) {
      return null;
    }

    var current = await client.auth.getSession();
    if (current && current.data && current.data.session) {
      return current.data.session;
    }

    var storedSession = await readStoredSession();
    if (!storedSession) {
      return null;
    }

    var result = await client.auth.setSession(storedSession);
    if (result && result.error) {
      throw result.error;
    }

    return result && result.data ? result.data.session : storedSession;
  }

  async function ensureAuthenticatedUser(expectedUserId) {
    var client = getClient();
    if (!client) throw new Error("Supabase client not available");

    if (!client.auth || !client.auth.getUser) {
      return expectedUserId || null;
    }

    await restoreSessionFromStorage(client);

    var result = await client.auth.getUser();
    if (result && result.error) {
      debugLog("Authenticated user lookup failed.", {
        expectedUserId: expectedUserId || null,
        error: result.error.message || String(result.error),
      });
      throw result.error;
    }

    var authUserId = result && result.data && result.data.user ? result.data.user.id : null;
    if (!authUserId) {
      throw new Error("Sessão Supabase ausente. Faça login novamente para sincronizar.");
    }

    if (expectedUserId && authUserId !== expectedUserId) {
      debugLog("Supabase session user mismatch.", {
        expectedUserId: expectedUserId,
        authUserId: authUserId,
      });
      throw new Error("Sessão Supabase pertence a outro usuário. Faça login novamente.");
    }

    return authUserId;
  }

  function normalizeTimestamp(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  function sanitizeTemplatePayload(template) {
    template = template || {};

    var payload = {
      id: template.id || null,
      user_id: template.user_id || null,
      folder_id: template.folder_id !== undefined ? template.folder_id : (template.folderId || null),
      name: template.name || "",
      shortcut: template.shortcut || "",
      content: template.content || template.html_content || "",
      plain_text: template.plain_text || template.plainText || "",
      created_at: normalizeTimestamp(template.created_at || template.createdAt),
      updated_at: normalizeTimestamp(template.updated_at || template.updatedAt),
    };

    if (!payload.created_at) delete payload.created_at;
    if (!payload.updated_at) delete payload.updated_at;

    return payload;
  }

  function sanitizeFolderPayload(folder) {
    folder = folder || {};

    var payload = {
      id: folder.id || null,
      user_id: folder.user_id || null,
      name: folder.name || "",
      order_idx: typeof folder.order_idx === "number" ? folder.order_idx : (typeof folder.order === "number" ? folder.order : 0),
      created_at: normalizeTimestamp(folder.created_at || folder.createdAt),
      updated_at: normalizeTimestamp(folder.updated_at || folder.updatedAt),
    };

    if (!payload.created_at) delete payload.created_at;
    if (!payload.updated_at) delete payload.updated_at;

    return payload;
  }

  async function getTemplates(userId, options) {
    options = options || {};
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var authUserId = await ensureAuthenticatedUser(userId);
    var query = client.from(CONFIG.TEMPLATES_TABLE).select("*").eq("user_id", authUserId);
    if (options.since) {
      query = query.gte("updated_at", options.since);
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }
    var response = await query;
    if (response.error) throw response.error;
    return response.data || [];
  }

  async function createTemplate(template) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var payload = sanitizeTemplatePayload(template);
    payload.user_id = await ensureAuthenticatedUser(payload.user_id);
    var response = await client.from(CONFIG.TEMPLATES_TABLE).insert(payload).select().single();
    if (response.error) throw response.error;
    return response.data;
  }

  async function getTemplateByShortcut(userId, shortcut) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var authUserId = await ensureAuthenticatedUser(userId);
    var response = await client
      .from(CONFIG.TEMPLATES_TABLE)
      .select("*")
      .eq("user_id", authUserId)
      .eq("shortcut", shortcut)
      .limit(1);
    if (response.error) throw response.error;
    return response.data && response.data.length ? response.data[0] : null;
  }

  async function updateTemplate(id, updates) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var payload = sanitizeTemplatePayload(updates);
    payload.user_id = await ensureAuthenticatedUser(payload.user_id);
    var response = await client.from(CONFIG.TEMPLATES_TABLE).update(payload).eq("id", id).eq("user_id", payload.user_id).select().single();
    if (response.error) throw response.error;
    return response.data;
  }

  async function deleteTemplate(id, userId) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var authUserId = await ensureAuthenticatedUser(userId || null);
    var response = await client.from(CONFIG.TEMPLATES_TABLE).delete().eq("id", id).eq("user_id", authUserId);
    if (response.error) throw response.error;
    return true;
  }

  async function searchTemplates(userId, searchTerm) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var authUserId = await ensureAuthenticatedUser(userId);
    // Strip PostgREST filter metacharacters to prevent injection
    var safe = String(searchTerm || "").replace(/[,.()"'\\]/g, "");
    var response = await client.from(CONFIG.TEMPLATES_TABLE).select("*").eq("user_id", authUserId)
      .or("name.ilike.%" + safe + "%,shortcut.ilike.%" + safe + "%");
    if (response.error) throw response.error;
    return response.data || [];
  }

  async function getFolders(userId) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var authUserId = await ensureAuthenticatedUser(userId);
    var response = await client.from(CONFIG.FOLDERS_TABLE).select("*").eq("user_id", authUserId);
    if (response.error) throw response.error;
    return response.data || [];
  }

  async function createFolder(folder) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var payload = sanitizeFolderPayload(folder);
    payload.user_id = await ensureAuthenticatedUser(payload.user_id);
    var response = await client.from(CONFIG.FOLDERS_TABLE).insert(payload).select().single();
    if (response.error) throw response.error;
    return response.data;
  }

  async function updateFolder(id, updates) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var payload = sanitizeFolderPayload(updates);
    payload.user_id = await ensureAuthenticatedUser(payload.user_id);
    var response = await client.from(CONFIG.FOLDERS_TABLE).update(payload).eq("id", id).eq("user_id", payload.user_id).select().single();
    if (response.error) throw response.error;
    return response.data;
  }

  async function deleteFolder(id, userId) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var authUserId = await ensureAuthenticatedUser(userId || null);
    var response = await client.from(CONFIG.FOLDERS_TABLE).delete().eq("id", id).eq("user_id", authUserId);
    if (response.error) throw response.error;
    return true;
  }

  function subscribeToTemplates(userId, callback) {
    var client = getClient();
    if (!client) return null;
    return client.channel("templates-changes-" + userId)
      .on("postgres_changes", { event: "*", schema: "public", table: CONFIG.TEMPLATES_TABLE, filter: "user_id=eq." + userId }, function (payload) {
        callback(payload);
      })
      .subscribe();
  }

  global.MinutarioAPI = {
    getClient: getClient,
    saveAuthSession: saveAuthSession,
    clearAuthSession: clearAuthSession,
    restoreSessionFromStorage: restoreSessionFromStorage,
    ensureAuthenticatedUser: ensureAuthenticatedUser,
    getTemplates: getTemplates,
    getTemplateByShortcut: getTemplateByShortcut,
    createTemplate: createTemplate,
    updateTemplate: updateTemplate,
    deleteTemplate: deleteTemplate,
    searchTemplates: searchTemplates,
    getFolders: getFolders,
    createFolder: createFolder,
    updateFolder: updateFolder,
    deleteFolder: deleteFolder,
    subscribeToTemplates: subscribeToTemplates,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
