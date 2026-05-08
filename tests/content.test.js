const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scriptPath = path.join(__dirname, "..", "content.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

function bootstrapDom(html, options) {
  const dom = new JSDOM(
    html,
    Object.assign(
      {
        runScripts: "outside-only",
        pretendToBeVisual: true,
      },
      options || {}
    )
  );

  const { window } = dom;
  const localStorageArea = {};

  window.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") {
            return { [key]: localStorageArea[key] };
          }
          return Object.assign({}, localStorageArea);
        },
        async set(items) {
          Object.assign(localStorageArea, items);
        },
      },
      sync: {
        get: async () => ({}),
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      sendMessage() {},
      onMessage: {
        addListener() {},
      },
    },
  };

  window.eval(scriptSource);
  dom.localStorageArea = localStorageArea;
  return dom;
}

function placeCaretAtEnd(window, element) {
  const selection = window.getSelection();
  const range = window.document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getSelectionSnapshot(window) {
  const selection = window.getSelection();
  return {
    text: selection.toString(),
    rangeCount: selection.rangeCount,
    anchorNodeText:
      selection.anchorNode && selection.anchorNode.nodeType === 3
        ? selection.anchorNode.nodeValue
        : selection.anchorNode && selection.anchorNode.textContent,
    anchorOffset: selection.anchorOffset,
    isCollapsed: selection.isCollapsed,
  };
}

test("expands shortcut by replacing typed text with formatted HTML", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  placeCaretAtEnd(window, editor);

  assert.ok(window.MacroBlazeContent, "MacroBlazeContent API should be exposed");

  const expanded = window.MacroBlazeContent.expandTemplateAtSelection(
    window.document,
    "/contrato",
    "<strong>Contrato pronto</strong>",
    "Contrato pronto"
  );

  assert.equal(expanded, true);
  assert.match(editor.innerHTML, /<strong>Contrato pronto<\/strong>/);
  assert.doesNotMatch(editor.textContent, /\/contrato/);
});

test("uses rich clipboard paste data before falling back to DOM insertion", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  const clipboardWrites = [];
  let pastedHtml = "";
  let pastedText = "";

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async (items) => {
        clipboardWrites.push(items);
      },
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    pastedHtml = event.clipboardData.getData("text/html");
    pastedText = event.clipboardData.getData("text/plain");

    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const template = window.document.createElement("template");
    template.innerHTML = pastedHtml;

    range.deleteContents();
    range.insertNode(template.content);
  });

  placeCaretAtEnd(window, editor);

  assert.equal(
    typeof window.MacroBlazeContent.expandTemplateAtSelectionRich,
    "function"
  );

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/contrato",
    "<div>Contrato <strong>pronto</strong> com <em>itálico</em></div>",
    "Contrato pronto com itálico"
  );

  assert.equal(expanded, true);
  assert.equal(clipboardWrites.length, 1);
  assert.equal(
    pastedHtml,
    "<p>Contrato <strong>pronto</strong> com <em>itálico</em></p>"
  );
  assert.equal(pastedText, "Contrato pronto com itálico");
  assert.match(editor.innerHTML, /<strong>pronto<\/strong>/);
  assert.match(editor.innerHTML, /<em>itálico<\/em>/);
  assert.doesNotMatch(editor.textContent, /\/contrato/);
});

test("expands immediately even when clipboard write is still pending", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  const clipboardWrites = [];
  let resolveClipboardWrite;

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async (items) => {
        clipboardWrites.push(items);
        await new Promise((resolve) => {
          resolveClipboardWrite = resolve;
        });
      },
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const template = window.document.createElement("template");
    template.innerHTML = event.clipboardData.getData("text/html");

    editor.innerHTML = "";
    range.insertNode(template.content);
    placeCaretAtEnd(window, editor);
  });

  placeCaretAtEnd(window, editor);

  const expansionPromise = window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/contrato",
    "<strong>Contrato pronto</strong>",
    "Contrato pronto"
  );

  await new Promise((resolve) => window.setTimeout(resolve, 0));

  assert.equal(clipboardWrites.length, 1);
  assert.equal(editor.textContent, "Contrato pronto");
  assert.doesNotMatch(editor.textContent, /\/contrato/);

  resolveClipboardWrite();

  const expanded = await expansionPromise;
  assert.equal(expanded, true);
});

test("falls back to DOM insertion when the host cancels paste without inserting content", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/taldo</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/taldo",
    "<strong>é o taldo Rhey Dhellas</strong>",
    "é o taldo Rhey Dhellas"
  );

  assert.equal(expanded, true);
  assert.equal(editor.textContent, "é o taldo Rhey Dhellas");
  assert.doesNotMatch(editor.textContent, /\/taldo/);
});

