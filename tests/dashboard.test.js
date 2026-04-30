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

  // Inject missing elements that dashboard.js expects
  var missingIds = [
    "login-screen",
    "dashboard-screen",
    "login-form",
    "login-email",
    "login-password",
    "login-error",
    "logout-btn",
    "search-input",
    "empty-state",
    "sync-badge",
  ];
  missingIds.forEach(function (id) {
    if (!window.document.getElementById(id)) {
      var el = window.document.createElement("div");
      el.id = id;
      window.document.body.appendChild(el);
    }
  });

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
    window.setTimeout(() => resolve({ window, storage }), 0);
  });
}

test("dashboard script loads without errors", async () => {
  const { window } = await bootstrapDashboard({});
  assert.ok(window.document.getElementById("template-list"));
});
