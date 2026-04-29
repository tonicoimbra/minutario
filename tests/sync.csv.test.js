const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scriptPath = path.join(__dirname, "..", "dashboard", "sync", "csv.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

function bootstrapDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Minimal PapaParse mock
  window.Papa = {
    parse: function (input, config) {
      var lines = input.trim().split("\n").filter(Boolean);
      var delimiter = ",";
      var headers = lines[0].split(delimiter).map(function (h) {
        return h.trim().replace(/^"|"$/g, "");
      });
      var data = lines.slice(1).map(function (line) {
        var obj = {};
        var values = [];
        var inQuotes = false;
        var current = "";
        for (var i = 0; i < line.length; i++) {
          var ch = line.charAt(i);
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === delimiter && !inQuotes) {
            values.push(current.trim().replace(/^"|"$/g, ""));
            current = "";
          } else {
            current += ch;
          }
        }
        values.push(current.trim().replace(/^"|"$/g, ""));
        headers.forEach(function (h, i) {
          obj[h] = values[i] || "";
        });
        return obj;
      });
      return { data: data, errors: [], meta: { fields: headers } };
    },
  };

  window.eval(scriptSource);
  return window;
}

test("parses simple CSV with 2 templates", () => {
  const window = bootstrapDom();
  const csv = 'name,shortcut,folder,content\n"Contrato","contrato","Docs","<p>text</p>"\n"Despacho","despacho","","<p>vistos</p>"';
  const result = window.CsvSync.parseCsv(csv);
  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].name, "Contrato");
  assert.equal(result.data[0].shortcut, "contrato");
  assert.equal(result.data[0].folder, "Docs");
  assert.equal(result.data[1].folder, "");
});

test("reports error for CSV missing required columns", () => {
  const window = bootstrapDom();
  const csv = 'nome,atalho\n"X","x"';
  const result = window.CsvSync.parseCsv(csv);
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
});

test("imports templates merging with existing and detects conflicts", () => {
  const window = bootstrapDom();
  const parsed = [
    { name: "Novo", shortcut: "novo", folder: "Docs", content: "<p>N</p>" },
    { name: "Existente", shortcut: "ex", folder: "", content: "<p>X</p>" },
  ];
  const existing = {
    "tpl-1": { id: "tpl-1", name: "Existente", shortcut: "ex", content: "<p>Old</p>", folderId: null },
  };
  const result = window.CsvSync.importCsv(parsed, existing, []);
  assert.equal(result.templates.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].shortcut, "ex");
  assert.equal(result.stats.total, 2);
  assert.equal(result.stats.conflicts, 1);
});

test("maps folder names to existing folder IDs", () => {
  const window = bootstrapDom();
  const parsed = [
    { name: "T1", shortcut: "t1", folder: "Processos", content: "<p>A</p>" },
  ];
  const folders = [{ id: "f-1", name: "Processos", order: 0 }];
  const result = window.CsvSync.importCsv(parsed, {}, folders);
  assert.equal(result.templates[0].folderId, "f-1");
});
