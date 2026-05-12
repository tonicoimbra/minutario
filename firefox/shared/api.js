(function (global) {
  var CONFIG = global.MinutarioConfig || {};
  var supabaseClient = null;

  function getClient() {
    if (!supabaseClient && global.supabase && typeof global.supabase.createClient === "function") {
      supabaseClient = global.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return supabaseClient;
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

  function getTemplates(userId, options) {
    options = options || {};
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var query = client.from(CONFIG.TEMPLATES_TABLE).select("*").eq("user_id", userId);
    if (options.since) {
      query = query.gte("updated_at", options.since);
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }
    return query.then(function (response) {
      return response.data || [];
    });
  }

  function createTemplate(template) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.TEMPLATES_TABLE).insert(sanitizeTemplatePayload(template)).select().single().then(function (response) {
      if (response.error) throw response.error;
      return response.data;
    });
  }

  function getTemplateByShortcut(userId, shortcut) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client
      .from(CONFIG.TEMPLATES_TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("shortcut", shortcut)
      .limit(1)
      .then(function (response) {
        if (response.error) throw response.error;
        return response.data && response.data.length ? response.data[0] : null;
      });
  }

  function updateTemplate(id, updates) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.TEMPLATES_TABLE).update(sanitizeTemplatePayload(updates)).eq("id", id).select().single().then(function (response) {
      if (response.error) throw response.error;
      return response.data;
    });
  }

  function deleteTemplate(id) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.TEMPLATES_TABLE).delete().eq("id", id).then(function (response) {
      if (response.error) throw response.error;
      return true;
    });
  }

  function searchTemplates(userId, searchTerm) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    // Strip PostgREST filter metacharacters to prevent injection
    var safe = String(searchTerm || "").replace(/[,.()"'\\]/g, "");
    return client.from(CONFIG.TEMPLATES_TABLE).select("*").eq("user_id", userId)
      .or("name.ilike.%" + safe + "%,shortcut.ilike.%" + safe + "%")
      .then(function (response) {
        return response.data || [];
      });
  }

  function getFolders(userId) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.FOLDERS_TABLE).select("*").eq("user_id", userId).then(function (response) {
      return response.data || [];
    });
  }

  function createFolder(folder) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.FOLDERS_TABLE).insert(sanitizeFolderPayload(folder)).select().single().then(function (response) {
      if (response.error) throw response.error;
      return response.data;
    });
  }

  function deleteFolder(id) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.FOLDERS_TABLE).delete().eq("id", id).then(function (response) {
      if (response.error) throw response.error;
      return true;
    });
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
    getTemplates: getTemplates,
    getTemplateByShortcut: getTemplateByShortcut,
    createTemplate: createTemplate,
    updateTemplate: updateTemplate,
    deleteTemplate: deleteTemplate,
    searchTemplates: searchTemplates,
    getFolders: getFolders,
    createFolder: createFolder,
    deleteFolder: deleteFolder,
    subscribeToTemplates: subscribeToTemplates,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
