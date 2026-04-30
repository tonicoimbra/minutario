(function (global) {
  var CONFIG = global.MinutarioConfig || {};
  var supabaseClient = null;

  function getClient() {
    if (!supabaseClient && global.supabase && typeof global.supabase.createClient === "function") {
      supabaseClient = global.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return supabaseClient;
  }

  function getTemplates(orgId, options) {
    options = options || {};
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    var query = client.from(CONFIG.TEMPLATES_TABLE).select("*").eq("org_id", orgId);
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
    return client.from(CONFIG.TEMPLATES_TABLE).insert(template).select().single().then(function (response) {
      if (response.error) throw response.error;
      return response.data;
    });
  }

  function updateTemplate(id, updates) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.TEMPLATES_TABLE).update(updates).eq("id", id).select().single().then(function (response) {
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

  function searchTemplates(orgId, searchTerm) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.TEMPLATES_TABLE).select("*").eq("org_id", orgId).or("name.ilike.%" + searchTerm + "%,shortcut.ilike.%" + searchTerm + "%").then(function (response) {
      return response.data || [];
    });
  }

  function getFolders(orgId) {
    var client = getClient();
    if (!client) return Promise.reject(new Error("Supabase client not available"));
    return client.from(CONFIG.FOLDERS_TABLE).select("*").eq("org_id", orgId).then(function (response) {
      return response.data || [];
    });
  }

  function subscribeToTemplates(orgId, callback) {
    var client = getClient();
    if (!client) return null;
    return client.channel("templates-changes-" + orgId)
      .on("postgres_changes", { event: "*", schema: "public", table: CONFIG.TEMPLATES_TABLE, filter: "org_id=eq." + orgId }, function (payload) {
        callback(payload);
      })
      .subscribe();
  }

  global.MinutarioAPI = {
    getClient: getClient,
    getTemplates: getTemplates,
    createTemplate: createTemplate,
    updateTemplate: updateTemplate,
    deleteTemplate: deleteTemplate,
    searchTemplates: searchTemplates,
    getFolders: getFolders,
    subscribeToTemplates: subscribeToTemplates,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