test("deletes typed shortcut before rich paste insertion", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/caso01</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const template = window.document.createElement("template");
    template.innerHTML = event.clipboardData.getData("text/html");

    range.insertNode(template.content);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/caso01",
    "<strong>Caso formatado</strong>",
    "Caso formatado"
  );

  assert.equal(expanded, true);
  assert.equal(editor.textContent, "Caso formatado");
  assert.match(editor.innerHTML, /<strong>Caso formatado<\/strong>/);
  assert.doesNotMatch(editor.textContent, /\/caso01/);
});

test("replaces the typed shortcut in Word-like editors that handle paste with an internal model", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/teste</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const template = window.document.createElement("template");
    template.innerHTML = event.clipboardData.getData("text/html");
    const fragment = template.content.cloneNode(true);

    if (range.collapsed) {
      editor.textContent = "/teste";
      editor.appendChild(fragment);
      placeCaretAtEnd(window, editor);
      return;
    }

    range.insertNode(fragment);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/teste",
    "<strong>este é o primeiro teste da nova formatacao</strong>",
    "este é o primeiro teste da nova formatacao"
  );

  assert.equal(expanded, true);
  assert.equal(editor.textContent, "este é o primeiro teste da nova formatacao");
  assert.doesNotMatch(editor.textContent, /\/teste/);
});

test("replaces the typed shortcut when the host paste model only reacts after DOM deletion", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const pastedHtml = event.clipboardData.getData("text/html");
    const template = window.document.createElement("template");
    template.innerHTML = pastedHtml;
    const fragment = template.content.cloneNode(true);

    if ((editor.textContent || "").indexOf("/juris") !== -1) {
      editor.appendChild(fragment);
      placeCaretAtEnd(window, editor);
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(fragment);
    placeCaretAtEnd(window, editor);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>What is Lorem Ipsum?</strong>",
    "What is Lorem Ipsum?"
  );

  assert.equal(expanded, true);
  assert.equal(editor.textContent, "What is Lorem Ipsum?");
  assert.doesNotMatch(editor.textContent, /\/juris/);
});

test("deletes shortcut through the host editing command before rich paste", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="visual"></div><div id="editor" contenteditable="true">/juris</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  const visual = window.document.getElementById("visual");
  let hostModelText = "/juris ";

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  window.document.execCommand = (command) => {
    if (command !== "delete") {
      return false;
    }

    const selection = window.getSelection();
    if (!selection || selection.toString() !== "/juris") {
      return false;
    }

    hostModelText = "";
    editor.textContent = "";
    return true;
  };

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const pastedText = event.clipboardData.getData("text/plain");
    const pastedHtml = event.clipboardData.getData("text/html");
    const template = window.document.createElement("template");
    template.innerHTML = pastedHtml;

    visual.textContent = hostModelText + pastedText;
    editor.innerHTML = hostModelText;
    editor.appendChild(template.content.cloneNode(true));
    placeCaretAtEnd(window, editor);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>este é um exemplo de minuta</strong>",
    "este é um exemplo de minuta"
  );

  assert.equal(expanded, true);
  assert.equal(visual.textContent, "este é um exemplo de minuta");
  assert.doesNotMatch(visual.textContent, /\/juris/);
});

test("Word expansion avoids synthetic paste and host delete command", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="visual"></div><div id="editor" contenteditable="true">/juris</div></body></html>',
    {
      url: "https://brc-word-edit.officeapps.live.com/we/wordeditorframe.aspx",
      referrer: "https://tjpr-my.sharepoint.com/",
    }
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  const visual = window.document.getElementById("visual");
  let fullDocumentLoaderShown = false;
  let pasteEventDispatched = false;
  let hostModelText = "/juris";

  window.document.execCommand = (command, showUI, value) => {
    if (command === "delete") {
      fullDocumentLoaderShown = true;
      return true;
    }
    if (command === "insertHTML") {
      const template = window.document.createElement("template");
      template.innerHTML = value || "";
      hostModelText = template.content.textContent || "";
      editor.innerHTML = value || "";
      placeCaretAtEnd(window, editor);
      return true;
    }
    return false;
  };

  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    pasteEventDispatched = true;
    fullDocumentLoaderShown = true;
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>este é um exemplo de minuta</strong>",
    "este é um exemplo de minuta"
  );

  window.setTimeout(() => {
    editor.textContent = hostModelText;
    placeCaretAtEnd(window, editor);
  }, 20);

  await new Promise((resolve) => window.setTimeout(resolve, 40));

  assert.equal(expanded, true);
  visual.textContent = editor.textContent;
  assert.equal(visual.textContent, "este é um exemplo de minuta");
  assert.equal(pasteEventDispatched, false);
  assert.equal(fullDocumentLoaderShown, false);
  assert.doesNotMatch(visual.textContent, /\/juris/);
});

