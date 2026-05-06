(function (global) {
  var triggerChar = "/";
  var triggerKey = "Space";
  var buffer = "";
  var templateCache = {};
  var reloadTimer = null;
  var debugEnabled = !!(global.MinutarioConfig && global.MinutarioConfig.DEBUG_LOGS);
  var WORD_PROBE_STORAGE_KEY = "minutario_last_word_probe";

  function debugLog(message, details) {
    if (!debugEnabled || !global.console || typeof global.console.debug !== "function") {
      return;
    }

    if (typeof details === "undefined") {
      global.console.debug("[Minutário]", message);
      return;
    }

    global.console.debug("[Minutário]", message, details);
  }

  function getErrorMessage(error) {
    if (!error) {
      return "";
    }

    if (typeof error === "string") {
      return error;
    }

    if (typeof error.message === "string") {
      return error.message;
    }

    try {
      return String(error);
    } catch (stringifyError) {
      return "";
    }
  }

  function isBenignExtensionContextError(error) {
    return getErrorMessage(error).toLowerCase().indexOf("context invalidated") !== -1;
  }

  function shortText(value, limit) {
    var text = String(value || "");
    var max = typeof limit === "number" ? limit : 240;
    return text.length > max ? text.slice(0, max) + "..." : text;
  }

  function getDocumentProbeContext(doc) {
    if (!doc) {
      return "";
    }

    return [doc.URL || "", doc.referrer || ""].join(" ");
  }

  function isWordOnlineDocument(doc) {
    if (!doc) {
      return false;
    }

    return /officeapps\.live\.com|wordeditorframe\.aspx|wordeditorframe/i.test(
      getDocumentProbeContext(doc)
    );
  }

  function collectNestedDocuments(doc, path, acc, seen) {
    if (!doc || !acc || !seen || seen.indexOf(doc) !== -1) {
      return;
    }

    seen.push(doc);
    acc.push({ doc: doc, path: path || "document" });

    var iframes = [];
    try {
      iframes = Array.prototype.slice.call(doc.querySelectorAll("iframe"));
    } catch (error) {
      iframes = [];
    }

    iframes.forEach(function(iframe, index) {
      try {
        if (iframe.contentDocument) {
          collectNestedDocuments(iframe.contentDocument, (path || "document") + " > iframe[" + index + "]", acc, seen);
        }
      } catch (iframeError) {
        // cross-origin or sandboxed iframe
      }
    });
  }

  function collectEditorDiagnostics(doc, expectedText, replacementText) {
    var documents = [];
    collectNestedDocuments(doc, "document", documents, []);

    return {
      expectedText: expectedText || "",
      replacementText: replacementText || "",
      documents: documents.map(function(entry) {
        var currentDoc = entry.doc;
        var selection = null;
        var active = null;
        var editables = [];

        try {
          selection = currentDoc.getSelection ? currentDoc.getSelection() : null;
        } catch (selectionError) {
          selection = null;
        }

        try {
          active = currentDoc.activeElement;
        } catch (activeError) {
          active = null;
        }

        try {
          var rootCandidates = collectEditableRoots(
            currentDoc.body || currentDoc.documentElement || currentDoc
          );

          if (active && isEditorRootElement(active) && rootCandidates.indexOf(active) === -1) {
            rootCandidates.unshift(active);
          }

          if (selection && selection.anchorNode) {
            var anchorRoot = findEditableRoot(selection.anchorNode);
            if (anchorRoot && rootCandidates.indexOf(anchorRoot) === -1) {
              rootCandidates.unshift(anchorRoot);
            }
          }

          editables = rootCandidates
            .filter(function(el) {
              var text = el.innerText || el.textContent || "";
              return (
                (!!expectedText && text.indexOf(expectedText) !== -1) ||
                (!!replacementText && text.indexOf(replacementText) !== -1) ||
                el === active
              );
            })
            .slice(0, 12)
            .map(function(el) {
              return {
                tag: el.tagName,
                id: el.id || "",
                cls: shortText(el.className || "", 120),
                connected: !!el.isConnected,
                text: shortText(el.innerText || el.textContent || "", 300),
                html: shortText(el.innerHTML || "", 300),
              };
            });
        } catch (editableError) {
          editables = [];
        }

        return {
          path: entry.path,
          url: currentDoc.URL,
          activeTag: active && active.tagName,
          activeId: active && active.id,
          activeCls: active && shortText(active.className || "", 120),
          selectionText: selection ? shortText(selection.toString(), 200) : "",
          anchorText:
            selection && selection.anchorNode
              ? shortText(selection.anchorNode.textContent || selection.anchorNode.nodeValue || "", 200)
              : "",
          focusText:
            selection && selection.focusNode
              ? shortText(selection.focusNode.textContent || selection.focusNode.nodeValue || "", 200)
              : "",
          editables: editables,
        };
      }),
    };
  }

  function logWordProbe(doc, phase, expectedText, replacementText) {
    if (!isWordOnlineDocument(doc)) {
      return;
    }

    var probe = {
      phase: phase,
      capturedAt: new Date().toISOString(),
      url: doc && doc.URL ? doc.URL : "",
      referrer: doc && doc.referrer ? doc.referrer : "",
      diagnostics: collectEditorDiagnostics(doc, expectedText, replacementText),
    };

    if (global.console && typeof global.console.info === "function") {
      global.console.info("[Minutário Probe]", phase, probe);
    }

    try {
      if (
        chrome &&
        chrome.storage &&
        chrome.storage.local &&
        typeof chrome.storage.local.set === "function"
      ) {
        var storagePayload = {};
        storagePayload[WORD_PROBE_STORAGE_KEY] = probe;
        chrome.storage.local.set(storagePayload);
      }
    } catch (storageError) {
      // Ignore probe persistence errors.
    }
  }

  function logWordDecision(doc, phase, details) {
    if (!isWordOnlineDocument(doc)) {
      return;
    }

    var probe = {
      phase: phase,
      capturedAt: new Date().toISOString(),
      url: doc && doc.URL ? doc.URL : "",
      referrer: doc && doc.referrer ? doc.referrer : "",
      details: details || {},
    };

    if (global.console && typeof global.console.info === "function") {
      global.console.info("[Minutário Probe]", phase, probe);
    }

    try {
      if (
        chrome &&
        chrome.storage &&
        chrome.storage.local &&
        typeof chrome.storage.local.set === "function"
      ) {
        var storagePayload = {};
        storagePayload[WORD_PROBE_STORAGE_KEY] = probe;
        chrome.storage.local.set(storagePayload);
      }
    } catch (storageError) {
      // Ignore probe persistence errors.
    }
  }

  function scheduleWordProbeSnapshots(doc, expectedText, replacementText) {
    if (!isWordOnlineDocument(doc) || typeof global.setTimeout !== "function") {
      return;
    }

    [0, 150, 500, 1200].forEach(function(delay) {
      global.setTimeout(function() {
        logWordProbe(doc, "snapshot-" + delay + "ms", expectedText, replacementText);
      }, delay);
    });
  }

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
      debugEnabled =
        typeof settings.debugLogs === "boolean"
          ? settings.debugLogs
          : !!(global.MinutarioConfig && global.MinutarioConfig.DEBUG_LOGS);
      return;
    }

    triggerChar = "/";
    triggerKey = "Space";
    debugEnabled = !!(global.MinutarioConfig && global.MinutarioConfig.DEBUG_LOGS);
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

  function buildTemplateCacheFromList(templates) {
    var nextCache = {};

    (templates || []).forEach(function (template) {
      if (!template || typeof template !== "object") {
        return;
      }

      var shortcut =
        typeof template.shortcut === "string" ? template.shortcut.toLowerCase() : "";

      if (!shortcut) {
        return;
      }

      nextCache[shortcut] = template;
    });

    return nextCache;
  }

  async function loadTemplates() {
    try {
      if (chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
        try {
          var response = await chrome.runtime.sendMessage({
            type: "GET_TEMPLATES",
            payload: {},
          });

          if (response && response.ok && Array.isArray(response.data)) {
            templateCache = buildTemplateCacheFromList(response.data);
            debugLog("Templates carregados via background.", {
              count: Object.keys(templateCache).length,
            });
            return;
          }
        } catch (runtimeError) {
          if (!isBenignExtensionContextError(runtimeError)) {
            console.warn("Minutário falhou ao carregar templates via background, tentando fallback...", runtimeError);
          }
        }
      }

      var loadedFromDB = false;
      if (global.MinutarioDB) {
        try {
          await global.MinutarioDB.open();
          var templates = await global.MinutarioDB.getAllTemplates();
          templateCache = buildTemplateCacheFromList(templates);
          loadedFromDB = true;
          debugLog("Templates carregados do IndexedDB local.", {
            count: Object.keys(templateCache).length,
          });
        } catch (dbError) {
          console.warn("Minutário falhou ao carregar do banco local (IndexedDB), tentando fallback...", dbError);
        }
      }

      if (!loadedFromDB) {
        // Fallback: chrome.storage.sync
        var result = await chrome.storage.sync.get(null);
        templateCache = buildTemplateCache(result);
        debugLog("Templates carregados via chrome.storage.sync.", {
          count: Object.keys(templateCache).length,
        });
      }
    } catch (error) {
      console.error("Minutário failed to load templates:", error);
      templateCache = {};
    }
  }

  function scheduleTemplateReload(reason) {
    if (reloadTimer) {
      global.clearTimeout(reloadTimer);
    }

    reloadTimer = global.setTimeout(function () {
      debugLog("Recarregando templates.", { reason: reason || "unknown" });
      loadTemplates();
      reloadTimer = null;
    }, 50);
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

  function isWordOnlineSurfaceElement(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }

    var id = node.id || "";
    var className = String(node.className || "");

    return (
      id === "WACViewPanel_EditingElement" ||
      /\bWACEditing\b/.test(className) ||
      /\bEditingSurfaceBody\b/.test(className)
    );
  }

  function isContentEditableElement(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }

    return node.isContentEditable || node.getAttribute("contenteditable") === "true";
  }

  function isEditorRootElement(node) {
    return isContentEditableElement(node) || isWordOnlineSurfaceElement(node);
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

  function getEventDocument(event) {
    var target = event && event.target;
    if (target && target.ownerDocument) {
      return target.ownerDocument;
    }

    return getActiveDocument();
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
      if (isEditorRootElement(current)) {
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

  function createRangeFromTextOffsets(doc, root, startOffset, endOffset) {
    if (!doc || !root || startOffset < 0 || endOffset < startOffset) {
      return null;
    }

    var start = resolveTextPosition(doc, root, startOffset);
    var end = resolveTextPosition(doc, root, endOffset);

    if (!start || !start.node || !end || !end.node) {
      return null;
    }

    try {
      var range = doc.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    } catch (error) {
      return null;
    }
  }

  function getTextOffsetWithinRoot(doc, root, node, offset) {
    if (!doc || !root || !node) {
      return -1;
    }

    if (node === root) {
      return offset;
    }

    var walker = createTextWalker(doc, root);
    var current = walker.nextNode();
    var total = 0;

    while (current) {
      if (current === node) {
        return total + offset;
      }

      total += current.nodeValue ? current.nodeValue.length : 0;
      current = walker.nextNode();
    }

    return -1;
  }

  function captureShortcutContext(doc, range) {
    if (!doc || !range) {
      return null;
    }

    var root =
      findEditableRoot(range.commonAncestorContainer) ||
      findEditableRoot(range.startContainer) ||
      findEditableRoot(doc.activeElement);

    if (!root) {
      return null;
    }

    var startOffset = getTextOffsetWithinRoot(
      doc,
      root,
      range.startContainer,
      range.startOffset
    );

    if (startOffset < 0) {
      return { root: root, startOffset: -1 };
    }

    return {
      root: root,
      scope: doc.body || doc.documentElement || root,
      startOffset: startOffset,
    };
  }

  function collectEditableRoots(scope) {
    var roots = [];

    if (!scope || !scope.nodeType) {
      return roots;
    }

    if (isEditorRootElement(scope)) {
      roots.push(scope);
    }

    if (scope.querySelectorAll) {
      var matches = scope.querySelectorAll(
        '[contenteditable="true"], #WACViewPanel_EditingElement, .WACEditing, .EditingSurfaceBody'
      );
      for (var i = 0; i < matches.length; i += 1) {
        if (roots.indexOf(matches[i]) === -1) {
          roots.push(matches[i]);
        }
      }
    }

    return roots;
  }

  function createCleanupRange(doc, root, startOffset, expectedText) {
    if (!doc || !root || startOffset < 0 || !expectedText) {
      return null;
    }

    var rootText = root.textContent || "";
    var endOffset = startOffset + expectedText.length;

    if (rootText.slice(startOffset, endOffset) !== expectedText) {
      return null;
    }

    var nextChar = rootText.charAt(endOffset);
    if (nextChar && /[\s\u00a0]/.test(nextChar)) {
      endOffset += 1;
    }

    return createRangeFromTextOffsets(doc, root, startOffset, endOffset);
  }

  function isIgnorableShortcutChar(char) {
    return char === "\u200b" || char === "\u200c" || char === "\u200d" || char === "\ufeff";
  }

  function findShortcutOffsets(rootText, expectedText) {
    if (!rootText || !expectedText) {
      return [];
    }

    var matches = [];

    for (var start = 0; start < rootText.length; start += 1) {
      if (rootText.charAt(start) !== expectedText.charAt(0)) {
        continue;
      }

      var textIndex = start;
      var expectedIndex = 0;

      while (textIndex < rootText.length && expectedIndex < expectedText.length) {
        var currentChar = rootText.charAt(textIndex);

        if (isIgnorableShortcutChar(currentChar)) {
          textIndex += 1;
          continue;
        }

        if (currentChar !== expectedText.charAt(expectedIndex)) {
          break;
        }

        textIndex += 1;
        expectedIndex += 1;
      }

      if (expectedIndex !== expectedText.length) {
        continue;
      }

      while (textIndex < rootText.length && isIgnorableShortcutChar(rootText.charAt(textIndex))) {
        textIndex += 1;
      }

      if (/[\s\u00a0]/.test(rootText.charAt(textIndex) || "")) {
        textIndex += 1;
      }

      matches.push({
        startOffset: start,
        endOffset: textIndex,
      });
    }

    return matches;
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

  function normalizeEditorTextForRecovery(text) {
    return String(text || "")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function collectRecoveryRoots(context) {
    var roots = [];

    if (!context) {
      return roots;
    }

    if (context.root && context.root.isConnected) {
      roots.push(context.root);
    }

    collectEditableRoots(context.scope).forEach(function(root) {
      if (roots.indexOf(root) === -1) {
        roots.push(root);
      }
    });

    return roots;
  }

  function recoverRichPasteWithDomInsertion(doc, context, html, plainText) {
    if (!doc || !context) {
      return false;
    }

    var roots = collectRecoveryRoots(context);

    for (var i = 0; i < roots.length; i += 1) {
      var root = roots[i];
      if (!root || !root.isConnected) {
        continue;
      }

      var normalizedRootText = normalizeEditorTextForRecovery(root.textContent || "");
      if (normalizedRootText) {
        continue;
      }

      var recoveryRange = null;
      if ((root.textContent || "").length > 0) {
        recoveryRange = doc.createRange();
        recoveryRange.selectNodeContents(root);
      } else if (typeof context.startOffset === "number" && context.startOffset >= 0) {
        recoveryRange = createRangeFromTextOffsets(
          doc,
          root,
          context.startOffset,
          context.startOffset
        );
      }

      if (!recoveryRange) {
        recoveryRange = getSelectedRange(doc);
      }

      if (!recoveryRange) {
        continue;
      }

      return insertHtmlWithRange(doc, recoveryRange, html, plainText);
    }

    return false;
  }

  function cleanupResidualShortcut(doc, context, expectedText) {
    if (!doc || !context || !expectedText) {
      return;
    }

    var candidateRoots = [];

    if (context.root) {
      candidateRoots.push(context.root);
    }

    collectEditableRoots(context.scope).forEach(function(root) {
      if (candidateRoots.indexOf(root) === -1) {
        candidateRoots.push(root);
      }
    });

    for (var rootIndex = 0; rootIndex < candidateRoots.length; rootIndex += 1) {
      var root = candidateRoots[rootIndex];
      if (!root || !root.isConnected) {
        continue;
      }

      if (root === context.root && typeof context.startOffset === "number" && context.startOffset >= 0) {
        var exactRange = createCleanupRange(
          doc,
          root,
          context.startOffset,
          expectedText
        );

        if (
          exactRange &&
          exactRange.toString().replace(/[\s\u00a0]+$/, "") === expectedText
        ) {
          deleteRangeForInsertion(doc, exactRange);
          return;
        }
      }

      var rootText = root.textContent || "";
      var matches = findShortcutOffsets(rootText, expectedText);
      if (matches.length === 0) {
        continue;
      }

      var targetMatch = null;

      if (root === context.root && typeof context.startOffset === "number" && context.startOffset >= 0) {
        var closestDistance = Infinity;
        for (var i = 0; i < matches.length; i += 1) {
          var distance = Math.abs(matches[i].startOffset - context.startOffset);
          if (distance < closestDistance) {
            closestDistance = distance;
            targetMatch = matches[i];
          }
        }
      } else if (matches.length === 1) {
        targetMatch = matches[0];
      } else if (matches[matches.length - 1].endOffset === rootText.length) {
        targetMatch = matches[matches.length - 1];
      } else if (matches[0].startOffset === 0) {
        targetMatch = matches[0];
      } else {
        targetMatch = matches[0];
      }

      if (!targetMatch) {
        continue;
      }

      var residualRange = createRangeFromTextOffsets(
        doc,
        root,
        targetMatch.startOffset,
        targetMatch.endOffset
      );

      if (
        residualRange &&
        residualRange.toString().replace(/[\s\u00a0\u200b\u200c\u200d\ufeff]+/g, "") ===
          expectedText
      ) {
        deleteRangeForInsertion(doc, residualRange);
        return;
      }
    }
  }

  function scheduleResidualShortcutCleanup(doc, context, expectedText) {
    if (!doc || !context || !expectedText || typeof global.setTimeout !== "function") {
      return;
    }

    [0, 30, 120, 250, 500, 1000, 1500].forEach(function(delay) {
      global.setTimeout(function() {
        cleanupResidualShortcut(doc, context, expectedText);
      }, delay);
    });

    if (global.MutationObserver && context.scope) {
      var observer = new global.MutationObserver(function() {
        cleanupResidualShortcut(doc, context, expectedText);
      });

      observer.observe(context.scope, {
        childList: true,
        characterData: true,
        subtree: true,
      });

      global.setTimeout(function() {
        observer.disconnect();
      }, 1800);
    }
  }

  function scheduleRichPasteRecovery(doc, context, html, plainText) {
    if (!doc || !context || !html || typeof global.setTimeout !== "function") {
      return;
    }

    [30, 120, 250, 500, 1000, 1500].forEach(function(delay) {
      global.setTimeout(function() {
        recoverRichPasteWithDomInsertion(doc, context, html, plainText);
      }, delay);
    });

    if (global.MutationObserver && context.scope) {
      var observer = new global.MutationObserver(function() {
        recoverRichPasteWithDomInsertion(doc, context, html, plainText);
      });

      observer.observe(context.scope, {
        childList: true,
        characterData: true,
        subtree: true,
      });

      global.setTimeout(function() {
        observer.disconnect();
      }, 1800);
    }
  }

  async function pasteHtmlWithRange(doc, range, expectedText, html, plainText) {
    if (!doc || !range || !html) {
      return false;
    }

    var shortcutContext = captureShortcutContext(doc, range);
    logWordProbe(doc, "before-clipboard-write", expectedText, plainText);

    // Keep clipboard persistence off the critical path. The synthetic paste event
    // already carries HTML/plain-text payloads, so waiting on clipboard.write()
    // only delays the delete -> select -> paste sequence that Word Online is
    // sensitive to.
    writeRichClipboard(doc, html, plainText).catch(function() {
      return false;
    });

    logWordProbe(doc, "before-shortcut-delete", expectedText, plainText);
    var insertionRange = deleteRangeForInsertion(doc, range);
    if (!insertionRange) {
      return false;
    }

    selectRange(doc, insertionRange);
    logWordProbe(doc, "after-shortcut-delete", expectedText, plainText);

    var handled = dispatchRichPaste(doc, insertionRange, html, plainText);
    if (handled) {
      recoverRichPasteWithDomInsertion(doc, shortcutContext, html, plainText);
      scheduleRichPasteRecovery(doc, shortcutContext, html, plainText);
      cleanupResidualShortcut(doc, shortcutContext, expectedText);
      scheduleResidualShortcutCleanup(doc, shortcutContext, expectedText);
      scheduleWordProbeSnapshots(doc, expectedText, plainText);
      return true;
    }

    return insertHtmlWithRange(doc, insertionRange.cloneRange(), html, plainText);
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

    return pasteHtmlWithRange(
      doc,
      shortcutRange.cloneRange(),
      expectedText,
      normalizedHtml,
      replacementText
    );
  }

  function notifyTemplateUsed(template) {
    if (chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
      var result = chrome.runtime.sendMessage({
        type: "UPDATE_RECENT",
        payload: { templateId: template.id },
      });

      if (result && typeof result.catch === "function") {
        result.catch(function(error) {
          if (!isBenignExtensionContextError(error)) {
            console.warn("Minutário falhou ao registrar template recente.", error);
          }
        });
      }
    }
  }

  function handleCompletionKey(event, activeBuffer, doc) {
    var shortcut = activeBuffer.slice(1).toLowerCase();

    if (!shortcut) {
      return false;
    }

    var template = templateCache[shortcut];

    if (!template || typeof template.content !== "string") {
      debugLog("Atalho digitado sem correspondência exata.", {
        shortcut: shortcut,
      });
      return false;
    }

    var plainText = stripHtml(template.content);
    var targetDoc = doc || global.document;
    var activeElement = targetDoc.activeElement;
    var canAttemptRichPaste =
      canUseRichPaste(targetDoc, template.content) && !isTextControl(activeElement);
    var shortcutRange = null;

    logWordDecision(targetDoc, "completion-key-received", {
      activeBuffer: activeBuffer,
      activeTag: activeElement && activeElement.tagName,
      activeContenteditable:
        !!(activeElement && activeElement.getAttribute && activeElement.getAttribute("contenteditable") === "true"),
      isTextControl: isTextControl(activeElement),
      canUseRichPaste: canUseRichPaste(targetDoc, template.content),
    });

    if (
      activeElement &&
      (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA") &&
      !isTextControl(activeElement)
    ) {
      logWordDecision(targetDoc, "completion-key-blocked-nontext-input", {
        activeTag: activeElement.tagName,
        inputType: activeElement.type || "",
      });
      return false;
    }

    if (canAttemptRichPaste) {
      shortcutRange = createShortcutRange(targetDoc, activeBuffer);
      if (!shortcutRange) {
        logWordDecision(targetDoc, "completion-key-missing-shortcut-range", {
          activeBuffer: activeBuffer,
          selectionText: (getSelection(targetDoc) && getSelection(targetDoc).toString()) || "",
          activeTag: activeElement && activeElement.tagName,
        });
        return false;
      }

      logWordDecision(targetDoc, "completion-key-rich-paste", {
        activeBuffer: activeBuffer,
        activeTag: activeElement && activeElement.tagName,
      });
      event.preventDefault();
      expandTemplateAtSelectionRich(
        targetDoc,
        activeBuffer,
        template.content,
        plainText
      ).then(function (expanded) {
        debugLog("Tentativa de expansão rica concluída.", {
          shortcut: shortcut,
          expanded: expanded,
        });
        if (expanded) {
          notifyTemplateUsed(template);
        }
      }).catch(function (error) {
        console.error("Minutário failed to expand rich template:", error);
      });

      return true;
    }

    logWordDecision(targetDoc, "completion-key-plain-fallback", {
      activeBuffer: activeBuffer,
      activeTag: activeElement && activeElement.tagName,
      canUseRichPaste: canUseRichPaste(targetDoc, template.content),
    });

    var expanded = expandTemplateAtSelection(
      targetDoc,
      activeBuffer,
      template.content,
      plainText
    );

    if (!expanded) {
      debugLog("Falha na expansão simples.", {
        shortcut: shortcut,
      });
      return false;
    }

    event.preventDefault();
    notifyTemplateUsed(template);

    return true;
  }

  var api = {
    expandTemplateAtSelection: expandTemplateAtSelection,
    expandTemplateAtSelectionRich: expandTemplateAtSelectionRich,
    collectEditorDiagnostics: collectEditorDiagnostics,
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
      scheduleTemplateReload("runtime-message");
    }
  });

  if (global.addEventListener) {
    global.addEventListener("focus", function () {
      scheduleTemplateReload("window-focus");
    }, true);
  }

  if (global.document && global.document.addEventListener) {
    global.document.addEventListener("visibilitychange", function () {
      if (!global.document.hidden) {
        scheduleTemplateReload("visibilitychange");
      }
    });
  }

  if (global.MutationObserver && global.document && global.document.documentElement) {
    var observer = new global.MutationObserver(function (mutations) {
      var shouldReload = mutations.some(function (mutation) {
        return Array.prototype.some.call(mutation.addedNodes || [], function (node) {
          if (!node || node.nodeType !== 1) {
            return false;
          }

          if (isTextControl(node) || isContentEditableElement(node) || node.tagName === "IFRAME") {
            return true;
          }

          return !!node.querySelector && !!node.querySelector(
            'input[type="text"], textarea, [contenteditable="true"], iframe'
          );
        });
      });

      if (shouldReload) {
        scheduleTemplateReload("dynamic-editor-added");
      }
    });

    observer.observe(global.document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  global.document.addEventListener("keydown", function (event) {
    var eventDoc = getEventDocument(event);

    if (event.key === triggerChar) {
      logWordDecision(eventDoc, "keydown-trigger-char", {
        key: event.key,
        code: event.code || "",
      });
      buffer = triggerChar;
      return;
    }

    if (!buffer) {
      return;
    }

    if (isShortcutChar(event.key)) {
      buffer += event.key;
      logWordDecision(eventDoc, "keydown-buffer-char", {
        key: event.key,
        code: event.code || "",
        buffer: buffer,
      });
      return;
    }

    if (isCompletionKey(event)) {
      var activeBuffer = buffer;
      buffer = "";
      logWordDecision(eventDoc, "keydown-completion-key", {
        key: event.key,
        code: event.code || "",
        activeBuffer: activeBuffer,
      });
      handleCompletionKey(event, activeBuffer, eventDoc);
      return;
    }

    logWordDecision(eventDoc, "keydown-buffer-reset", {
      key: event.key,
      code: event.code || "",
      buffer: buffer,
    });
    buffer = "";
  }, true);

  loadSettings();
  scheduleTemplateReload("startup");
})(typeof globalThis !== "undefined" ? globalThis : this);
