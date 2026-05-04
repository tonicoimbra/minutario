(function (global) {
  var triggerChar = "/";
  var triggerKey = "Space";
  var buffer = "";
  var templateCache = {};

  function applySettings(settings) {
    if (settings && typeof settings === "object") {
      triggerChar =
        typeof settings.triggerChar === "string" && settings.triggerChar.length > 0
          ? settings.triggerChar.charAt(0)
          : "/";
      triggerKey =
        typeof settings.triggerKey === "string" && settings.triggerKey.length > 0
          ? settings.triggerKey
          : "Space";
      return;
    }

    triggerChar = "/";
    triggerKey = "Space";
  }

  async function loadSettings() {
    try {
      var result = await chrome.storage.sync.get("settings");
      applySettings(result && result.settings);
    } catch (error) {
      console.error("Minutário failed to load settings:", error);
      applySettings(null);
    }
  }

  function buildTemplateCache(items) {
    var nextCache = {};
    var entries = Object.entries(items || {});

    for (var i = 0; i < entries.length; i += 1) {
      var key = entries[i][0];
      var value = entries[i][1];

      if (!key.startsWith("tpl_") || !value || typeof value !== "object") {
        continue;
      }

      var shortcut =
        typeof value.shortcut === "string" ? value.shortcut.toLowerCase() : "";

      if (!shortcut) {
        continue;
      }

      nextCache[shortcut] = value;
    }

    return nextCache;
  }

  async function loadTemplates() {
    try {
      if (global.MinutarioDB) {
        await global.MinutarioDB.open();
        var templates = await global.MinutarioDB.getAllTemplates();
        templateCache = {};
        templates.forEach(function (t) {
          if (t.shortcut) {
            templateCache[t.shortcut.toLowerCase()] = t;
          }
        });
      } else {
        // Fallback: chrome.storage.sync
        var result = await chrome.storage.sync.get(null);
        templateCache = buildTemplateCache(result);
      }
    } catch (error) {
      console.error("Minutário failed to load templates:", error);
      templateCache = {};
    }
  }

  function isShortcutChar(key) {
    return /^[a-zA-Z0-9-]$/.test(key);
  }

  function isCompletionKey(event) {
    if (triggerKey === "Space") {
      return event.key === " " || event.code === "Space";
    }

    return event.code === triggerKey || event.key === triggerKey;
  }

  function stripHtml(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html || "", "text/html");
    return doc.body ? doc.body.textContent || "" : "";
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function findTemplateByShortcut(items, shortcut) {
    var cache = buildTemplateCache(items);
    return cache[shortcut] || null;
  }

  function isTextControl(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }

    var tagName = node.tagName;
    if (tagName === "TEXTAREA") {
      return true;
    }

    return tagName === "INPUT" && /^(text|search|url|tel|email)$/i.test(node.type || "");
  }

  function isContentEditableElement(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }

    return node.isContentEditable || node.getAttribute("contenteditable") === "true";
  }

  function getActiveDocument() {
    var activeElement = global.document && global.document.activeElement;
    if (activeElement && activeElement.tagName === "IFRAME") {
      try {
        var iframeDoc =
          activeElement.contentDocument ||
          (activeElement.contentWindow && activeElement.contentWindow.document);
        if (iframeDoc) {
          return iframeDoc;
        }
      } catch (e) {
        // cross-origin iframe — ignore
      }
    }
    return global.document;
  }

  function getActiveWindow(doc) {
    return doc && doc.defaultView ? doc.defaultView : global;
  }

  function getSelection(doc) {
    if (!doc) {
      return null;
    }

    if (typeof doc.getSelection === "function") {
      return doc.getSelection();
    }

    if (typeof global.getSelection === "function") {
      return global.getSelection();
    }

    return null;
  }

  function findEditableRoot(node) {
    var current = node;

    if (current && current.nodeType === 3) {
      current = current.parentNode;
    }

    var lastEditable = null;

    while (current && current.nodeType) {
      if (isContentEditableElement(current)) {
        lastEditable = current;
      }

      current = current.parentNode;
    }

    return lastEditable;
  }

  function createTextWalker(doc, root) {
    var nodeFilter = doc.defaultView && doc.defaultView.NodeFilter;
    return doc.createTreeWalker(root, nodeFilter ? nodeFilter.SHOW_TEXT : 4);
  }

  function resolveTextPosition(doc, root, textOffset) {
    var walker = createTextWalker(doc, root);
    var current = walker.nextNode();
    var remaining = textOffset;
    var lastTextNode = null;

    while (current) {
      var length = current.nodeValue ? current.nodeValue.length : 0;
      lastTextNode = current;

      if (remaining <= length) {
        return { node: current, offset: remaining };
      }

      remaining -= length;
      current = walker.nextNode();
    }

    if (lastTextNode) {
      return {
        node: lastTextNode,
        offset: lastTextNode.nodeValue ? lastTextNode.nodeValue.length : 0,
      };
    }

    return {
      node: root,
      offset: root.childNodes ? root.childNodes.length : 0,
    };
  }

  function selectRange(doc, range) {
    var selection = getSelection(doc);

    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }

  function walkBackwardsToStart(endContainer, endOffset, length) {
    if (!endContainer || length < 0) {
      return null;
    }

    var doc = endContainer.ownerDocument;
    var root = findEditableRoot(endContainer);
    var nodeFilter = doc.defaultView && doc.defaultView.NodeFilter;
    var walker = root
      ? doc.createTreeWalker(root, nodeFilter ? nodeFilter.SHOW_TEXT : 4)
      : null;

    if (!root || !walker) {
      return null;
    }

    function getLastTextNode(node) {
      if (!node) {
        return null;
      }

      if (node.nodeType === 3) {
        return node;
      }

      var childWalker = doc.createTreeWalker(node, nodeFilter ? nodeFilter.SHOW_TEXT : 4);
      var lastText = null;
      var child = childWalker.nextNode();

      while (child) {
        lastText = child;
        child = childWalker.nextNode();
      }

      return lastText;
    }

    var currentNode;
    var currentOffset;

    if (endContainer.nodeType === 3) {
      currentNode = endContainer;
      currentOffset = Math.max(
        0,
        Math.min(endOffset, endContainer.nodeValue ? endContainer.nodeValue.length : 0)
      );
    } else {
      // Cursor is inside an element node — find the last text node at endOffset position.
      for (var i = endOffset - 1; i >= 0; i -= 1) {
        currentNode = getLastTextNode(endContainer.childNodes[i]);
        if (currentNode) {
          currentOffset = currentNode.nodeValue ? currentNode.nodeValue.length : 0;
          break;
        }
      }

      if (!currentNode) {
        walker.currentNode = endContainer;
        currentNode = walker.previousNode();
        if (!currentNode) {
          return null;
        }
        currentOffset = currentNode.nodeValue ? currentNode.nodeValue.length : 0;
      }
    }

    var remaining = length;

    while (currentNode) {
      if (remaining <= currentOffset) {
        return {
          node: currentNode,
          offset: currentOffset - remaining,
        };
      }

      remaining -= currentOffset;
      walker.currentNode = currentNode;
      currentNode = walker.previousNode();
      currentOffset = currentNode && currentNode.nodeValue ? currentNode.nodeValue.length : 0;
    }

    return null;
  }

  function findRangeByTextSearch(doc, root, expectedText) {
    if (!doc || !root || !expectedText) {
      return null;
    }

    var rootText = root.textContent || "";
    if (!rootText.endsWith(expectedText)) {
      return null;
    }

    var targetStart = rootText.length - expectedText.length;
    var targetEnd = rootText.length;
    var charIndex = 0;
    var startNode = null;
    var startOffset = 0;
    var endNode = null;
    var endOffset = 0;

    var nodeFilter = doc.defaultView && doc.defaultView.NodeFilter;
    var walker = doc.createTreeWalker(root, nodeFilter ? nodeFilter.SHOW_TEXT : 4);
    var current = walker.nextNode();

    while (current) {
      var length = current.nodeValue ? current.nodeValue.length : 0;

      if (!startNode && charIndex + length > targetStart) {
        startNode = current;
        startOffset = targetStart - charIndex;
      }

      if (charIndex + length >= targetEnd) {
        endNode = current;
        endOffset = targetEnd - charIndex;
        break;
      }

      charIndex += length;
      current = walker.nextNode();
    }

    if (!startNode || !endNode) {
      return null;
    }

    try {
      var range = doc.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch (e) {
      return null;
    }
  }

  function createShortcutRange(doc, expectedText) {
    var selection = getSelection(doc);

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    var currentRange = selection.getRangeAt(0);

    if (!currentRange.collapsed) {
      return null;
    }

    var startPosition = walkBackwardsToStart(
      currentRange.endContainer,
      currentRange.endOffset,
      expectedText.length
    );

    if (startPosition) {
      var shortcutRange = doc.createRange();
      shortcutRange.setStart(startPosition.node, startPosition.offset);
      shortcutRange.setEnd(currentRange.endContainer, currentRange.endOffset);

      if (shortcutRange.toString() === expectedText) {
        return shortcutRange;
      }
    }

    // Fallback for fragmented DOMs (e.g., Word Online) where walkBackwardsToStart
    // may fail because the cursor is inside an element node with no preceding text.
    var root = findEditableRoot(currentRange.endContainer);
    if (root) {
      var fallbackRange = findRangeByTextSearch(doc, root, expectedText);
      if (fallbackRange) {
        return fallbackRange;
      }
    }

    return null;
  }

  function placeCaretAfterNode(doc, node) {
    if (!node || !node.parentNode) {
      return;
    }

    var range = doc.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selectRange(doc, range);
  }

  function getLastCaretPosition(node) {
    if (!node) {
      return null;
    }

    var doc = node.ownerDocument || (node.nodeType === 9 ? node : null);
    if (!doc || typeof doc.createTreeWalker !== "function") {
      return null;
    }

    var nodeFilter =
      doc.defaultView && doc.defaultView.NodeFilter
        ? doc.defaultView.NodeFilter
        : typeof NodeFilter !== "undefined"
          ? NodeFilter
          : null;
    var walker = doc.createTreeWalker(
      node,
      nodeFilter ? nodeFilter.SHOW_TEXT : 4,
      null
    );
    var lastTextNode = node.nodeType === 3 ? node : null;
    var current = walker.nextNode();

    while (current) {
      lastTextNode = current;
      current = walker.nextNode();
    }

    if (lastTextNode) {
      return {
        node: lastTextNode,
        offset: lastTextNode.nodeValue ? lastTextNode.nodeValue.length : 0,
      };
    }

    return {
      node: node,
      offset: node.childNodes ? node.childNodes.length : 0,
    };
  }

  function placeCaretAtEndOfInsertedNodes(doc, nodes) {
    if (!doc || !nodes || nodes.length === 0) {
      return;
    }

    // Find the last node that is still attached to the DOM.
    // Nodes are inserted in array order, so the last attached node
    // in the array is the rightmost node in the document.
    var lastNode = null;
    for (var i = nodes.length - 1; i >= 0; i -= 1) {
      var candidate = nodes[i];
      if (candidate && candidate.parentNode) {
        lastNode = candidate;
        break;
      }
    }

    if (!lastNode) {
      return;
    }

    // Try to place caret at the deepest text position inside lastNode.
    var position = getLastCaretPosition(lastNode);
    if (position && position.node) {
      var range = doc.createRange();
      range.setStart(position.node, position.offset);
      range.collapse(true);
      selectRange(doc, range);
      return;
    }

    // Fallback: place caret immediately after the last inserted node.
    placeCaretAfterNode(doc, lastNode);
  }

  function normalizeInlineChildren(node) {
    var html = "";
    var children = node.childNodes || [];

    for (var i = 0; i < children.length; i += 1) {
      html += normalizeNode(children[i], false);
    }

    return html;
  }

  function buildParagraphFromInline(node) {
    var content = normalizeInlineChildren(node);
    return content ? "<p>" + content + "</p>" : "";
  }

  function normalizeList(node, tagName) {
    var html = "";
    var items = node.childNodes || [];

    for (var i = 0; i < items.length; i += 1) {
      var child = items[i];
      if (!child || child.nodeType !== 1) {
        continue;
      }

      if (child.tagName && child.tagName.toLowerCase() === "li") {
        var itemContent = normalizeInlineChildren(child);
        html += "<li>" + itemContent + "</li>";
      }
    }

    return html ? "<" + tagName + ">" + html + "</" + tagName + ">" : "";
  }

  function normalizeNode(node, isTopLevel) {
    if (!node) {
      return "";
    }

    if (node.nodeType === 3) {
      return escapeHtml(node.nodeValue || "");
    }

    if (node.nodeType !== 1) {
      return "";
    }

    var tagName = node.tagName.toLowerCase();

    if (tagName === "br") {
      return "<br>";
    }

    if (tagName === "strong" || tagName === "b") {
      return "<strong>" + normalizeInlineChildren(node) + "</strong>";
    }

    if (tagName === "em" || tagName === "i") {
      return "<em>" + normalizeInlineChildren(node) + "</em>";
    }

    if (tagName === "u") {
      return "<u>" + normalizeInlineChildren(node) + "</u>";
    }

    if (tagName === "a") {
      var href = node.getAttribute("href") || "";
      return href
        ? '<a href="' + escapeHtml(href) + '">' + normalizeInlineChildren(node) + "</a>"
        : normalizeInlineChildren(node);
    }

    if (tagName === "ul" || tagName === "ol") {
      return normalizeList(node, tagName);
    }

    if (tagName === "li") {
      return "<li>" + normalizeInlineChildren(node) + "</li>";
    }

    if (tagName === "p" || tagName === "div") {
      if (isTopLevel) {
        return buildParagraphFromInline(node);
      }

      return normalizeInlineChildren(node);
    }

    return normalizeInlineChildren(node);
  }

  function normalizeTemplateHtml(doc, html) {
    var template = doc.createElement("template");
    template.innerHTML = html || "";

    var output = "";
    var children = template.content.childNodes;

    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      var normalized = normalizeNode(child, true);
      if (normalized) {
        output += normalized;
      }
    }

    return output;
  }

  function createFragmentFromHtml(doc, html) {
    var template = doc.createElement("template");
    template.innerHTML = html;
    return template.content;
  }

  function getDocumentView(doc) {
    return doc && doc.defaultView ? doc.defaultView : global;
  }

  function createPasteData(doc, html, plainText) {
    var view = getDocumentView(doc);
    var DataTransferCtor = view.DataTransfer || global.DataTransfer;

    if (typeof DataTransferCtor !== "function") {
      return null;
    }

    try {
      var data = new DataTransferCtor();
      data.setData("text/html", html || "");
      data.setData("text/plain", plainText || stripHtml(html));
      return data;
    } catch (error) {
      return null;
    }
  }

  function createPasteEvent(doc, pasteData) {
    var view = getDocumentView(doc);
    var ClipboardEventCtor = view.ClipboardEvent || global.ClipboardEvent;
    var EventCtor = view.Event || global.Event;
    var event = null;

    if (typeof ClipboardEventCtor === "function") {
      try {
        event = new ClipboardEventCtor("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: pasteData,
        });
      } catch (error) {
        event = null;
      }
    }

    if (!event && typeof EventCtor === "function") {
      event = new EventCtor("paste", { bubbles: true, cancelable: true });
    }

    if (!event) {
      return null;
    }

    try {
      if (!event.clipboardData) {
        Object.defineProperty(event, "clipboardData", {
          configurable: true,
          value: pasteData,
        });
      }
    } catch (error) {
      return null;
    }

    return event;
  }

  async function writeRichClipboard(doc, html, plainText) {
    var view = getDocumentView(doc);
    var navigatorRef = view.navigator || global.navigator;
    var ClipboardItemCtor = view.ClipboardItem || global.ClipboardItem;
    var BlobCtor = view.Blob || global.Blob;

    if (
      !navigatorRef ||
      !navigatorRef.clipboard ||
      typeof navigatorRef.clipboard.write !== "function" ||
      typeof ClipboardItemCtor !== "function" ||
      typeof BlobCtor !== "function"
    ) {
      return false;
    }

    try {
      await navigatorRef.clipboard.write([
        new ClipboardItemCtor({
          "text/html": new BlobCtor([html || ""], { type: "text/html" }),
          "text/plain": new BlobCtor([plainText || stripHtml(html)], {
            type: "text/plain",
          }),
        }),
      ]);
      return true;
    } catch (error) {
      return false;
    }
  }

  function findPasteTarget(doc, range) {
    if (range) {
      var root = findEditableRoot(range.startContainer);
      if (root) {
        return root;
      }
    }

    return doc.activeElement || doc.body || doc.documentElement;
  }

  function dispatchRichPaste(doc, range, html, plainText) {
    var pasteData = createPasteData(doc, html, plainText);
    var target = findPasteTarget(doc, range);

    if (!pasteData || !target || typeof target.dispatchEvent !== "function") {
      return false;
    }

    var event = createPasteEvent(doc, pasteData);
    if (!event) {
      return false;
    }

    var notCanceled = target.dispatchEvent(event);
    return notCanceled === false || event.defaultPrevented === true;
  }

  function canUseRichPaste(doc, html) {
    var view = getDocumentView(doc);
    return Boolean(
      html &&
        typeof (view.DataTransfer || global.DataTransfer) === "function" &&
        (typeof (view.ClipboardEvent || global.ClipboardEvent) === "function" ||
          typeof (view.Event || global.Event) === "function")
    );
  }

  function getSelectedRange(doc) {
    var selection = getSelection(doc);

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    return selection.getRangeAt(0);
  }

  function deleteRangeForInsertion(doc, range) {
    if (!doc || !range) {
      return null;
    }

    try {
      range.deleteContents();
      range.collapse(true);
      selectRange(doc, range);
      return range;
    } catch (error) {
      return null;
    }
  }

  async function pasteHtmlWithRange(doc, range, html, plainText) {
    if (!doc || !range || !html) {
      return false;
    }

    var insertionRange = deleteRangeForInsertion(doc, range);
    if (!insertionRange) {
      return false;
    }

    var clipboardWritten = await writeRichClipboard(doc, html, plainText);
    selectRange(doc, insertionRange);

    return dispatchRichPaste(doc, insertionRange, html, plainText);
  }

  function insertHtmlWithRange(doc, range, html, plainText) {
    if (!doc || !range) {
      return false;
    }

    range.deleteContents();

    if (html) {
      var container = doc.createElement("div");
      var fragment = doc.createDocumentFragment();
      var insertedNodes = [];

      container.innerHTML = html;

      while (container.firstChild) {
        insertedNodes.push(container.firstChild);
        fragment.appendChild(container.firstChild);
      }

      if (insertedNodes.length > 0) {
        range.insertNode(fragment);
        placeCaretAtEndOfInsertedNodes(doc, insertedNodes);
        return true;
      }
    }

    if (plainText) {
      var textNode = doc.createTextNode(plainText);
      range.insertNode(textNode);
      placeCaretAfterNode(doc, textNode);
      return true;
    }

    return false;
  }

  function replaceShortcutInTextControl(element, expectedText, replacementText) {
    if (!isTextControl(element)) {
      return false;
    }

    var start = element.selectionStart;
    var end = element.selectionEnd;

    if (typeof start !== "number" || typeof end !== "number" || start !== end) {
      return false;
    }

    if (start < expectedText.length) {
      return false;
    }

    if (element.value.slice(start - expectedText.length, start) !== expectedText) {
      return false;
    }

    element.setRangeText(replacementText, start - expectedText.length, start, "end");
    return true;
  }

  function expandTemplateAtSelection(doc, expectedText, html, plainText) {
    if (!doc || !expectedText) {
      return false;
    }

    var activeElement = doc.activeElement;
    var normalizedHtml = normalizeTemplateHtml(doc, html);
    var replacementText =
      typeof plainText === "string" && plainText.length > 0
        ? plainText
        : stripHtml(normalizedHtml);

    if (replaceShortcutInTextControl(activeElement, expectedText, replacementText)) {
      return true;
    }

    if (activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")) {
      return false;
    }

    var shortcutRange = createShortcutRange(doc, expectedText);
    if (!shortcutRange) {
      return false;
    }

    return insertHtmlWithRange(doc, shortcutRange.cloneRange(), normalizedHtml, replacementText);
  }

  async function expandTemplateAtSelectionRich(doc, expectedText, html, plainText) {
    if (!doc || !expectedText) {
      return false;
    }

    var activeElement = doc.activeElement;
    var normalizedHtml = normalizeTemplateHtml(doc, html);
    var replacementText =
      typeof plainText === "string" && plainText.length > 0
        ? plainText
        : stripHtml(normalizedHtml);

    if (replaceShortcutInTextControl(activeElement, expectedText, replacementText)) {
      return true;
    }

    if (activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")) {
      return false;
    }

    var shortcutRange = createShortcutRange(doc, expectedText);
    if (!shortcutRange) {
      return false;
    }

    if (await pasteHtmlWithRange(doc, shortcutRange.cloneRange(), normalizedHtml, replacementText)) {
      return true;
    }

    return insertHtmlWithRange(doc, shortcutRange.cloneRange(), normalizedHtml, replacementText);
  }

  function notifyTemplateUsed(template) {
    if (chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
      chrome.runtime.sendMessage({
        type: "UPDATE_RECENT",
        payload: { templateId: template.id },
      });
    }
  }

  function handleCompletionKey(event, activeBuffer, doc) {
    var shortcut = activeBuffer.slice(1).toLowerCase();

    if (!shortcut) {
      return false;
    }

    var template = templateCache[shortcut];

    if (!template || typeof template.content !== "string") {
      return false;
    }

    var plainText = stripHtml(template.content);
    var targetDoc = doc || global.document;
    var activeElement = targetDoc.activeElement;

    if (
      activeElement &&
      (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA") &&
      !isTextControl(activeElement)
    ) {
      return false;
    }

    if (
      canUseRichPaste(targetDoc, template.content) &&
      !isTextControl(activeElement)
    ) {
      if (!createShortcutRange(targetDoc, activeBuffer)) {
        return false;
      }

      event.preventDefault();
      expandTemplateAtSelectionRich(
        targetDoc,
        activeBuffer,
        template.content,
        plainText
      ).then(function (expanded) {
        if (expanded) {
          notifyTemplateUsed(template);
        }
      }).catch(function (error) {
        console.error("Minutário failed to expand rich template:", error);
      });

      return true;
    }

    var expanded = expandTemplateAtSelection(
      targetDoc,
      activeBuffer,
      template.content,
      plainText
    );

    if (!expanded) {
      return false;
    }

    event.preventDefault();
    notifyTemplateUsed(template);

    return true;
  }

  var api = {
    expandTemplateAtSelection: expandTemplateAtSelection,
    expandTemplateAtSelectionRich: expandTemplateAtSelectionRich,
    createShortcutRange: createShortcutRange,
    insertHtmlWithRange: insertHtmlWithRange,
    pasteHtmlWithRange: pasteHtmlWithRange,
    findEditableRoot: findEditableRoot,
    normalizeTemplateHtml: normalizeTemplateHtml,
    handleCompletionKey: handleCompletionKey,
    setTemplateCache: function (nextCache) {
      templateCache = nextCache || {};
    },
  };

  global.MacroBlazeContent = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (!global.document) {
    return;
  }

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "sync") {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(changes, "settings")) {
      applySettings(changes.settings && changes.settings.newValue);
    }

    var templateChanged = Object.keys(changes).some(function (key) {
      return key.indexOf("tpl_") === 0;
    });

    if (templateChanged) {
      loadTemplates();
    }
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (message && message.type === "TEMPLATES_UPDATED") {
      loadTemplates();
    }
  });

  global.document.addEventListener("keydown", function (event) {
    if (event.key === triggerChar) {
      buffer = triggerChar;
      return;
    }

    if (!buffer) {
      return;
    }

    if (isShortcutChar(event.key)) {
      buffer += event.key;
      return;
    }

    if (isCompletionKey(event)) {
      var activeBuffer = buffer;
      buffer = "";
      handleCompletionKey(event, activeBuffer, getActiveDocument());
      return;
    }

    buffer = "";
  }, true);

  loadSettings();
  loadTemplates();
})(typeof globalThis !== "undefined" ? globalThis : this);
