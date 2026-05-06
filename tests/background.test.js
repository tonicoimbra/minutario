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
      "\nmodule.exports = { runStartupMigration, migrationState, migrationPromise, isBenignStorageMigrationError, getErrorMessage };",
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
