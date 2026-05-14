(function (global) {
  "use strict";

  var CSV_COLUMNS = [
    "trigger",
    "expansion",
    "name",
    "folder",
    "id",
    "folder_id",
    "plain_text",
    "created_at",
    "updated_at",
  ];

  function normalizeHeader(header) {
    return String(header || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }

  function normalizeShortcut(shortcut) {
    return String(shortcut || "")
      .trim()
      .replace(/^\//, "")
      .toLowerCase();
  }

  function stripHtml(html) {
    if (!html) return "";

    if (global.document && typeof global.document.createElement === "function") {
      var tmp = global.document.createElement("div");
      tmp.innerHTML = html;
      return tmp.textContent || tmp.innerText || "";
    }

    return String(html).replace(/<[^>]*>/g, "");
  }

  function getRowValue(row, names) {
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      if (Object.prototype.hasOwnProperty.call(row, name)) {
        return row[name];
      }
    }

    return "";
  }

  function hasValue(value) {
    return String(value || "").trim().length > 0;
  }

  function escapeCsvField(value) {
    var text = value === null || typeof value === "undefined" ? "" : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function serializeRows(rows, columns) {
    var selectedColumns = columns && columns.length ? columns : CSV_COLUMNS;
    var lines = [
      selectedColumns.map(escapeCsvField).join(","),
    ];

    (rows || []).forEach(function(row) {
      lines.push(
        selectedColumns.map(function(column) {
          return escapeCsvField(row && row[column]);
        }).join(",")
      );
    });

    return "\uFEFF" + lines.join("\r\n");
  }

  function parseWithPapa(text) {
    if (!global.Papa || typeof global.Papa.parse !== "function") {
      return null;
    }

    return global.Papa.parse(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: normalizeHeader,
    });
  }

  function parseCsvManually(text) {
    var input = String(text || "").replace(/^\uFEFF/, "");
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;

    for (var i = 0; i < input.length; i += 1) {
      var ch = input.charAt(i);
      var next = input.charAt(i + 1);

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          field += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\r" || ch === "\n") {
        row.push(field);
        field = "";
        if (row.some(hasValue)) {
          rows.push(row);
        }
        row = [];
        if (ch === "\r" && next === "\n") {
          i += 1;
        }
      } else {
        field += ch;
      }
    }

    if (inQuotes) {
      return {
        data: [],
        errors: [{ message: "Campo entre aspas não foi fechado." }],
        meta: { fields: [] },
      };
    }

    row.push(field);
    if (row.some(hasValue)) {
      rows.push(row);
    }

    if (rows.length === 0) {
      return { data: [], errors: [], meta: { fields: [] } };
    }

    var headers = rows[0].map(normalizeHeader);
    var data = rows.slice(1).map(function(values) {
      var obj = {};
      headers.forEach(function(header, index) {
        obj[header] = typeof values[index] === "undefined" ? "" : values[index];
      });
      return obj;
    });

    return { data: data, errors: [], meta: { fields: headers } };
  }

  function normalizeParsedRow(row) {
    var shortcut = normalizeShortcut(
      getRowValue(row, ["trigger", "shortcut", "atalho", "gatilho"])
    );
    var content = String(
      getRowValue(row, ["expansion", "content", "conteudo", "expansao", "texto"])
    || "").trim();
    var name = String(getRowValue(row, ["name", "nome", "title", "titulo"]) || "").trim();
    var folder = String(getRowValue(row, ["folder", "pasta"]) || "").trim();
    var id = String(getRowValue(row, ["id"]) || "").trim();
    var folderId = String(getRowValue(row, ["folder_id", "folderid"]) || "").trim();
    var plainText = String(getRowValue(row, ["plain_text", "plaintext", "plain"]) || "").trim();
    var createdAt = String(getRowValue(row, ["created_at", "createdat"]) || "").trim();
    var updatedAt = String(getRowValue(row, ["updated_at", "updatedat"]) || "").trim();

    if (!name && shortcut) {
      name = "/" + shortcut;
    }

    if (!plainText && content) {
      plainText = stripHtml(content);
    }

    return {
      id: id,
      name: name,
      shortcut: shortcut,
      folder: folder,
      folderId: folderId || null,
      content: content,
      plain_text: plainText,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  function parseCsv(text) {
    if (!text || typeof text !== "string" || !text.trim()) {
      return { success: false, data: [], errors: ["CSV vazio."] };
    }

    var raw = parseWithPapa(text) || parseCsvManually(text);
    if (raw.errors && raw.errors.length > 0) {
      return {
        success: false,
        data: [],
        errors: raw.errors.map(function(error) {
          return error && error.message ? error.message : String(error || "Erro no CSV");
        }),
      };
    }

    var fields = raw.meta && raw.meta.fields
      ? raw.meta.fields.map(normalizeHeader)
      : [];
    var hasShortcut = ["trigger", "shortcut", "atalho", "gatilho"].some(function(field) {
      return fields.indexOf(field) !== -1;
    });
    var hasContent = ["expansion", "content", "conteudo", "expansao", "texto"].some(function(field) {
      return fields.indexOf(field) !== -1;
    });

    if (!hasShortcut || !hasContent) {
      return {
        success: false,
        data: [],
        errors: ["Colunas obrigatórias ausentes: trigger/shortcut e expansion/content."],
      };
    }

    var errors = [];
    var seen = {};
    var data = [];

    (raw.data || []).forEach(function(row, index) {
      var normalized = normalizeParsedRow(row || {});
      var rowNumber = index + 2;

      if (!normalized.shortcut && !normalized.content && !normalized.name) {
        return;
      }

      if (!normalized.shortcut) {
        errors.push("Linha " + rowNumber + ": gatilho vazio.");
        return;
      }

      if (!/^[a-zA-Z0-9-]+$/.test(normalized.shortcut)) {
        errors.push("Linha " + rowNumber + ": gatilho inválido '" + normalized.shortcut + "'.");
        return;
      }

      if (!normalized.content) {
        errors.push("Linha " + rowNumber + ": expansão vazia.");
        return;
      }

      if (seen[normalized.shortcut]) {
        errors.push("Linha " + rowNumber + ": gatilho duplicado no CSV '" + normalized.shortcut + "'.");
        return;
      }

      seen[normalized.shortcut] = true;
      data.push(normalized);
    });

    if (errors.length > 0) {
      return { success: false, data: [], errors: errors };
    }

    if (data.length === 0) {
      return { success: false, data: [], errors: ["CSV não contém gatilhos válidos."] };
    }

    return { success: true, data: data, errors: [] };
  }

  function normalizeExistingTemplateMap(existingTemplates) {
    var list = Array.isArray(existingTemplates)
      ? existingTemplates
      : Object.values(existingTemplates || {});
    var map = {};

    list.forEach(function(template) {
      var shortcut = normalizeShortcut(template && template.shortcut);
      if (shortcut) {
        map[shortcut] = template;
      }
    });

    return map;
  }

  function buildFolderMap(existingFolders) {
    var map = {};

    (existingFolders || []).forEach(function(folder) {
      if (folder && folder.name) {
        map[String(folder.name).trim().toLowerCase()] = folder.id;
      }
    });

    return map;
  }

  function importCsv(parsedData, existingTemplates, existingFolders, options) {
    options = options || {};
    var shortcutMap = normalizeExistingTemplateMap(existingTemplates);
    var folderMap = buildFolderMap(existingFolders);
    var now = options.now || new Date();
    var nowIso = now.toISOString ? now.toISOString() : new Date().toISOString();
    var nowMs = now.getTime ? now.getTime() : Date.now();
    var templates = [];
    var created = 0;
    var updated = 0;

    (parsedData || []).forEach(function(row) {
      var shortcut = normalizeShortcut(row.shortcut);
      var existing = shortcutMap[shortcut];
      var folderKey = String(row.folder || "").trim().toLowerCase();
      var folderId = row.folderId || row.folder_id || (folderKey ? folderMap[folderKey] || null : null);
      var base = existing || {};
      var templateId =
        base.id ||
        row.id ||
        (global.crypto && typeof global.crypto.randomUUID === "function"
          ? global.crypto.randomUUID()
          : "csv-" + nowMs + "-" + templates.length);
      var createdAt = base.created_at || base.createdAt || row.created_at || nowIso;

      var template = {
        id: templateId,
        name: row.name || base.name || "/" + shortcut,
        shortcut: shortcut,
        content: row.content,
        plain_text: row.plain_text || stripHtml(row.content),
        folder_id: folderId || null,
        folderId: folderId || null,
        user_id: base.user_id || options.userId || null,
        created_at: createdAt,
        createdAt: typeof base.createdAt === "number" ? base.createdAt : nowMs,
        updated_at: nowIso,
        updatedAt: nowMs,
      };

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }

      shortcutMap[shortcut] = template;
      templates.push(template);
    });

    return {
      templates: templates,
      conflicts: templates.filter(function(template) {
        return !!normalizeExistingTemplateMap(existingTemplates)[template.shortcut];
      }).map(function(template) {
        return { shortcut: template.shortcut, incomingName: template.name };
      }),
      stats: {
        total: templates.length,
        created: created,
        updated: updated,
        conflicts: updated,
      },
    };
  }

  function templateToExportRow(template, foldersById) {
    var folderId = template.folder_id || template.folderId || "";
    var content = template.content || template.html_content || "";
    return {
      trigger: template.shortcut || "",
      expansion: content,
      name: template.name || "",
      folder: folderId && foldersById ? foldersById[folderId] || "" : "",
      id: template.id || "",
      folder_id: folderId || "",
      plain_text: template.plain_text || template.plainText || stripHtml(content),
      created_at: template.created_at || template.createdAt || "",
      updated_at: template.updated_at || template.updatedAt || "",
    };
  }

  function exportCsv(templates, folders) {
    var foldersById = {};

    (folders || []).forEach(function(folder) {
      if (folder && folder.id) {
        foldersById[folder.id] = folder.name || "";
      }
    });

    var rows = (templates || []).map(function(template) {
      return templateToExportRow(template, foldersById);
    });

    return serializeRows(rows, CSV_COLUMNS);
  }

  global.CsvSync = {
    parseCsv: parseCsv,
    importCsv: importCsv,
    exportCsv: exportCsv,
    escapeCsvField: escapeCsvField,
    serializeRows: serializeRows,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
