(function (global) {
  var SUPABASE_URL = "https://your-project.supabase.co";
  var SUPABASE_ANON_KEY = "your-anon-key";

  var client = null;

  function getClient() {
    if (!client && global.supabase && global.supabase.createClient) {
      client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  async function init() {
    var sb = getClient();
    if (!sb) return { success: false, error: "Supabase client not available" };

    var result = await sb.auth.getSession();
    var session = result.data && result.data.session ? result.data.session : null;
    return { success: !!session, session: session };
  }

  async function signIn(email, password) {
    var sb = getClient();
    var result = await sb.auth.signInWithPassword({ email: email, password: password });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true, session: result.data.session };
  }

  async function signOut() {
    var sb = getClient();
    await sb.auth.signOut();
    client = null;
    return { success: true };
  }

  async function push(templates, folders) {
    var sb = getClient();
    var userResult = await sb.auth.getUser();
    var user = userResult.data && userResult.data.user ? userResult.data.user : null;
    if (!user) return { success: false, error: "Not authenticated" };

    var userId = user.id;

    var folderRows = (folders || []).map(function (f) {
      return { id: f.id, user_id: userId, name: f.name, order_idx: f.order || 0 };
    });

    if (folderRows.length > 0) {
      await sb.from("folders").upsert(folderRows, { onConflict: "id" });
    }

    var templateRows = Object.values(templates || {}).map(function (t) {
      return {
        id: t.id,
        user_id: userId,
        name: t.name,
        shortcut: t.shortcut,
        content: t.content,
        folder_id: t.folderId || null,
        created_at: new Date(t.createdAt || Date.now()).toISOString(),
        updated_at: new Date(t.updatedAt || Date.now()).toISOString(),
      };
    });

    if (templateRows.length > 0) {
      await sb.from("templates").upsert(templateRows, { onConflict: "id" });
    }

    return { success: true };
  }

  async function pull() {
    var sb = getClient();
    var userResult = await sb.auth.getUser();
    var user = userResult.data && userResult.data.user ? userResult.data.user : null;
    if (!user) return { success: false, error: "Not authenticated" };

    var userId = user.id;

    var templatesResult = await sb.from("templates").select("*").eq("user_id", userId);
    if (templatesResult.error) return { success: false, error: templatesResult.error.message };

    var foldersResult = await sb.from("folders").select("*").eq("user_id", userId);
    if (foldersResult.error) return { success: false, error: foldersResult.error.message };

    return {
      success: true,
      templates: (templatesResult.data || []).map(function (t) {
        return {
          id: t.id,
          name: t.name,
          shortcut: t.shortcut,
          content: t.content,
          folderId: t.folder_id,
          createdAt: new Date(t.created_at).getTime(),
          updatedAt: new Date(t.updated_at).getTime(),
        };
      }),
      folders: (foldersResult.data || []).map(function (f) {
        return { id: f.id, name: f.name, order: f.order_idx };
      }),
    };
  }

  global.SupabaseSync = {
    init: init,
    signIn: signIn,
    signOut: signOut,
    push: push,
    pull: pull,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
