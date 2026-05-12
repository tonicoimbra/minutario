const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const dashboardHtml = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "dashboard.html"),
  "utf8"
);
const dashboardIndexHtml = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "index.html"),
  "utf8"
);
const dashboardCss = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "dashboard.css"),
  "utf8"
);
const dashboardSource = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "dashboard.js"),
  "utf8"
);
const csvSource = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "sync", "csv.js"),
  "utf8"
);

function bootstrapDashboard(html, options) {
  options = options || {};
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: options.url || "https://example.test/dashboard/dashboard.html",
  });
  const { window } = dom;
  const storage = { ...(options.storageState || {}) };
  const localStorageArea = { ...(options.localStorageState || {}) };
  const templates = options.templates || [];
  const folders = options.folders || [];
  var savedTemplate = null;
  var deletedTemplateId = null;
  var createdTemplate = null;
  var updatedTemplate = null;
  var savedFolder = null;
  var deletedFolderId = null;
  var remoteDeletedTemplateId = null;
  var syncUserId = null;
  var fullSyncUserId = null;
  var autoSyncCalls = [];
  var pendingTemplateDeleteId = null;
  var pendingFolderDeleteId = null;
  var tabMessages = [];
  var savedTemplates = [];
  var downloadedFile = null;
  var apiUser = options.apiUser || {
    id: "user-1",
    email: "test@example.com",
  };

  if (options.storedSession) {
    window.localStorage.setItem("minutario_access_token", "access-token");
    window.localStorage.setItem("minutario_refresh_token", "refresh-token");
  }

  window.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") {
            return { [key]: localStorageArea[key] };
          }
          return { ...localStorageArea };
        },
        async set(items) {
          Object.assign(localStorageArea, items);
        },
        async remove(key) {
          delete localStorageArea[key];
        },
      },
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
          Object.assign(storage, items);
        },
        async remove(key) {
          delete storage[key];
        },
      },
    },
    tabs: {
      async query() {
        return [{ id: 101 }, { id: 202 }];
      },
      async sendMessage(tabId, message) {
        tabMessages.push({ tabId, message });
      },
    },
  };
  window.Papa = {
    parse(input, config) {
      const rows = String(input || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
      const headers = rows[0].split(",").map((header) =>
        config && typeof config.transformHeader === "function"
          ? config.transformHeader(header)
          : header
      );
      const data = rows.slice(1).map((line) => {
        const values = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
          const ch = line.charAt(i);
          const next = line.charAt(i + 1);
          if (inQuotes && ch === '"' && next === '"') {
            current += '"';
            i += 1;
          } else if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === "," && !inQuotes) {
            values.push(current);
            current = "";
          } else {
            current += ch;
          }
        }
        values.push(current);
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || "";
        });
        return row;
      });
      return { data, errors: [], meta: { fields: headers } };
    },
  };
  window.Blob = class TestBlob {
    constructor(parts, options) {
      this.parts = parts || [];
      this.type = options && options.type ? options.type : "";
    }

    async text() {
      return this.parts.map((part) => String(part)).join("");
    }
  };
  window.MinutarioAPI = {
    getClient() {
      return {
        auth: {
          async setSession() {
            return {};
          },
          async getUser() {
            return {
              data: {
                user: apiUser,
              },
            };
          },
          async signInWithPassword() {
            return {
              data: {
                session: {
                  access_token: "access-token",
                  refresh_token: "refresh-token",
                },
                user: apiUser,
              },
            };
          },
          async signOut() {
            return {};
          },
        },
      };
    },
    async createTemplate(template) {
      createdTemplate = template;
      return template;
    },
    async updateTemplate(id, template) {
      updatedTemplate = { id, template };
      return template;
    },
    async deleteTemplate(id) {
      remoteDeletedTemplateId = id;
      return true;
    },
    async createFolder(folder) {
      return folder;
    },
    async deleteFolder(id) {
      return id;
    },
    subscribeToTemplates() {
      return { unsubscribe() {} };
    },
  };
  window.MinutarioDB = {
    async getAllTemplates() {
      return templates.slice();
    },
    async putTemplate(template) {
      savedTemplate = template;
      savedTemplates.push(template);
      var idx = templates.findIndex((item) => item.id === template.id);
      if (idx >= 0) {
        templates[idx] = template;
      } else {
        templates.push(template);
      }
    },
    async deleteTemplate(id) {
      deletedTemplateId = id;
      var idx = templates.findIndex((item) => item.id === id);
      if (idx >= 0) templates.splice(idx, 1);
    },
    async getAllFolders() {
      return folders.slice();
    },
    async saveFolder(folder) {
      savedFolder = folder;
      var idx = folders.findIndex((item) => item.id === folder.id);
      if (idx >= 0) {
        folders[idx] = folder;
      } else {
        folders.push(folder);
      }
    },
    async deleteFolder(id) {
      deletedFolderId = id;
      var idx = folders.findIndex((item) => item.id === id);
      if (idx >= 0) folders.splice(idx, 1);
    },
    async deleteAllTemplates() {},
    async deleteAllFolders() {},
  };
  window.URL.createObjectURL = (blob) => {
    downloadedFile = { blob, url: "blob:csv" };
    return downloadedFile.url;
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    if (downloadedFile) {
      downloadedFile.filename = this.download;
      downloadedFile.href = this.href;
    }
  };
  window.MinutarioSync = {
    onSyncStateChange() {},
    async prepareUserContext() {
      return false;
    },
    async syncTemplates(userId) {
      syncUserId = userId;
      return { success: true };
    },
    async flushAutoSync(userId, reason) {
      syncUserId = userId;
      autoSyncCalls.push({ userId, reason });
      return { success: true };
    },
    async recordTemplateDelete(userId, id) {
      pendingTemplateDeleteId = id;
    },
    async recordFolderDelete(userId, id) {
      pendingFolderDeleteId = id;
    },
    async fullSync(userId) {
      fullSyncUserId = userId;
      return { success: true };
    },
  };
  window.Quill = function Quill(selector) {
    const root = window.document.querySelector(selector);
    this.root = root;
    this.setText = (text) => {
      root.textContent = text;
    };
    this.setContents = () => {
      root.innerHTML = "";
    };
    this.getText = () => root.textContent || "";
  };
  window.crypto.randomUUID = () => "generated-id";
  window.confirm = () => true;
  window.prompt = () => "";

  window.eval(csvSource);
  window.eval(dashboardSource);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

  return new Promise((resolve) => {
    window.setTimeout(() => resolve({
      window,
      storage,
      localStorageArea,
      getSavedTemplate: () => savedTemplate,
      getSavedTemplates: () => savedTemplates.slice(),
      getDownloadedFile: () => downloadedFile,
      getDeletedTemplateId: () => deletedTemplateId,
      getCreatedTemplate: () => createdTemplate,
      getUpdatedTemplate: () => updatedTemplate,
      getSavedFolder: () => savedFolder,
      getDeletedFolderId: () => deletedFolderId,
      getRemoteDeletedTemplateId: () => remoteDeletedTemplateId,
      getPendingTemplateDeleteId: () => pendingTemplateDeleteId,
      getPendingFolderDeleteId: () => pendingFolderDeleteId,
      getAutoSyncCalls: () => autoSyncCalls.slice(),
      getUserId: () => syncUserId,
      getFullSyncUserId: () => fullSyncUserId,
      getTabMessages: () => tabMessages.slice(),
    }), 20);
  });
}