test("Word expansion waits for host selection sync before plain text command", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/multa</div></body></html>',
    {
      url: "https://brc-word-edit.officeapps.live.com/we/wordeditorframe.aspx",
      referrer: "https://tjpr-my.sharepoint.com/",
    }
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  const commands = [];
  const plainText = "este é um exemplo de multa";
  let hostModelText = "/multa";
  let selectionReady = false;
  Promise.resolve().then(() => {
    selectionReady = true;
  });

  window.document.execCommand = (command, showUI, value) => {
    commands.push(command);

    if (command === "insertHTML") {
      const template = window.document.createElement("template");
      template.innerHTML = value || "";
      hostModelText += template.content.textContent || "";
      editor.textContent = hostModelText;
      placeCaretAtEnd(window, editor);
      return true;
    }

    if (command === "insertText") {
      hostModelText = selectionReady ? value || "" : hostModelText + (value || "");
      editor.textContent = hostModelText;
      placeCaretAtEnd(window, editor);
      return true;
    }

    if (command === "delete") {
      throw new Error("Word path must not use host delete");
    }

    return false;
  };

  editor.addEventListener("paste", () => {
    throw new Error("Word path must not dispatch synthetic paste");
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/multa",
    "<strong>este é um exemplo de multa</strong>",
    plainText
  );

  window.setTimeout(() => {
    editor.textContent = hostModelText;
    placeCaretAtEnd(window, editor);
  }, 0);

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(expanded, true);
  assert.equal(commands[0], "insertText");
  assert.equal(editor.textContent, plainText);
  assert.doesNotMatch(editor.textContent, /\/multa/);
});

test("Word expansion defers host edit command until after selection can settle", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>',
    {
      url: "https://brc-word-edit.officeapps.live.com/we/wordeditorframe.aspx",
      referrer: "https://tjpr-my.sharepoint.com/",
    }
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  const commands = [];

  window.document.execCommand = (command, showUI, value) => {
    commands.push(command);
    if (command !== "insertText") {
      return false;
    }
    editor.textContent = value || "";
    placeCaretAtEnd(window, editor);
    return true;
  };

  placeCaretAtEnd(window, editor);

  const expansionPromise = window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>este é um exemplo de minuta</strong>",
    "este é um exemplo de minuta"
  );

  assert.deepEqual(commands, []);

  const expanded = await expansionPromise;

  assert.equal(expanded, true);
  assert.deepEqual(commands, ["insertText"]);
  assert.equal(editor.textContent, "este é um exemplo de minuta");
});

test("Word expansion falls back to rich paste when host edit command is unavailable", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>',
    {
      url: "https://brc-word-edit.officeapps.live.com/we/wordeditorframe.aspx",
      referrer: "https://tjpr-my.sharepoint.com/",
    }
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  let pasteEventDispatched = false;
  let hostDeleteAttempted = false;

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  window.document.execCommand = (command) => {
    if (command === "delete") {
      hostDeleteAttempted = true;
    }
    return false;
  };

  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    pasteEventDispatched = true;

    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const template = window.document.createElement("template");
    template.innerHTML = event.clipboardData.getData("text/html");

    range.deleteContents();
    range.insertNode(template.content.cloneNode(true));
    placeCaretAtEnd(window, editor);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>este é um exemplo de minuta</strong>",
    "este é um exemplo de minuta"
  );

  assert.equal(expanded, true);
  assert.equal(pasteEventDispatched, true);
  assert.equal(hostDeleteAttempted, false);
  assert.equal(editor.textContent, "este é um exemplo de minuta");
  assert.doesNotMatch(editor.textContent, /\/juris/);
});

test("persists Word probe without console output when debug logs are disabled", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>',
    {
      url: "https://brc-word-edit.officeapps.live.com/we/wordeditorframe.aspx",
      referrer: "https://tjpr-my.sharepoint.com/",
    }
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  let infoCalls = 0;

  window.console.info = function () {
    infoCalls += 1;
  };

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>este é um exemplo de minuta</strong>",
    "este é um exemplo de minuta"
  );

  await new Promise((resolve) => window.setTimeout(resolve, 20));

  assert.equal(expanded, true);
  assert.equal(infoCalls, 0);
  assert.ok(dom.localStorageArea.minutario_last_word_probe);
});

