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
  var tabMessages = [];
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
    },
    async deleteTemplate(id) {
      deletedTemplateId = id;
    },
    async getAllFolders() {
      return folders.slice();
    },
    async saveFolder(folder) {
      savedFolder = folder;
      folders.push(folder);
    },
    async deleteFolder(id) {
      deletedFolderId = id;
    },
    async deleteAllTemplates() {},
  };
  window.MinutarioSync = {
    onSyncStateChange() {},
    async syncTemplates(userId) {
      syncUserId = userId;
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

  window.eval(dashboardSource);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

  return new Promise((resolve) => {
    window.setTimeout(() => resolve({
      window,
      storage,
      localStorageArea,
      getSavedTemplate: () => savedTemplate,
      getDeletedTemplateId: () => deletedTemplateId,
      getCreatedTemplate: () => createdTemplate,
      getUpdatedTemplate: () => updatedTemplate,
      getSavedFolder: () => savedFolder,
      getDeletedFolderId: () => deletedFolderId,
      getRemoteDeletedTemplateId: () => remoteDeletedTemplateId,
      getUserId: () => syncUserId,
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

test("dashboard restores the authenticated user id and syncs saved templates remotely", async () => {
  const template = {
    id: "t1",
    name: "Contrato",
    shortcut: "contrato",
    content: "<p>Texto inicial</p>",
    folder_id: "folder-1",
    plain_text: "Texto inicial",
  };
  const { window, getSavedTemplate, getUpdatedTemplate, getUserId } = await bootstrapDashboard(dashboardHtml, {
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
  assert.equal(getUpdatedTemplate().id, "t1");
  assert.equal(getUpdatedTemplate().template.user_id, "user-app-id");
  assert.equal(getUserId(), "user-app-id");
});

test("dashboard creates remote templates and deletes them remotely", async () => {
  const template = {
    id: "t1",
    name: "Contrato",
    shortcut: "contrato",
    content: "<p>Texto inicial</p>",
  };
  const {
    window,
    getCreatedTemplate,
    getDeletedTemplateId,
    getRemoteDeletedTemplateId,
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

  assert.equal(getCreatedTemplate().id, "generated-id");

  window.document.querySelector("#template-list .template-item").click();
  window.document.getElementById("delete-template").click();

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getDeletedTemplateId(), "t1");
  assert.equal(getRemoteDeletedTemplateId(), "t1");
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

test("dashboard creates folders and exposes them in the selector", async () => {
  const { window, getSavedFolder } = await bootstrapDashboard(dashboardHtml, {
    storedSession: true,
    folders: [],
  });

  window.prompt = () => "Processos";
  window.document.getElementById("new-folder").click();

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(getSavedFolder().name, "Processos");
  assert.equal(window.document.querySelectorAll("#folder-list .folder-item").length, 1);
  assert.equal(window.document.querySelector('#tpl-folder option[value="' + getSavedFolder().id + '"]').textContent, "Processos");
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
