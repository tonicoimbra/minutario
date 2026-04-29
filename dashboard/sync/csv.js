(function (global) {
  function parseCsv(text) {
    if (!text || typeof text !== "string") {
      return { success: false, data: [], errors: ["Empty input"] };
    }

    var result = global.Papa.parse(text.trim(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: function (header) {
        return header.trim().toLowerCase();
      },
    });

    if (result.errors && result.errors.length > 0) {
      return { success: false, data: [], errors: result.errors.map(function (e) { return e.message; }) };
    }

    var required = ["name", "shortcut", "content"];
    var fields = result.meta && result.meta.fields ? result.meta.fields.map(function (f) { return f.toLowerCase(); }) : [];
    var missing = required.filter(function (col) { return fields.indexOf(col) === -1; });

    if (missing.length > 0) {
      return { success: false, data: [], errors: ["Colunas obrigatórias ausentes: " + missing.join(", ")] };
    }

    var data = result.data.map(function (row) {
      return {
        name: String(row.name || "").trim(),
        shortcut: String(row.shortcut || "").trim().toLowerCase(),
        folder: String(row.folder || "").trim(),
        content: String(row.content || "").trim(),
      };
    }).filter(function (row) {
      return row.name && row.shortcut;
    });

    return { success: true, data: data, errors: [] };
  }

  function importCsv(parsedData, existingTemplates, existingFolders) {
    var templates = [];
    var conflicts = [];
    var shortcutMap = {};
    var folderMap = {};

    (existingFolders || []).forEach(function (f) {
      folderMap[f.name] = f.id;
    });

    Object.values(existingTemplates || {}).forEach(function (tpl) {
      if (tpl.shortcut) {
        shortcutMap[tpl.shortcut.toLowerCase()] = tpl;
      }
    });

    parsedData.forEach(function (row, index) {
      var existing = shortcutMap[row.shortcut];
      if (existing) {
        conflicts.push({
          index: index,
          shortcut: row.shortcut,
          existingName: existing.name,
          incomingName: row.name,
        });
      }

      var folderId = row.folder ? (folderMap[row.folder] || null) : null;
      templates.push({
        name: row.name,
        shortcut: row.shortcut,
        content: row.content,
        folderId: folderId,
      });
    });

    return {
      templates: templates,
      conflicts: conflicts,
      stats: {
        total: parsedData.length,
        created: templates.length - conflicts.length,
        conflicts: conflicts.length,
      },
    };
  }

  global.CsvSync = {
    parseCsv: parseCsv,
    importCsv: importCsv,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