test("replaces the typed shortcut inside a Word surface root that is not contenteditable", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="WACViewPanel_EditingElement" class="Safari usehover WACEditing EditMode EditingSurfaceBody">/juris</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("WACViewPanel_EditingElement");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const template = window.document.createElement("template");
    template.innerHTML = event.clipboardData.getData("text/html");
    const fragment = template.content.cloneNode(true);

    editor.textContent = "";
    range.insertNode(fragment);
    placeCaretAtEnd(window, editor);
  });

  editor.setAttribute("tabindex", "-1");
  editor.focus();
  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>What is Lorem Ipsum?</strong>",
    "What is Lorem Ipsum?"
  );

  assert.equal(expanded, true);
  assert.equal(editor.textContent, "What is Lorem Ipsum?");
  assert.doesNotMatch(editor.textContent, /\/juris/);
});

test("removes the typed shortcut when the host editor rehydrates its model asynchronously", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/teste</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const pastedHtml = event.clipboardData.getData("text/html");
    const template = window.document.createElement("template");
    template.innerHTML = pastedHtml;
    const fragment = template.content.cloneNode(true);
    editor.innerHTML = "";
    editor.appendChild(fragment);

    window.setTimeout(() => {
      editor.textContent = "/teste ";
      const rehydratedTemplate = window.document.createElement("template");
      rehydratedTemplate.innerHTML = pastedHtml;
      editor.appendChild(rehydratedTemplate.content.cloneNode(true));
      placeCaretAtEnd(window, editor);
    }, 0);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/teste",
    "<strong>este é o primeiro teste da nova formatacao</strong>",
    "este é o primeiro teste da nova formatacao"
  );

  assert.equal(expanded, true);

  await new Promise((resolve) => window.setTimeout(resolve, 10));

  assert.equal(editor.textContent, "este é o primeiro teste da nova formatacao");
  assert.doesNotMatch(editor.textContent, /\/teste/);
});

test("removes the typed shortcut when the host editor rehydrates it with invisible separator characters", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const pastedHtml = event.clipboardData.getData("text/html");
    const template = window.document.createElement("template");
    template.innerHTML = pastedHtml;
    editor.innerHTML = "";
    editor.appendChild(template.content.cloneNode(true));

    window.setTimeout(() => {
      editor.innerHTML = "";
      editor.appendChild(window.document.createTextNode("/ju\u200Bris "));
      const rehydratedTemplate = window.document.createElement("template");
      rehydratedTemplate.innerHTML = pastedHtml;
      editor.appendChild(rehydratedTemplate.content.cloneNode(true));
      placeCaretAtEnd(window, editor);
    }, 0);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>conteudo expandido</strong>",
    "conteudo expandido"
  );

  assert.equal(expanded, true);

  await new Promise((resolve) => window.setTimeout(resolve, 10));

  assert.equal(editor.textContent, "conteudo expandido");
  assert.doesNotMatch(editor.textContent, /juris/);
});

test("removes the typed shortcut when the host editor rehydrates it after a delayed model sync", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const pastedHtml = event.clipboardData.getData("text/html");
    const template = window.document.createElement("template");
    template.innerHTML = pastedHtml;
    editor.innerHTML = "";
    editor.appendChild(template.content.cloneNode(true));

    window.setTimeout(() => {
      editor.textContent = "/juris ";
      const rehydratedTemplate = window.document.createElement("template");
      rehydratedTemplate.innerHTML = pastedHtml;
      editor.appendChild(rehydratedTemplate.content.cloneNode(true));
      placeCaretAtEnd(window, editor);
    }, 250);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>What is Lorem Ipsum?</strong>",
    "What is Lorem Ipsum?"
  );

  assert.equal(expanded, true);

  await new Promise((resolve) => window.setTimeout(resolve, 400));

  assert.equal(editor.textContent, "What is Lorem Ipsum?");
  assert.doesNotMatch(editor.textContent, /\/juris/);
});

test("recovers the expansion when the host clears the editor after handling paste", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const pastedHtml = event.clipboardData.getData("text/html");
    const template = window.document.createElement("template");
    template.innerHTML = pastedHtml;
    editor.innerHTML = "";
    editor.appendChild(template.content.cloneNode(true));
    placeCaretAtEnd(window, editor);

    window.setTimeout(() => {
      editor.innerHTML = "";
      editor.appendChild(window.document.createTextNode("\u00a0\u00a0"));
      placeCaretAtEnd(window, editor);
    }, 250);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>What is Lorem Ipsum?</strong>",
    "What is Lorem Ipsum?"
  );

  assert.equal(expanded, true);

  await new Promise((resolve) => window.setTimeout(resolve, 400));

  assert.equal(editor.textContent, "What is Lorem Ipsum?");
  assert.doesNotMatch(editor.textContent, /\/juris/);
});

