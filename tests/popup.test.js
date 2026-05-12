const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const popupHtml = fs.readFileSync(
  path.join(__dirname, "..", "popup", "popup.html"),
  "utf8"
);
const popupSource = fs.readFileSync(
  path.join(__dirname, "..", "popup", "popup.js"),
  "utf8"
);

async function bootstrapPopup(options) {
  options = options || {};
  const dom = new JSDOM(popupHtml, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.test/popup/popup.html",
  });
  const { window } = dom;
  const localStorageArea = Object.assign({}, options.localStorageArea || {});
  const signInCalls = [];
  const updateUserCalls = [];
  const clipboardWrites = [];

  window.chrome = {
    storage: {
      local: {
        async set(items) {
          Object.assign(localStorageArea, items);
        },
        async get(key) {
          if (typeof key === "string") {
            return { [key]: localStorageArea[key] };
          }
          return Object.assign({}, localStorageArea);
        },
        async remove(key) {
          delete localStorageArea[key];
        },
      },
    },
    runtime: {
      getURL(value) {
        return value;
      },
      getManifest() {
        return { version: "9.9.9-test" };
      },
      async sendMessage() {
        return { ok: true, data: [] };
      },
    },
    tabs: {
      create() {},
    },
  };

  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(value) {
        clipboardWrites.push(value);
      },
    },
  });

  window.MinutarioAPI = {
    getClient() {
      return {
        auth: {
          async setSession() {
            return {};
          },
          async getUser() {
            return { data: { user: null }, error: null };
          },
          async signInWithPassword(creds) {
            signInCalls.push(creds);
            return options.signInResult;
          },
          async updateUser(payload) {
            updateUserCalls.push(payload);
            return options.updateUserResult || { data: { user: { id: "user-1" } }, error: null };
          },
          async signOut() {
            return {};
          },
        },
      };
    },
  };

  window.eval(popupSource);
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  return { window, signInCalls, updateUserCalls, clipboardWrites };
}

test("popup performs login-only flow and opens dashboard", async () => {
  const { window, signInCalls } = await bootstrapPopup({
    signInResult: {
      data: {
        session: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
        user: {
          id: "user-1",
          email: "teste@example.com",
        },
      },
      error: null,
    },
  });

  const form = window.document.getElementById("login-form");
  window.document.getElementById("login-email").value = "teste@example.com";
  window.document.getElementById("login-password").value = "12345678";

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(signInCalls.length, 1);
  assert.equal(window.document.getElementById("dashboard-section").classList.contains("hidden"), false);
  assert.equal(window.document.getElementById("login-error").textContent, "");
  assert.equal(window.document.getElementById("app-version").textContent, "v9.9.9-test");
});

test("popup copies the last saved Word diagnostic", async () => {
  const savedProbe = {
    phase: "snapshot-500ms",
    diagnostics: {
      expectedText: "/juris",
      replacementText: "What is Lorem Ipsum?",
    },
  };

  const { window, clipboardWrites } = await bootstrapPopup({
    localStorageArea: {
      minutario_last_word_probe: savedProbe,
    },
  });

  window.showDashboard({ email: "teste@example.com" });
  window.document.getElementById("copy-word-probe").click();
  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(clipboardWrites.length, 1);
  assert.match(clipboardWrites[0], /snapshot-500ms/);
  assert.match(clipboardWrites[0], /\/juris/);
  assert.equal(window.document.getElementById("word-probe-status").textContent, "Diagnóstico copiado.");
});

test("popup updates password for authenticated user", async () => {
  const { window, updateUserCalls } = await bootstrapPopup({
    signInResult: {
      data: {
        session: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
        user: {
          id: "user-1",
          email: "teste@example.com",
        },
      },
      error: null,
    },
  });

  window.showDashboard({ email: "teste@example.com" });
  window.document.getElementById("toggle-password-form").click();
  window.document.getElementById("new-password").value = "novaSenha123";
  window.document.getElementById("confirm-password").value = "novaSenha123";
  window.document
    .getElementById("password-form")
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(updateUserCalls.length, 1);
  assert.equal(updateUserCalls[0].password, "novaSenha123");
  assert.equal(window.document.getElementById("account-status").textContent, "Senha atualizada com sucesso.");
});
