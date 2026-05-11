(function (global) {
  var DB = global.MinutarioDB;

  var SyncManager = {
    csv: global.CsvSync,
    supabase: global.SupabaseSync,

    async syncAll(source) {
      switch (source) {
        case "supabase":
          if (!DB || !DB.getAllTemplates) {
            return { success: false, error: "Banco local indisponível" };
          }

          var templateList = await DB.getAllTemplates();
          var folders = DB.getAllFolders ? await DB.getAllFolders() : [];
          var templates = {};

          templateList.forEach(function (template) {
            templates[template.id] = template;
          });

          return await this.supabase.push(templates, folders);
        default:
          return { success: false, error: "Unknown source" };
      }
    },
  };

  global.SyncManager = SyncManager;
})(typeof globalThis !== "undefined" ? globalThis : this);