test("removes the typed shortcut when the host editor replaces the editable root node entirely", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="host"><div id="editor" contenteditable="true">/juris</div></div></body></html>'
  );
  const { window } = dom;
  const host = window.document.getElementById("host");
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const pastedHtml = event.clipboardData.getData("text/html");
    const replacement = window.document.createElement("div");
    replacement.id = "editor";
    replacement.setAttribute("contenteditable", "true");
    replacement.textContent = "/juris ";
    const template = window.document.createElement("template");
    template.innerHTML = pastedHtml;
    replacement.appendChild(template.content.cloneNode(true));
    host.replaceChild(replacement, host.firstChild);
    placeCaretAtEnd(window, replacement);
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>What is Lorem Ipsum?</strong>",
    "What is Lorem Ipsum?"
  );

  assert.equal(expanded, true);

  await new Promise((resolve) => window.setTimeout(resolve, 50));

  const replacement = window.document.getElementById("editor");
  assert.equal(replacement.textContent, "What is Lorem Ipsum?");
  assert.doesNotMatch(replacement.textContent, /\/juris/);
});

test("handles completion key synchronously when template is cached", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  placeCaretAtEnd(window, editor);

  assert.ok(
    typeof window.MacroBlazeContent.handleCompletionKey === "function",
    "handleCompletionKey API should be exposed"
  );

  window.MacroBlazeContent.setTemplateCache({
    contrato: {
      id: "tpl-1",
      shortcut: "contrato",
      content: "<strong>Contrato pronto</strong>",
    },
  });

  let prevented = false;
  const event = {
    key: " ",
    code: "Space",
    preventDefault() {
      prevented = true;
    },
  };

  const handled = window.MacroBlazeContent.handleCompletionKey(
    event,
    "/contrato",
    window.document
  );

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.match(editor.innerHTML, /<strong>Contrato pronto<\/strong>/);
});

test("normalizes Quill-flavored HTML into a word-friendly subset", () => {
  const dom = bootstrapDom("<!doctype html><html><body></body></html>");
  const { window } = dom;

  assert.ok(
    typeof window.MacroBlazeContent.normalizeTemplateHtml === "function",
    "normalizeTemplateHtml API should be exposed"
  );

  const normalized = window.MacroBlazeContent.normalizeTemplateHtml(
    window.document,
    [
      '<div class="ql-align-center">',
      '<span class="ql-size-large">Primeira <strong>linha</strong></span>',
      "</div>",
      '<div data-x="1">Segunda <em>linha</em><br><u>final</u></div>',
      '<ul class="ql-list"><li><span style="color:red">item</span></li></ul>',
    ].join("")
  );

  assert.equal(
    normalized,
    "<p>Primeira <strong>linha</strong></p><p>Segunda <em>linha</em><br><u>final</u></p><ul><li>item</li></ul>"
  );
});

test("expands shortcut via direct DOM insertion when execCommand is unavailable", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  window.document.execCommand = () => false;

  placeCaretAtEnd(window, editor);

  const expanded = window.MacroBlazeContent.expandTemplateAtSelection(
    window.document,
    "/contrato",
    "<strong>Contrato pronto</strong>",
    "Contrato pronto"
  );

  assert.equal(expanded, true);
  assert.equal(editor.innerHTML, "<strong>Contrato pronto</strong>");
  assert.doesNotMatch(editor.textContent, /\/contrato/);
});

test("places caret at the exact end of inserted block content", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  placeCaretAtEnd(window, editor);

  const expanded = window.MacroBlazeContent.expandTemplateAtSelection(
    window.document,
    "/contrato",
    "<div>Primeira <strong>linha</strong></div><div>Segunda linha</div>",
    "Primeira linha\nSegunda linha"
  );

  assert.equal(expanded, true);
  assert.equal(
    editor.innerHTML,
    "<p>Primeira <strong>linha</strong></p><p>Segunda linha</p>"
  );

  const selection = getSelectionSnapshot(window);
  assert.equal(selection.isCollapsed, true);
  assert.equal(selection.text, "");
  assert.equal(selection.anchorNodeText, "Segunda linha");
  assert.equal(selection.anchorOffset, "Segunda linha".length);
});

