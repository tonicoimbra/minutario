const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const configSource = fs.readFileSync(
  path.join(__dirname, "..", "shared", "config.js"),
  "utf8"
);
const apiSource = fs.readFileSync(
  path.join(__dirname, "..", "shared", "api.js"),
  "utf8"
);

function bootstrapApi() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const calls = [];

  window.supabase = {
    createClient() {
      return {
        from() {
          return {
            insert(payload) {
              calls.push({ type: "insert", payload });
              return {
                select() {
                  return {
                    single: async function () {
                      return { data: payload, error: null };
                    },
                  };
                },
              };
            },
            update(payload) {
              calls.push({ type: "update", payload });
              return {
                eq() {
                  return {
                    select() {
                      return {
                        single: async function () {
                          return { data: payload, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  window.eval(configSource);
  window.eval(apiSource);
  return { window, calls };
}

test("MinutarioAPI.createTemplate strips non-schema fields before insert", async () => {
  const { window, calls } = bootstrapApi();

  await window.MinutarioAPI.createTemplate({
    id: "tpl-1",
    user_id: "user-1",
    folder_id: "folder-1",
    folderId: "folder-1",
    name: "Contrato",
    shortcut: "contrato",
    content: "<p>Texto</p>",
    plain_text: "Texto",
    created_at: "2026-05-05T12:00:00.000Z",
    createdAt: 123,
    updated_at: "2026-05-05T12:05:00.000Z",
    updatedAt: 456,
    html_content: "<p>Texto</p>",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    type: "insert",
    payload: {
      id: "tpl-1",
      user_id: "user-1",
      folder_id: "folder-1",
      name: "Contrato",
      shortcut: "contrato",
      content: "<p>Texto</p>",
      plain_text: "Texto",
      created_at: "2026-05-05T12:00:00.000Z",
      updated_at: "2026-05-05T12:05:00.000Z",
    },
  });
});

test("MinutarioAPI.updateTemplate strips non-schema fields before update", async () => {
  const { window, calls } = bootstrapApi();

  await window.MinutarioAPI.updateTemplate("tpl-1", {
    id: "tpl-1",
    user_id: "user-1",
    folder_id: "folder-1",
    folderId: "folder-1",
    name: "Contrato atualizado",
    shortcut: "contrato",
    content: "<p>Texto novo</p>",
    plain_text: "Texto novo",
    created_at: "2026-05-05T12:00:00.000Z",
    createdAt: 123,
    updated_at: "2026-05-05T12:10:00.000Z",
    updatedAt: 456,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    type: "update",
    payload: {
      id: "tpl-1",
      user_id: "user-1",
      folder_id: "folder-1",
      name: "Contrato atualizado",
      shortcut: "contrato",
      content: "<p>Texto novo</p>",
      plain_text: "Texto novo",
      created_at: "2026-05-05T12:00:00.000Z",
      updated_at: "2026-05-05T12:10:00.000Z",
    },
  });
});
