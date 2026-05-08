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
  const signUpCalls = [];
  const signInCalls = [];
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
          async signUp() {
            signUpCalls.push(true);
            return options.signUpResult;
          },
          async signInWithPassword(creds) {
            signInCalls.push(creds);
            return options.signInResult;
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

  return { window, signUpCalls, signInCalls, clipboardWrites };
}

test("popup signup falls back to login when user is already registered", async () => {
  const { window, signUpCalls, signInCalls } = await bootstrapPopup({
    signUpResult: {
      data: { session: null, user: null },
      error: { message: "User already registered" },
    },
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
  window.document.getElementById("toggle-auth-mode").click();
  window.document.getElementById("login-email").value = "teste@example.com";
  window.document.getElementById("login-password").value = "12345678";
  window.document.getElementById("login-password-confirm").value = "12345678";

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(signUpCalls.length, 1);
  assert.equal(signInCalls.length, 1);
  assert.equal(window.document.getElementById("dashboard-section").classList.contains("hidden"), false);
  assert.equal(window.document.getElementById("login-error").textContent, "");
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
