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
const wordClipboardSource = fs.readFileSync(
  path.join(__dirname, "..", "shared", "word-clipboard.js"),
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
  const resetPasswordCalls = [];
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
    async saveAuthSession() {},
    async clearAuthSession() {},
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
          async resetPasswordForEmail(email, opts) {
            resetPasswordCalls.push({ email, opts });
            return options.resetPasswordResult || { data: {}, error: null };
          },
          async signOut() {
            return {};
          },
        },
      };
    },
  };
  window.MinutarioConfig = {
    PASSWORD_RESET_REDIRECT_URL: options.passwordResetRedirectUrl || "",
  };
  window.MinutarioSync = {
    async prepareUserContext() {
      return false;
    },
    async syncTemplates() {
      return { success: true };
    },
  };

  window.eval(wordClipboardSource);
  window.eval(popupSource);
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  return { window, signInCalls, updateUserCalls, resetPasswordCalls, clipboardWrites };
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

test("popup hides Word diagnostic and recent-empty UI", async () => {
  const { window } = await bootstrapPopup();

  assert.equal(window.document.getElementById("copy-word-probe"), null);
  assert.equal(window.document.getElementById("word-probe-status"), null);
  assert.equal(window.document.getElementById("recent-list"), null);
  assert.equal(window.document.body.textContent.includes("Nenhum template usado ainda."), false);
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

test("popup sends password reset email with configured redirect", async () => {
  const { window, resetPasswordCalls } = await bootstrapPopup({
    passwordResetRedirectUrl: "https://example.test/reset",
  });

  window.document.getElementById("login-email").value = "teste@example.com";
  window.document.getElementById("forgot-password").click();

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(resetPasswordCalls.length, 1);
  assert.equal(resetPasswordCalls[0].email, "teste@example.com");
  assert.equal(resetPasswordCalls[0].opts.redirectTo, "https://example.test/reset");
  assert.match(window.document.getElementById("login-error").textContent, /Enviamos um link/);
});