test("dashboard script loads without errors", async () => {
  const { window } = await bootstrapDashboard(dashboardHtml);
  assert.ok(window.document.getElementById("template-list"));
});

test("dashboard stylesheet keeps the three-panel dashboard layout", () => {
  assert.match(dashboardCss, /\.top-bar\s*\{/);
  assert.match(dashboardCss, /\.dashboard-grid\s*\{/);
  assert.match(dashboardCss, /\.panel-editor\s*\{/);
  assert.match(dashboardCss, /#search,\s*\n#tpl-name,/);
});

test("CRUD dashboard loads shared storage and sync modules before dashboard logic", () => {
  var dbScriptIndex = dashboardHtml.indexOf("../shared/db.js");
  var apiScriptIndex = dashboardHtml.indexOf("../shared/api.js");
  var syncScriptIndex = dashboardHtml.indexOf("../shared/sync.js");
  var dashboardScriptIndex = dashboardHtml.indexOf("dashboard.js");

  assert.ok(dbScriptIndex !== -1);
  assert.ok(apiScriptIndex !== -1);
  assert.ok(syncScriptIndex !== -1);
  assert.ok(dbScriptIndex < dashboardScriptIndex);
  assert.ok(apiScriptIndex < dashboardScriptIndex);
  assert.ok(syncScriptIndex < dashboardScriptIndex);
});

test("committed PWA dashboard layout renders templates without injected elements", async () => {
  const template = {
    id: "t1",
    name: "Contrato",
    shortcut: "contrato",
    plain_text: "Texto do contrato",
    html_content: "<p>Texto do contrato</p>",
  };
  const { window } = await bootstrapDashboard(dashboardIndexHtml, {
    url: "https://example.test/dashboard/index.html",
    storedSession: true,
    templates: [template],
  });

  const rows = window.document.querySelectorAll("#template-list .template-item");
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Contrato/);
});

test("CRUD dashboard keeps editor selection and saves through the IndexedDB API", async () => {
  const template = {
    id: "t1",
    name: "Contrato",
    shortcut: "contrato",
    content: "<p>Texto inicial</p>",
    plain_text: "Texto inicial",
  };
  const { window, getSavedTemplate } = await bootstrapDashboard(dashboardHtml, {
    templates: [template],
  });

  window.document.querySelector("#template-list .template-item").click();
  assert.equal(window.document.getElementById("tpl-name").value, "Contrato");

  window.document.getElementById("tpl-name").value = "Contrato atualizado";
  window.document.getElementById("quill-editor").textContent = "Texto atualizado";
  window.document
    .getElementById("editor-form")
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getSavedTemplate().id, "t1");
  assert.equal(getSavedTemplate().name, "Contrato atualizado");
});

test("dashboard restores the authenticated user id and auto-syncs saved templates", async () => {
  const template = {
    id: "t1",
    name: "Contrato",
    shortcut: "contrato",
    content: "<p>Texto inicial</p>",
    folder_id: "folder-1",
    plain_text: "Texto inicial",
  };
  const { window, getSavedTemplate, getUserId, getAutoSyncCalls } = await bootstrapDashboard(dashboardHtml, {
    storedSession: true,
    templates: [template],
    apiUser: {
      id: "user-app-id",
      email: "test@example.com",
    },
  });

  window.document.querySelector("#template-list .template-item").click();
  window.document.getElementById("tpl-name").value = "Contrato app";
  window.document
    .getElementById("editor-form")
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getSavedTemplate().user_id, "user-app-id");
  assert.equal(getSavedTemplate().folder_id, "folder-1");
  assert.equal(getUserId(), "user-app-id");
  assert.deepEqual(getAutoSyncCalls().slice(-1)[0], {
    userId: "user-app-id",
    reason: "template:update",
  });
});

test("dashboard creates local templates and records deletes for automatic sync", async () => {
  const template = {
    id: "t1",
    name: "Contrato",
    shortcut: "contrato",
    content: "<p>Texto inicial</p>",
  };
  const {
    window,
    getSavedTemplate,
    getDeletedTemplateId,
    getPendingTemplateDeleteId,
    getAutoSyncCalls,
  } = await bootstrapDashboard(dashboardHtml, {
    storedSession: true,
    templates: [template],
  });

  window.document.getElementById("tpl-name").value = "Novo";
  window.document.getElementById("tpl-shortcut").value = "novo";
  window.document.getElementById("quill-editor").textContent = "Novo texto";
  window.document
    .getElementById("editor-form")
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getSavedTemplate().id, "generated-id");
  assert.equal(getAutoSyncCalls().slice(-1)[0].reason, "template:create");

  window.document.querySelector("#template-list .template-item").click();
  window.document.getElementById("delete-template").click();

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getDeletedTemplateId(), "t1");
  assert.equal(getPendingTemplateDeleteId(), "t1");
  assert.equal(getAutoSyncCalls().slice(-1)[0].reason, "template:delete");
});

