const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backgroundPath = path.join(__dirname, "..", "background.js");
const backgroundSource = fs.readFileSync(backgroundPath, "utf8");

function loadBackground(options) {
  options = options || {};
  const errors = [];

  const context = {
    module: { exports: {} },
    exports: {},
    console: {
      error: function () {
        errors.push(Array.from(arguments));
      },
      warn() {},
      info() {},
      log() {},
      debug() {},
    },
    importScripts() {},
    chrome: {
      storage: {
        local: {
          get: options.get || (async function () { return {}; }),
          set: options.set || (async function () {}),
        },
        sync: {
          get: async function () { return {}; },
        },
      },
      alarms: {
        onAlarm: { addListener() {} },
        create() {},
      },
      runtime: {
        getURL(file) {
          return "chrome-extension://test/" + file;
        },
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} },
        onMessage: { addListener() {} },
      },
      commands: {
        onCommand: { addListener() {} },
      },
      debugger: options.debugger || {
        attach: async function () {},
        sendCommand: async function () {},
        detach: async function () {},
      },
      tabs: {
        query: async function () { return []; },
        update: async function () {},
        create: async function () {},
        sendMessage: async function () {},
      },
      windows: {
        update: async function () {},
        create: async function () {},
      },
    },
  };
  context.globalThis = context;

  vm.runInNewContext(
    backgroundSource +
      "\nmodule.exports = { runStartupMigration, migrationState, migrationPromise, isBenignStorageMigrationError, getErrorMessage, pasteWithDebugger, insertTextWithDebugger };",
    context,
    { filename: "background.js" }
  );

  return {
    api: context.module.exports,
    errors: errors,
  };
}

test("ignores benign extension context invalidation during startup migration", async () => {
  const instance = loadBackground({
    get: async function () {
      throw new Error("Extension context invalidated.");
    },
  });

  await instance.api.migrationPromise;

  assert.equal(instance.api.migrationState.failed, false);
  assert.equal(instance.errors.length, 0);
});

test("marks migration as failed for real storage errors", async () => {
  const instance = loadBackground({
    get: async function () {
      throw new Error("Quota exceeded");
    },
  });

  await instance.api.migrationPromise;

  assert.equal(instance.api.migrationState.failed, true);
  assert.equal(instance.errors.length, 1);
});

test("logs storage migration failures as a single useful string", async () => {
  const instance = loadBackground({
    get: async function () {
      throw {
        message: { text: "Quota exceeded" },
        code: "QUOTA",
      };
    },
  });

  await instance.api.migrationPromise;

  assert.equal(instance.errors.length, 1);
  assert.equal(instance.errors[0].length, 1);
  assert.match(
    instance.errors[0][0],
    /Storage migration error step=read key=storageVersion message=\{"message":\{"text":"Quota exceeded"\},"code":"QUOTA"\}/
  );
});

test("extracts useful text from plain object exceptions", async () => {
  const instance = loadBackground();

  assert.equal(
    instance.api.getErrorMessage({
      message: { text: "Quota exceeded" },
      code: "QUOTA",
    }),
    '{"message":{"text":"Quota exceeded"},"code":"QUOTA"}'
  );
});

test("ignores benign invalidation errors nested inside plain objects", async () => {
  const instance = loadBackground({
    get: async function () {
      throw {
        lastError: {
          message: "Extension context invalidated.",
        },
      };
    },
  });

  await instance.api.migrationPromise;

  assert.equal(instance.api.migrationState.failed, false);
  assert.equal(instance.errors.length, 0);
});

test("dispatches Word Online paste through a short debugger session", async () => {
  const calls = [];
  const instance = loadBackground({
    debugger: {
      attach: async function (target, version) {
        calls.push(["attach", target.tabId, version]);
      },
      sendCommand: async function (target, command, payload) {
        calls.push(["sendCommand", target.tabId, command, payload.type, payload.key || ""]);
      },
      detach: async function (target) {
        calls.push(["detach", target.tabId]);
      },
    },
  });

  const result = await instance.api.pasteWithDebugger({ tab: { id: 42 } });

  assert.equal(result.ok, true);
  assert.equal(result.data.pasted, true);
  assert.deepEqual(calls[0], ["attach", 42, "1.3"]);
  assert.deepEqual(calls.at(-1), ["detach", 42]);
  assert.equal(
    calls.some(function (call) {
      return call[2] === "Input.dispatchKeyEvent" && call[4] === "v";
    }),
    true
  );
});

test("inserts Word Online plain text through CDP Input.insertText", async () => {
  const calls = [];
  const instance = loadBackground({
    debugger: {
      attach: async function (target, version) {
        calls.push(["attach", target.tabId, version]);
      },
      sendCommand: async function (target, command, payload) {
        calls.push(["sendCommand", target.tabId, command, payload.text]);
      },
      detach: async function (target) {
        calls.push(["detach", target.tabId]);
      },
    },
  });

  const result = await instance.api.insertTextWithDebugger(
    { tab: { id: 7 } },
    { text: "Texto expandido" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.inserted, true);
  assert.deepEqual(calls[0], ["attach", 7, "1.3"]);
  assert.deepEqual(calls[1], ["sendCommand", 7, "Input.insertText", "Texto expandido"]);
  assert.deepEqual(calls[2], ["detach", 7]);
});