test("places caret after trailing empty block content", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  placeCaretAtEnd(window, editor);

  const expanded = window.MacroBlazeContent.expandTemplateAtSelection(
    window.document,
    "/contrato",
    "<div>Primeira linha</div><div><br></div>",
    "Primeira linha\n"
  );

  assert.equal(expanded, true);
  assert.equal(editor.innerHTML, "<p>Primeira linha</p><p><br></p>");

  const selection = window.getSelection();
  const trailingBlock = editor.lastChild;
  assert.equal(selection.isCollapsed, true);
  assert.equal(selection.anchorNode, trailingBlock);
  assert.equal(selection.anchorOffset, trailingBlock.childNodes.length);
});

test("expands shortcut inside a text input with plain text output", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><input id="editor" type="text" value="/contrato"></body></html>'
  );
  const { window } = dom;
  const input = window.document.getElementById("editor");

  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  window.MacroBlazeContent.setTemplateCache({
    contrato: {
      id: "tpl-1",
      shortcut: "contrato",
      content: "<strong>Contrato pronto</strong>",
    },
  });

  let prevented = false;
  const event = {
    key: " ",
    code: "Space",
    preventDefault() {
      prevented = true;
    },
  };

  const handled = window.MacroBlazeContent.handleCompletionKey(
    event,
    "/contrato",
    window.document
  );

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(input.value, "Contrato pronto");
  assert.equal(input.selectionStart, "Contrato pronto".length);
  assert.equal(input.selectionEnd, "Contrato pronto".length);
});

test("expands shortcut inside a textarea with plain text output", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><textarea id="editor">/contrato</textarea></body></html>'
  );
  const { window } = dom;
  const textarea = window.document.getElementById("editor");

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  window.MacroBlazeContent.setTemplateCache({
    contrato: {
      id: "tpl-1",
      shortcut: "contrato",
      content: "<strong>Contrato pronto</strong>",
    },
  });

  let prevented = false;
  const event = {
    key: " ",
    code: "Space",
    preventDefault() {
      prevented = true;
    },
  };

  const handled = window.MacroBlazeContent.handleCompletionKey(
    event,
    "/contrato",
    window.document
  );

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(textarea.value, "Contrato pronto");
  assert.equal(textarea.selectionStart, "Contrato pronto".length);
  assert.equal(textarea.selectionEnd, "Contrato pronto".length);
});

test("does not expand shortcut inside a password input", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><input id="editor" type="password" value="/contrato"></body></html>'
  );
  const { window } = dom;
  const input = window.document.getElementById("editor");

  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  window.MacroBlazeContent.setTemplateCache({
    contrato: {
      id: "tpl-1",
      shortcut: "contrato",
      content: "<strong>Contrato pronto</strong>",
    },
  });

  let prevented = false;
  const event = {
    key: " ",
    code: "Space",
    preventDefault() {
      prevented = true;
    },
  };

  const handled = window.MacroBlazeContent.handleCompletionKey(
    event,
    "/contrato",
    window.document
  );

  assert.equal(handled, false);
  assert.equal(prevented, false);
  assert.equal(input.value, "/contrato");
});

test("falls back to DOM insertion and still deletes shortcut when rich paste is not handled", async () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/caso01</div></body></html>'
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }
    setData(type, value) {
      this.data[type] = value;
    }
    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  // Intentionally do NOT call preventDefault() on the paste event,
  // so dispatchRichPaste returns false and falls back to insertHtmlWithRange.
  editor.addEventListener("paste", () => {
    // no-op: page does not handle paste
  });

  placeCaretAtEnd(window, editor);

  const expanded = await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/caso01",
    "<strong>Caso formatado</strong>",
    "Caso formatado"
  );

  assert.equal(expanded, true);
  assert.equal(editor.textContent, "Caso formatado");
  assert.doesNotMatch(editor.textContent, /\/caso01/);
});

test("reloads templates when the page regains focus", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  let dbLoads = 0;

  window.chrome = {
    storage: {
      sync: {
        get: async () => ({}),
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      sendMessage() {},
      onMessage: {
        addListener() {},
      },
    },
  };

  window.MinutarioDB = {
    async open() {},
    async getAllTemplates() {
      dbLoads += 1;
      return [];
    },
  };

  window.eval(scriptSource);
  await new Promise((resolve) => window.setTimeout(resolve, 80));

  assert.equal(dbLoads, 1);

  window.dispatchEvent(new window.Event("focus"));
  await new Promise((resolve) => window.setTimeout(resolve, 80));

  assert.equal(dbLoads, 2);
});

