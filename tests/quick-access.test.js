const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const configSource = fs.readFileSync(
  path.join(__dirname, "..", "shared", "config.js"),
  "utf8"
);
const htmlSource = fs.readFileSync(
  path.join(__dirname, "..", "quick-access", "quick-access.html"),
  "utf8"
);
const scriptSource = fs.readFileSync(
  path.join(__dirname, "..", "quick-access", "quick-access.js"),
  "utf8"
);
const wordClipboardSource = fs.readFileSync(
  path.join(__dirname, "..", "shared", "word-clipboard.js"),
  "utf8"
);

async function bootstrapQuickAccess() {
  const dom = new JSDOM(htmlSource, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.test/quick-access/quick-access.html",
  });
  const { window } = dom;
  const sentMessages = [];
  const clipboardWrites = [];

  window.chrome = {
    runtime: {
      async sendMessage(message) {
        sentMessages.push(message);

        if (message.type === "GET_TEMPLATES") {
          return {
            ok: true,
            data: [
              {
                id: "tpl-1",
                name: "Recurso Especial",
                shortcut: "recurso",
                content: "<p><strong>Recurso</strong> pronto</p>",
                folder_id: "folder-1",
              },
              {
                id: "tpl-2",
                name: "Despacho Inicial",
                shortcut: "despacho",
                content: "<p>Despacho</p>",
                folder_id: "folder-2",
              },
            ],
          };
        }

        if (message.type === "GET_FOLDERS") {
          return {
            ok: true,
            data: [
              { id: "folder-1", name: "Recursos", order_idx: 0 },
              { id: "folder-2", name: "Despachos", order_idx: 1 },
            ],
          };
        }

        if (message.type === "GET_RECENT") {
          return {
            ok: true,
            data: ["tpl-2"],
          };
        }

        if (message.type === "FORCE_SYNC") {
          return {
            ok: true,
            data: { updated: false },
          };
        }

        return { ok: true };
      },
      getURL(value) {
        return value;
      },
    },
    tabs: {
      create() {},
    },
  };

  window.ClipboardItem = function ClipboardItem(items) {
    this.items = items;
  };
  window.Blob = class TestBlob {
    constructor(parts, options) {
      this.parts = parts || [];
      this.type = options && options.type ? options.type : "";
    }

    async text() {
      return this.parts.map((part) => String(part)).join("");
    }
  };

  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      async write(items) {
        clipboardWrites.push(items);
      },
      async writeText(value) {
        clipboardWrites.push(value);
      },
    },
  });

  window.eval(configSource);
  window.eval(wordClipboardSource);
  window.eval(scriptSource);
  await new Promise((resolve) => window.setTimeout(resolve, 30));

  return { window, sentMessages, clipboardWrites };
}

test("quick access opens with all templates selected", async () => {
  const { window } = await bootstrapQuickAccess();
  const rows = window.document.querySelectorAll(".result-item");

  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Despacho Inicial|Recurso Especial/);
  assert.equal(window.document.getElementById("tab-recent"), null);
});

test("quick access filters by search and folder chips", async () => {
  const { window } = await bootstrapQuickAccess();

  window.document.getElementById("template-search").value = "/recurso";
  window.document
    .getElementById("template-search")
    .dispatchEvent(new window.Event("input", { bubbles: true }));

  await new Promise((resolve) => window.setTimeout(resolve, 0));

  let rows = window.document.querySelectorAll(".result-item");
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Recurso Especial/);

  const chips = window.document.querySelectorAll(".folder-chip");
  chips[2].click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  rows = window.document.querySelectorAll(".result-item");
  assert.equal(rows.length, 0);
});

test("quick access copies selected template with rich clipboard payload", async () => {
  const { window, clipboardWrites } = await bootstrapQuickAccess();

  window.document.getElementById("template-search").value = "/recurso";
  window.document
    .getElementById("template-search")
    .dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  window.document.getElementById("copy-template").click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  assert.equal(clipboardWrites.length, 1);
  assert.ok(Array.isArray(clipboardWrites[0]));
  const item = clipboardWrites[0][0];
  const html = await item.items["text/html"].text();
  const plain = await item.items["text/plain"].text();

  assert.match(html, /xmlns:w="urn:schemas-microsoft-com:office:word"/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<strong[^>]*font-weight:bold[^>]*>Recurso<\/strong>/);
  assert.match(html, /font-size:11pt/);
  assert.equal(plain, "Recurso pronto");
});
