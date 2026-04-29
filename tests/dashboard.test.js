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