test("loads templates from the background message channel", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
    }
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");

  window.chrome = {
    storage: {
      sync: {
        get: async () => ({}),
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      async sendMessage(message) {
        if (message && message.type === "GET_TEMPLATES") {
          return {
            ok: true,
            data: [
              {
                id: "tpl-1",
                shortcut: "contrato",
                content: "<strong>Contrato pronto</strong>",
              },
            ],
          };
        }
        return { ok: true };
      },
      onMessage: {
        addListener() {},
      },
    },
  };

  window.eval(scriptSource);
  await new Promise((resolve) => window.setTimeout(resolve, 80));

  placeCaretAtEnd(window, editor);

  let prevented = false;
  const event = {
    key: " ",
    code: "Space",
    preventDefault() {
      prevented = true;
    },
  };

  const handled = window.MacroBlazeContent.handleCompletionKey(
    event,
    "/contrato",
    window.document
  );

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.match(editor.innerHTML, /<strong>Contrato pronto<\/strong>/);
});

test("collects Word-style editor diagnostics from replaced editable roots", () => {
  const dom = bootstrapDom(
    '<!doctype html><html><body><div id="host"><div id="editor-a" contenteditable="true">texto antigo</div><div id="editor-b" contenteditable="true">/juris What is Lorem Ipsum?</div></div></body></html>'
  );
  const { window } = dom;

  assert.equal(typeof window.MacroBlazeContent.collectEditorDiagnostics, "function");

  const probe = window.MacroBlazeContent.collectEditorDiagnostics(
    window.document,
    "/juris",
    "What is Lorem Ipsum?"
  );

  assert.ok(Array.isArray(probe.documents));
  assert.ok(probe.documents.length >= 1);
  assert.ok(
    probe.documents.some(function (entry) {
      return Array.isArray(entry.editables) && entry.editables.some(function (editable) {
        return /\/juris What is Lorem Ipsum\?/.test(editable.text);
      });
    })
  );
});

test("persists Word probe data for about:blank documents when the referrer is Word Online", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
      url: "about:blank",
      referrer: "https://wordeditorframe.aspx/?WOPIsrc=test",
    }
  );
  const { window } = dom;
  const localStorageArea = {};

  window.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") {
            return { [key]: localStorageArea[key] };
          }
          return Object.assign({}, localStorageArea);
        },
        async set(items) {
          Object.assign(localStorageArea, items);
        },
      },
      sync: {
        get: async () => ({}),
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      sendMessage() {},
      onMessage: {
        addListener() {},
      },
    },
  };

  window.eval(scriptSource);

  const editor = window.document.getElementById("editor");
  placeCaretAtEnd(window, editor);

  await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>What is Lorem Ipsum?</strong>",
    "What is Lorem Ipsum?"
  );

  await new Promise((resolve) => window.setTimeout(resolve, 10));

  assert.ok(localStorageArea.minutario_last_word_probe);
  assert.match(localStorageArea.minutario_last_word_probe.url, /about:blank/);
  assert.match(localStorageArea.minutario_last_word_probe.referrer, /wordeditorframe\.aspx/i);
});

test("persists Word probe trail with edit command insert evidence", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
      url: "about:blank",
      referrer: "https://wordeditorframe.aspx/?WOPIsrc=test",
    }
  );
  const { window } = dom;
  const localStorageArea = {};

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  window.document.execCommand = (command, showUI, value) => {
    if (command !== "insertHTML") {
      return false;
    }

    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const template = window.document.createElement("template");
    template.innerHTML = value || "";
    range.deleteContents();
    range.insertNode(template.content.cloneNode(true));
    placeCaretAtEnd(window, window.document.getElementById("editor"));
    return true;
  };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  window.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") {
            return { [key]: localStorageArea[key] };
          }
          return Object.assign({}, localStorageArea);
        },
        async set(items) {
          Object.assign(localStorageArea, items);
        },
      },
      sync: {
        get: async () => ({}),
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      sendMessage() {},
      onMessage: {
        addListener() {},
      },
    },
  };

  window.eval(scriptSource);

  const editor = window.document.getElementById("editor");
  placeCaretAtEnd(window, editor);

  await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>What is Lorem Ipsum?</strong>",
    "What is Lorem Ipsum?"
  );

  await new Promise((resolve) => window.setTimeout(resolve, 10));

  const probe = localStorageArea.minutario_last_word_probe;
  assert.ok(Array.isArray(probe.trail));

  const insertEntry = probe.trail.find((entry) => entry.phase === "word-edit-command-insert-result");
  assert.ok(insertEntry);
  assert.equal(insertEntry.details.handled, true);
  assert.equal(insertEntry.details.rootContainsExpected, false);
  assert.doesNotMatch(insertEntry.details.rootText, /\/juris/);
});