test("dashboard blocks duplicate shortcuts before saving", async () => {
  const templates = [
    { id: "t1", name: "Contrato", shortcut: "contrato", content: "<p>A</p>" },
    { id: "t2", name: "Petição", shortcut: "peticao", content: "<p>B</p>" },
  ];
  const { window, getSavedTemplate } = await bootstrapDashboard(dashboardHtml, {
    templates: templates,
  });

  window.document.querySelector('[data-id="t2"]').click();
  window.document.getElementById("tpl-shortcut").value = "contrato";
  window.document
    .getElementById("editor-form")
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getSavedTemplate(), null);
  assert.match(window.document.getElementById("shortcut-error").textContent, /Atalho já em uso/);
});

test("dashboard creates folders, exposes them in the selector and auto-syncs", async () => {
  const { window, getSavedFolder, getAutoSyncCalls } = await bootstrapDashboard(dashboardHtml, {
    storedSession: true,
    folders: [],
  });

  window.prompt = () => "Processos";
  window.document.getElementById("new-folder").click();

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getSavedFolder().name, "Processos");
  assert.equal(window.document.querySelectorAll("#folder-list .folder-item").length, 1);
  assert.equal(window.document.querySelector('#tpl-folder option[value="' + getSavedFolder().id + '"]').textContent, "Processos");
  assert.equal(getAutoSyncCalls().slice(-1)[0].reason, "folder:create");
});

