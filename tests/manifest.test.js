const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "manifest.json");
const firefoxManifestPath = path.join(__dirname, "..", "firefox", "manifest.json");

test("manifest exposes the content script on all pages", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.indexOf("<all_urls>") !== -1);
  assert.equal(manifest.content_scripts[0].matches[0], "<all_urls>");
  assert.equal(manifest.content_scripts[0].all_frames, true);
});

test("firefox manifest uses background scripts instead of service worker", () => {
  const manifest = JSON.parse(fs.readFileSync(firefoxManifestPath, "utf8"));

  assert.ok(manifest.background);
  assert.ok(Array.isArray(manifest.background.scripts));
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.background, "service_worker"), false);
  assert.ok(manifest.background.scripts.indexOf("background.js") !== -1);
});