test("persists Word edit command result after residual shortcut cleanup", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/juris</div></body></html>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
      url: "about:blank",
      referrer: "https://wordeditorframe.aspx/?WOPIsrc=test",
    }
  );
  const { window } = dom;
  const localStorageArea = {};

  class FakeDataTransfer {
    constructor() {
      this.data = {};
    }

    setData(type, value) {
      this.data[type] = value;
    }

    getData(type) {
      return this.data[type] || "";
    }
  }

  class FakeClipboardEvent extends window.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }

  class FakeClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  window.DataTransfer = FakeDataTransfer;
  window.ClipboardEvent = FakeClipboardEvent;
  window.ClipboardItem = FakeClipboardItem;
  window.document.execCommand = (command, showUI, value) => {
    if (command !== "insertText") {
      return false;
    }

    // Simulate a real execCommand that replaces the selected text.
    // Uses deleteContents + insertNode so Range references stay valid
    // and pass the post-condition check in insertHtmlWithEditingCommand.
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(window.document.createTextNode(value || ""));
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return true;
  };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      write: async () => {},
    },
  });

  window.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") {
            return { [key]: localStorageArea[key] };
          }
          return Object.assign({}, localStorageArea);
        },
        async set(items) {
          Object.assign(localStorageArea, items);
        },
      },
      sync: {
        get: async () => ({}),
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      sendMessage() {},
      onMessage: {
        addListener() {},
      },
    },
  };

  window.eval(scriptSource);

  const editor = window.document.getElementById("editor");
  placeCaretAtEnd(window, editor);

  await window.MacroBlazeContent.expandTemplateAtSelectionRich(
    window.document,
    "/juris",
    "<strong>este é um exemplo de minuta</strong>",
    "este é um exemplo de minuta"
  );

  await new Promise((resolve) => window.setTimeout(resolve, 10));

  const probe = localStorageArea.minutario_last_word_probe;
  const insertEntry = probe.trail.find((entry) => entry.phase === "word-edit-command-insert-result");
  assert.ok(insertEntry);
  assert.equal(insertEntry.details.handled, true);
  // With a real execCommand that replaces the selected text, there is no
  // residual shortcut left before cleanup.
  assert.equal(insertEntry.details.rootContainsExpectedBeforeCleanup, false);
  assert.doesNotMatch(insertEntry.details.rootTextBeforeCleanup, /\/juris/);
  assert.equal(insertEntry.details.rootContainsExpected, false);
  assert.doesNotMatch(insertEntry.details.rootText, /\/juris/);
});

test("persists Word keydown diagnostics before template expansion is attempted", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="editor" contenteditable="true"></div></body></html>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
      url: "about:blank",
      referrer: "https://wordeditorframe.aspx/?WOPIsrc=test",
    }
  );
  const { window } = dom;
  const localStorageArea = {};

  window.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") {
            return { [key]: localStorageArea[key] };
          }
          return Object.assign({}, localStorageArea);
        },
        async set(items) {
          Object.assign(localStorageArea, items);
        },
      },
      sync: {
        get: async () => ({}),
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      sendMessage() {},
      onMessage: {
        addListener() {},
      },
    },
  };

  window.eval(scriptSource);

  const editor = window.document.getElementById("editor");
  editor.focus();
  placeCaretAtEnd(window, editor);

  window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    })
  );

  await new Promise((resolve) => window.setTimeout(resolve, 10));

  assert.ok(localStorageArea.minutario_last_word_probe);
  assert.equal(localStorageArea.minutario_last_word_probe.phase, "keydown-trigger-char");
});

test("ignores benign extension context invalidation when loading templates and falls back to IndexedDB", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="editor" contenteditable="true">/contrato</div></body></html>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
    }
  );
  const { window } = dom;
  const editor = window.document.getElementById("editor");
  const warnings = [];

  window.console.warn = function () {
    warnings.push(Array.from(arguments));
  };

  window.chrome = {
    storage: {
      sync: {
        get: async () => ({}),
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      async sendMessage() {
        throw new Error("Extension context invalidated.");
      },
      onMessage: {
        addListener() {},
      },
    },
  };

  window.MinutarioDB = {
    async open() {},
    async getAllTemplates() {
      return [
        {
          id: "tpl-1",
          shortcut: "contrato",
          content: "<strong>Contrato pronto</strong>",
        },
      ];
    },
  };

  window.eval(scriptSource);
  await new Promise((resolve) => window.setTimeout(resolve, 80));

  placeCaretAtEnd(window, editor);

  let prevented = false;
  const event = {
    key: " ",
    code: "Space",
    preventDefault() {
      prevented = true;
    },
  };

  const handled = window.MacroBlazeContent.handleCompletionKey(
    event,
    "/contrato",
    window.document
  );

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.match(editor.innerHTML, /<strong>Contrato pronto<\/strong>/);
  assert.equal(warnings.length, 0);
});
