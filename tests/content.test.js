const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scriptPath = path.join(__dirname, "..", "content.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

function bootstrapDom(html) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  const { window } = dom;

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
    },
  };

  window.eval(scriptSource);
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
