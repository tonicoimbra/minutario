const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scriptPath = path.join(__dirname, "..", "dashboard", "sync", "supabase.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

function bootstrapDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  var mockUser = { id: "user-abc" };
  var mockSession = { user: mockUser };
  var db = { templates: [], folders: [] };

  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: async function () {
            return { data: { session: mockSession }, error: null };
          },
          getUser: async function () {
            return { data: { user: mockUser }, error: null };
          },
          signInWithPassword: async function (creds) {
            if (creds.email === "test@test.com" && creds.password === "pass") {
              return { data: { session: mockSession }, error: null };
            }
            return { data: { session: null }, error: { message: "Invalid credentials" } };
          },
          signOut: async function () {
            mockSession = null;
            return { error: null };
          },
        },
        from: function (table) {
          return {
            select: function () {
              return {
                eq: async function () {
                  return { data: db[table], error: null };
                },
              };
            },
            upsert: async function (rows) {
              db[table] = rows;
              return { error: null };
            },
          };
        },
      };
    },
  };

  window.eval(scriptSource);
  return { window, db };
}

test("SupabaseSync.init returns true when session exists", async () => {
  const { window } = bootstrapDom();
  const result = await window.SupabaseSync.init();
  assert.equal(result.success, true);
});

test("SupabaseSync.signIn succeeds with valid credentials", async () => {
  const { window } = bootstrapDom();
  const result = await window.SupabaseSync.signIn("test@test.com", "pass");
  assert.equal(result.success, true);
  assert.ok(result.session);
});

test("SupabaseSync.signIn fails with invalid credentials", async () => {
  const { window } = bootstrapDom();
  const result = await window.SupabaseSync.signIn("bad", "bad");
  assert.equal(result.success, false);
  assert.ok(result.error);
});

test("SupabaseSync.push stores templates and folders", async () => {
  const { window, db } = bootstrapDom();
  var templates = {
    "1": { id: "1", name: "T1", shortcut: "t1", content: "<p>A</p>", folderId: null, createdAt: 1, updatedAt: 2 },
  };
  var folders = [{ id: "f1", name: "Docs", order: 0 }];
  var result = await window.SupabaseSync.push(templates, folders);
  assert.equal(result.success, true);
  assert.equal(db.templates.length, 1);
  assert.equal(db.folders.length, 1);
});

test("SupabaseSync.pull returns templates and folders", async () => {
  const { window, db } = bootstrapDom();
  db.templates = [
    { id: "1", name: "T1", shortcut: "t1", content: "<p>A</p>", folder_id: null, created_at: "2024-01-01", updated_at: "2024-01-01" },
  ];
  db.folders = [{ id: "f1", name: "Docs", order_idx: 0 }];
  var result = await window.SupabaseSync.pull();
  assert.equal(result.success, true);
  assert.equal(result.templates.length, 1);
  assert.equal(result.templates[0].name, "T1");
  assert.equal(result.folders.length, 1);
  assert.equal(result.folders[0].order, 0);
});
