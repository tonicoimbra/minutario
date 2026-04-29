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
      var result = await chrome.storage.sync.get(null);
      templateCache = buildTemplateCache(result);
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

    return tagName === "INPUT" && /^(text|search|url|tel|email|password)$/i.test(node.type || "");
  }

  function isContentEditableElement(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }

    return node.isContentEditable || node.getAttribute("contenteditable") === "true";
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

    while (current && current.nodeType) {
      if (isContentEditableElement(current)) {
        return current;
      }

      current = current.parentNode;
    }

    return null;
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

    if (!startPosition) {
      return null;
    }

    var shortcutRange = doc.createRange();
    shortcutRange.setStart(startPosition.node, startPosition.offset);
    shortcutRange.setEnd(currentRange.endContainer, currentRange.endOffset);

    if (shortcutRange.toString() !== expectedText) {
      return null;
    }

    return shortcutRange;
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

    var nodeCtor =
      doc.defaultView && doc.defaultView.Node
        ? doc.defaultView.Node
        : typeof Node !== "undefined"
          ? Node
          : null;
    var lastPosition = null;
    var fallbackNode = null;

    for (var i = 0; i < nodes.length; i += 1) {
      var currentNode = nodes[i];
      if (!currentNode) {
        continue;
      }

      if (!fallbackNode) {
        fallbackNode = currentNode;
      } else if (
        fallbackNode.compareDocumentPosition &&
        nodeCtor &&
        fallbackNode.compareDocumentPosition(currentNode) &
          nodeCtor.DOCUMENT_POSITION_FOLLOWING
      ) {
        fallbackNode = currentNode;
      }

      var position = getLastCaretPosition(currentNode);
      if (!position || !position.node) {
        continue;
      }

      if (!lastPosition) {
        lastPosition = position;
        continue;
      }

      if (
        lastPosition.node.compareDocumentPosition &&
        nodeCtor &&
        lastPosition.node.compareDocumentPosition(position.node) &
          nodeCtor.DOCUMENT_POSITION_FOLLOWING
      ) {
        lastPosition = position;
      }
    }

    if (lastPosition && lastPosition.node) {
      var range = doc.createRange();
      range.setStart(lastPosition.node, lastPosition.offset);
      range.collapse(true);
      selectRange(doc, range);
      return;
    }

    if (fallbackNode) {
      placeCaretAfterNode(doc, fallbackNode);
    }
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

  function insertHtmlWithRange(doc, range, html, plainText) {
    if (!doc || !range) {
      return false;
    }

    var commandHtml = html || (plainText ? escapeHtml(plainText) : "");
    if (commandHtml && typeof doc.execCommand === "function") {
      selectRange(doc, range);

      try {
        if (doc.execCommand("delete", false, null)) {
          try {
            if (doc.execCommand("insertHTML", false, commandHtml)) {
              return true;
            }
          } catch (insertError) {
            // Fall back to direct DOM insertion below.
          }

          var selection = getSelection(doc);
          if (selection && selection.rangeCount > 0) {
            range = selection.getRangeAt(0);
          }
        }
      } catch (error) {
        // Fall back to direct DOM insertion when the browser edit command is unavailable.
      }
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

    var shortcutRange = createShortcutRange(doc, expectedText);
    if (!shortcutRange) {
      return false;
    }

    return insertHtmlWithRange(doc, shortcutRange, normalizedHtml, replacementText);
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
    var expanded = expandTemplateAtSelection(
      doc || global.document,
      activeBuffer,
      template.content,
      plainText
    );

    if (!expanded) {
      return false;
    }

    event.preventDefault();

    if (chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
      chrome.runtime.sendMessage({
        type: "UPDATE_RECENT",
        payload: { templateId: template.id },
      });
    }

    return true;
  }

  var api = {
    expandTemplateAtSelection: expandTemplateAtSelection,
    createShortcutRange: createShortcutRange,
    insertHtmlWithRange: insertHtmlWithRange,
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
      handleCompletionKey(event, activeBuffer, global.document);
      return;
    }

    buffer = "";
  }, true);

  loadSettings();
  loadTemplates();
})(typeof globalThis !== "undefined" ? globalThis : this);