test("dashboard renames and deletes folders through automatic sync", async () => {
  const { window, getSavedFolder, getDeletedFolderId, getPendingFolderDeleteId, getAutoSyncCalls } = await bootstrapDashboard(dashboardHtml, {
    storedSession: true,
    folders: [{ id: "folder-1", user_id: "user-1", name: "Antiga", order_idx: 0 }],
  });

  window.document.querySelector("#folder-list .folder-item").click();
  window.prompt = () => "Nova";
  window.document.getElementById("rename-folder").click();
  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getSavedFolder().name, "Nova");
  assert.equal(getAutoSyncCalls().slice(-1)[0].reason, "folder:update");

  window.document.getElementById("delete-folder").click();
  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getDeletedFolderId(), "folder-1");
  assert.equal(getPendingFolderDeleteId(), "folder-1");
  assert.equal(getAutoSyncCalls().slice(-1)[0].reason, "folder:delete");
});

test("dashboard notifies open tabs after saving a template", async () => {
  const { window, getTabMessages } = await bootstrapDashboard(dashboardHtml, {
    templates: [],
  });

  window.document.getElementById("tpl-name").value = "Novo";
  window.document.getElementById("tpl-shortcut").value = "novo";
  window.document.getElementById("quill-editor").textContent = "Novo texto";
  window.document
    .getElementById("editor-form")
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.deepEqual(JSON.parse(JSON.stringify(getTabMessages())), [
    { tabId: 101, message: { type: "TEMPLATES_UPDATED" } },
    { tabId: 202, message: { type: "TEMPLATES_UPDATED" } },
  ]);
});

test("dashboard force sync hydrates local templates and reports success", async () => {
  const template = {
    id: "remote-1",
    user_id: "user-app-id",
    name: "Remoto",
    shortcut: "remoto",
    content: "<p>Remoto</p>",
  };
  const { window, getUserId } = await bootstrapDashboard(dashboardHtml, {
    storedSession: true,
    templates: [template],
    apiUser: {
      id: "user-app-id",
      email: "test@example.com",
    },
  });

  window.document.getElementById("supabase-sync").click();

  await new Promise((resolve) => window.setTimeout(resolve, 30));

  assert.equal(getUserId(), "user-app-id");
  assert.match(window.document.getElementById("toast").textContent, /Sincronizado com sucesso/);
});

test("dashboard exports templates as a dated UTF-8 CSV download", async () => {
  const { window, getDownloadedFile } = await bootstrapDashboard(dashboardHtml, {
    templates: [
      {
        id: "tpl-1",
        name: "Multa",
        shortcut: "multa",
        content: '<p>Texto, com "aspas" e ç</p>',
        plain_text: 'Texto, com "aspas" e ç',
      },
    ],
  });

  window.document.getElementById("export-csv").click();

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  const downloaded = getDownloadedFile();
  assert.ok(downloaded);
  assert.match(downloaded.filename, /^text-expander-backup-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await downloaded.blob.text();
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.match(text, /trigger,expansion,name/);
  assert.match(text, /"Texto, com ""aspas"" e ç"/);
});

test("dashboard imports CSV by adding new shortcuts and updating existing ones", async () => {
  const { window, getSavedTemplates, getTabMessages } = await bootstrapDashboard(dashboardHtml, {
    templates: [
      {
        id: "tpl-existing",
        name: "Antigo",
        shortcut: "multa",
        content: "<p>Antigo</p>",
        plain_text: "Antigo",
      },
    ],
  });

  const input = window.document.getElementById("import-csv");
  const file = new window.File(
    [
      'trigger,expansion,name\n' +
        '"multa","<p>Atualizado</p>","Multa atualizada"\n' +
        '"novo","<p>Novo texto</p>","Novo"',
    ],
    "backup.csv",
    { type: "text/csv" }
  );

  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 40));

  const saved = getSavedTemplates();
  assert.equal(saved.length, 2);
  assert.equal(saved[0].id, "tpl-existing");
  assert.equal(saved[0].content, "<p>Atualizado</p>");
  assert.equal(saved[1].shortcut, "novo");
  assert.match(window.document.getElementById("import-status").textContent, /1 gatilhos importados, 1 atualizados/);
  assert.equal(getTabMessages().length, 2);
});

test("dashboard rejects invalid CSV without modifying templates", async () => {
  const { window, getSavedTemplates } = await bootstrapDashboard(dashboardHtml, {
    templates: [
      {
        id: "tpl-existing",
        name: "Antigo",
        shortcut: "multa",
        content: "<p>Antigo</p>",
      },
    ],
  });

  const input = window.document.getElementById("import-csv");
  const file = new window.File(['nome,atalho\n"X","x"'], "invalido.csv", {
    type: "text/csv",
  });

  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 40));

  assert.equal(getSavedTemplates().length, 0);
  assert.match(window.document.getElementById("import-status").textContent, /Colunas obrigatórias ausentes/);
  assert.equal(window.document.getElementById("import-status").classList.contains("error"), true);
});
