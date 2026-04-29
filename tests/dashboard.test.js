const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const dashboardHtml = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "dashboard.html"),
  "utf8"
);
const dashboardSource = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "dashboard.js"),
  "utf8"
);

function bootstrapDashboard(storageState) {
  const dom = new JSDOM(dashboardHtml, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.test/dashboard/dashboard.html",
  });
  const { window } = dom;
  const storage = { ...storageState };
  const calls = [];

  window.chrome = {
    storage: {
      sync: {
        async get(key) {
          if (key === null) {
            return { ...storage };
          }
          if (typeof key === "string") {
            return { [key]: storage[key] };
          }
          return {};
        },
        async set(items) {
          calls.push(items);
          Object.assign(storage, items);
        },
        async remove(key) {
          delete storage[key];
        },
      },
    },
  };
  window.Quill = function Quill(selector) {
    const root = window.document.querySelector(selector);
    this.root = root;
    this.setText = (text) => {
      root.textContent = text;
    };
  };
  window.crypto.randomUUID = () => "generated-id";
  window.confirm = () => true;
  window.prompt = () => "";

  window.eval(dashboardSource);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

  return new Promise((resolve) => {
    window.setTimeout(() => resolve({ window, storage, calls }), 0);
  });
}

test("deletes selected folder and moves its templates to Todos", async () => {
  const { window, storage, calls } = await bootstrapDashboard({
    folders: [{ id: "folder-a", name: "Administrativo", order: 0 }],
    tpl_1: {
      id: "1",
      name: "Modelo A",
      shortcut: "modelo-a",
      content: "<p>Conteúdo A</p>",
      folderId: "folder-a",
      createdAt: 1,
      updatedAt: 2,
    },
  });

  const deleteFolderButton = window.document.getElementById("delete-folder");
  assert.ok(deleteFolderButton, "delete folder button should exist");

  window.document.querySelector('[data-folder-id="folder-a"]').click();
  assert.equal(deleteFolderButton.disabled, false);

  await deleteFolderButton.click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  assert.deepEqual(storage.folders, []);
  assert.equal(storage.tpl_1.folderId, null);
  assert.equal(
    calls.some((call) => call.folders && call.tpl_1 && call.tpl_1.folderId === null),
    true
  );
  assert.equal(deleteFolderButton.disabled, true);
});

test("builds a versioned preset export payload from dashboard state", async () => {
  const { window } = await bootstrapDashboard({
    folders: [{ id: "folder-a", name: "Administrativo", order: 0 }],
    settings: { triggerChar: "/", triggerKey: "Space" },
    tpl_1: {
      id: "1",
      name: "Modelo A",
      shortcut: "modelo-a",
      content: "<p>Conteúdo A</p>",
      folderId: "folder-a",
      createdAt: 1,
      updatedAt: 2,
    },
  });

  assert.equal(typeof window.buildPresetExportData, "function");

  const payload = window.buildPresetExportData();

  assert.equal(payload.schema, "minutario.preset");
  assert.equal(payload.version, 1);
  assert.equal(payload.folders.length, 1);
  assert.equal(payload.templates.length, 1);
  assert.equal(payload.settings.triggerChar, "/");
  assert.equal(payload.templates[0].folderId, "folder-a");
});

test("imports a valid preset and remaps folder identifiers", async () => {
  const { window, storage } = await bootstrapDashboard({});

  window.crypto.randomUUID = (() => {
    let counter = 0;
    return () => `generated-${++counter}`;
  })();

  assert.equal(typeof window.importPresetFromFile, "function");

  const file = new window.File(
    [
      JSON.stringify({
        schema: "minutario.preset",
        version: 1,
        name: "Minutas padrão",
        folders: [{ id: "folder-a", name: "Contratos", order: 0 }],
        templates: [
          {
            id: "tpl-a",
            name: "Minuta A",
            shortcut: "minuta-a",
            content: "<p>Texto base</p>",
            folderId: "folder-a",
          },
        ],
        settings: { triggerChar: "/", triggerKey: "Space" },
      }),
    ],
    "preset.json",
    { type: "application/json" }
  );

  const result = await window.importPresetFromFile(file);

  assert.equal(result.ok, true);
  assert.equal(result.importedFolders, 1);
  assert.equal(result.importedTemplates, 1);
  assert.equal(storage.folders[0].id, "generated-1");
  assert.equal(storage["tpl_generated-2"].folderId, "generated-1");
  assert.equal(storage["tpl_generated-2"].shortcut, "minuta-a");
});

test("rejects preset imports that conflict with existing shortcuts", async () => {
  const { window, storage } = await bootstrapDashboard({
    tpl_existing: {
      id: "existing",
      name: "Modelo existente",
      shortcut: "minuta-a",
      content: "<p>Existente</p>",
      folderId: null,
      createdAt: 1,
      updatedAt: 2,
    },
  });

  assert.equal(typeof window.importPresetFromFile, "function");

  const file = new window.File(
    [
      JSON.stringify({
        schema: "minutario.preset",
        version: 1,
        folders: [],
        templates: [
          {
            id: "tpl-a",
            name: "Minuta A",
            shortcut: "minuta-a",
            content: "<p>Texto base</p>",
            folderId: null,
          },
        ],
      }),
    ],
    "preset.json",
    { type: "application/json" }
  );

  const result = await window.importPresetFromFile(file);

  assert.equal(result.ok, false);
  assert.equal(result.error, "Shortcut já em uso: minuta-a");
  assert.equal(storage.tpl_existing.shortcut, "minuta-a");
  assert.equal(Object.keys(storage).length > 0, true);
});
