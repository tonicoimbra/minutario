(function (global) {
  var SyncManager = {
    csv: global.CsvSync,
    drive: global.DriveSync,
    supabase: global.SupabaseSync,

    async syncAll(source) {
      switch (source) {
        case "drive":
          return await this.drive.backup(await chrome.storage.sync.get(null));
        case "supabase":
          var all = await chrome.storage.sync.get(null);
          var templates = {};
          var folders = [];
          Object.entries(all).forEach(function (_ref) {
            var key = _ref[0];
            var value = _ref[1];
            if (key.startsWith("tpl_")) templates[value.id] = value;
            if (key === "folders") folders = value;
          });
          return await this.supabase.push(templates, folders);
        default:
          return { success: false, error: "Unknown source" };
      }
    },
  };

  global.SyncManager = SyncManager;
})(typeof globalThis !== "undefined" ? globalThis : this);
