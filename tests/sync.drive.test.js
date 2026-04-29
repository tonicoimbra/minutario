const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scriptPath = path.join(__dirname, "..", "dashboard", "sync", "drive.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

function bootstrapDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  var tokenCounter = 0;
  var fetchCalls = [];

  window.chrome = {
    runtime: { lastError: null },
    identity: {
      getAuthToken: function (opts, callback) {
        tokenCounter += 1;
        callback("fake-token-" + tokenCounter);
      },
      removeCachedAuthToken: function (details, callback) {
        if (callback) callback();
      },
    },
  };

  window.fetch = function (url, options) {
    fetchCalls.push({ url: url, method: options && options.method });

    // Mock file search
    if (url.includes("/drive/v3/files?q=")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () {
          return Promise.resolve({ files: [{ id: "file-123", name: "minutario-backup.json" }] });
        },
      });
    }

    // Mock download
    if (url.includes("?alt=media")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: function () {
          return Promise.resolve(JSON.stringify({ tpl_1: { id: "1", name: "Test" } }));
        },
      });
    }

    // Mock upload
    if (url.includes("/upload/drive/v3/files")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () {
          return Promise.resolve({ id: "file-456" });
        },
      });
    }

    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  };

  window.eval(scriptSource);
  return { window, fetchCalls };
}

test("DriveSync.init returns true when auth succeeds", async () => {
  const { window } = bootstrapDom();
  const result = await window.DriveSync.init();
  assert.equal(result, true);
});

test("DriveSync.backup uploads JSON to Drive", async () => {
  const { window, fetchCalls } = bootstrapDom();
  const result = await window.DriveSync.backup({ tpl_1: { id: "1", name: "A" } });
  assert.equal(result.success, true);
  assert.equal(result.fileId, "file-456");
  var uploadCall = fetchCalls.find(function (c) { return c.url.includes("upload"); });
  assert.ok(uploadCall);
});

test("DriveSync.restore downloads backup from Drive", async () => {
  const { window } = bootstrapDom();
  const result = await window.DriveSync.restore();
  assert.equal(result.success, true);
  assert.equal(result.data.tpl_1.name, "Test");
});

test("DriveSync.restore fails when no backup exists", async () => {
  const { window } = bootstrapDom();
  // Override fetch for this test
  window.fetch = function (url) {
    if (url.includes("/drive/v3/files?q=")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () { return Promise.resolve({ files: [] }); },
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  };
  const result = await window.DriveSync.restore();
  assert.equal(result.success, false);
  assert.ok(result.error.includes("Nenhum backup"));
});
