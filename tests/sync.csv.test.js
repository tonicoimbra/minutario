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
          var next = line.charAt(i + 1);
          if (inQuotes && ch === '"' && next === '"') {
            current += '"';
            i += 1;
          } else if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === delimiter && !inQuotes) {
            values.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }
        values.push(current.trim());
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

test("parses trigger and expansion aliases with accents and commas", () => {
  const window = bootstrapDom();
  const csv = '\uFEFFtrigger,expansion\n"multa","Texto com vírgula, acento e ""aspas"""';
  const result = window.CsvSync.parseCsv(csv);
  assert.equal(result.success, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].shortcut, "multa");
  assert.equal(result.data[0].content, 'Texto com vírgula, acento e "aspas"');
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
  assert.equal(result.stats.created, 1);
  assert.equal(result.stats.updated, 1);
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

test("exports RFC4180 CSV with BOM and escaped fields", () => {
  const window = bootstrapDom();
  const csv = window.CsvSync.exportCsv(
    [
      {
        id: "tpl-1",
        name: "Multa",
        shortcut: "multa",
        content: '<p>Texto, com "aspas"\ne quebra</p>',
        plain_text: 'Texto, com "aspas"\ne quebra',
        folder_id: "folder-1",
      },
    ],
    [{ id: "folder-1", name: "Processos" }]
  );

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /^﻿trigger,expansion,name,folder,id,folder_id,plain_text,created_at,updated_at/);
  assert.match(csv, /"Texto, com ""aspas""\ne quebra"/);
  assert.match(csv, /Processos/);
});
