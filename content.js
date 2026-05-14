(function (global) {
  var triggerChar = "/";
  var triggerKey = "Space";
  var buffer = "";
  var templateCache = {};
  var reloadTimer = null;
  var bufferContext = null;
  var activeExpansionContext = null;
  var debugEnabled = !!(global.MinutarioConfig && global.MinutarioConfig.DEBUG_LOGS);
  var WORD_PROBE_STORAGE_KEY = "minutario_last_word_probe";
  var WORD_PROBE_TRAIL_LIMIT = 24;
  var WORD_SELECTION_SYNC_DELAY_MS = 60;
  var wordProbeTrail = [];
  var lastDeleteInfo = null;
  var TEXT_EXPANDER_LOG_PREFIX = "[TextExpander]";
  var wordOnlineCommandOverlay = null;

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

  function textExpanderLog(message, details) {
    if (!debugEnabled || !global.console || typeof global.console.log !== "function") {
      return;
    }

    if (typeof details === "undefined") {
      global.console.log(TEXT_EXPANDER_LOG_PREFIX + " " + message);
      return;
    }

    global.console.log(TEXT_EXPANDER_LOG_PREFIX + " " + message, details);
  }

  function textExpanderWarn(message, details) {
    if (!global.console || typeof global.console.warn !== "function") {
      return;
    }

    if (typeof details === "undefined") {
      global.console.warn(TEXT_EXPANDER_LOG_PREFIX + " " + message);
      return;
    }

    global.console.warn(TEXT_EXPANDER_LOG_PREFIX + " " + message, details);
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

  function safeRangeText(range) {
    try {
      return range ? shortText(range.toString(), 300) : "";
    } catch (error) {
      return "";
    }
  }

  function safeSelectionText(doc) {
    try {
      var selection = doc && doc.getSelection ? doc.getSelection() : null;
      return selection ? shortText(selection.toString(), 300) : "";
    } catch (error) {
      return "";
    }
  }

  function safeRootText(root) {
    try {
      return root ? shortText(root.innerText || root.textContent || "", 500) : "";
    } catch (error) {
      return "";
    }
  }

  function rootContainsText(root, text) {
    try {
      return !!(root && text && (root.innerText || root.textContent || "").indexOf(text) !== -1);
    } catch (error) {
      return false;
    }
  }

  function describeProbeNode(node) {
    if (!node) {
      return "";
    }

    if (node.nodeType === 3) {
      return '#text("' + shortText(node.nodeValue || "", 80) + '")';
    }

    if (node.nodeType !== 1) {
      return "nodeType:" + node.nodeType;
    }

    var label = node.tagName || "ELEMENT";
    if (node.id) {
      label += "#" + node.id;
    }
    if (node.className) {
      label += "." + shortText(String(node.className).replace(/\s+/g, "."), 80);
    }
    return label;
  }

  function appendWordProbeTrail(entry) {
    if (!entry) {
      return wordProbeTrail.slice();
    }

    wordProbeTrail.push(entry);
    if (wordProbeTrail.length > WORD_PROBE_TRAIL_LIMIT) {
      wordProbeTrail = wordProbeTrail.slice(wordProbeTrail.length - WORD_PROBE_TRAIL_LIMIT);
    }

    return wordProbeTrail.slice();
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

    var ctx = getDocumentProbeContext(doc);

    if (
      /officeapps\.live\.com|word-editor\.office\.com|wordeditorframe\.aspx|wordeditorframe|word\.office\.com/i.test(
        ctx
      )
    ) {
      return true;
    }

    try {
      if (doc.body && doc.getElementById("WACViewPanel_EditingElement")) {
        return true;
      }
    } catch (e) {}

    return false;
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

    var capturedAt = new Date().toISOString();
    var diagnostics = collectEditorDiagnostics(doc, expectedText, replacementText);
    var probe = {
      phase: phase,
      capturedAt: capturedAt,
      url: doc && doc.URL ? doc.URL : "",
      referrer: doc && doc.referrer ? doc.referrer : "",
      diagnostics: diagnostics,
      trail: appendWordProbeTrail({
        phase: phase,
        capturedAt: capturedAt,
        type: "diagnostics",
      }),
    };

    if (debugEnabled && global.console && typeof global.console.info === "function") {
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

    var capturedAt = new Date().toISOString();
    var probe = {
      phase: phase,
      capturedAt: capturedAt,
      url: doc && doc.URL ? doc.URL : "",
      referrer: doc && doc.referrer ? doc.referrer : "",
      details: details || {},
      trail: appendWordProbeTrail({
        phase: phase,
        capturedAt: capturedAt,
        type: "decision",
        details: details || {},
      }),
    };

    if (debugEnabled && global.console && typeof global.console.info === "function") {
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

    if (isWordOnlineDocument(doc)) {
      try {
        doc.dispatchEvent(new Event("selectionchange", { bubbles: true }));
      } catch (e) {}
    }
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

  function getEventEditorContext(event, doc) {
    var target = event && event.target;
    var selection = getSelection(doc);
    var selectionRoot =
      selection && selection.rangeCount > 0
        ? findEditableRoot(selection.getRangeAt(0).startContainer)
        : null;
    var targetRoot = findEditableRoot(target);
    var activeRoot = findEditableRoot(doc && doc.activeElement);
    var root = targetRoot || selectionRoot || activeRoot || null;

    if (isTextControl(target)) {
      root = target;
    }

    return {
      doc: doc,
      target: target || null,
      root: root,
    };
  }

  function sameEditorContext(a, b) {
    if (!a || !b) {
      return false;
    }

    return a.doc === b.doc && a.root === b.root;
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

    var targetStart = -1;
    var targetEnd = -1;

    if (rootText.endsWith(expectedText)) {
      targetStart = rootText.length - expectedText.length;
      targetEnd = rootText.length;
    }

    if (targetStart === -1) {
      var lastIdx = rootText.lastIndexOf(expectedText);
      if (lastIdx !== -1) {
        var afterMatch = rootText.slice(lastIdx + expectedText.length);
        if (/^[\s\u00a0\u200b\u200c\u200d\ufeff\u2028\u2029]*$/.test(afterMatch)) {
          targetStart = lastIdx;
          targetEnd = lastIdx + expectedText.length;
        }
      }
    }

    if (targetStart === -1) {
      var strippedRoot = rootText.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
      var strippedIdx = strippedRoot.lastIndexOf(expectedText);
      if (strippedIdx !== -1) {
        var afterStripped = strippedRoot.slice(strippedIdx + expectedText.length);
        if (/^[\s\u00a0\u2028\u2029]*$/.test(afterStripped)) {
          var rawIdx = 0;
          var strippedCount = 0;
          while (rawIdx < rootText.length && strippedCount < strippedIdx) {
            if (!isIgnorableShortcutChar(rootText.charAt(rawIdx))) {
              strippedCount++;
            }
            rawIdx++;
          }
          var rawEnd = rawIdx;
          var matchedChars = 0;
          while (rawEnd < rootText.length && matchedChars < expectedText.length) {
            if (!isIgnorableShortcutChar(rootText.charAt(rawEnd))) {
              matchedChars++;
            }
            rawEnd++;
          }
          targetStart = rawIdx;
          targetEnd = rawEnd;
        }
      }
    }

    if (targetStart === -1) {
      return null;
    }

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

      var stripped = shortcutRange.toString().replace(/[\u200b\u200c\u200d\ufeff]/g, "");
      if (stripped === expectedText) {
        return shortcutRange;
      }
    }

    if (isWordOnlineDocument(doc)) {
      var extraStart = walkBackwardsToStart(
        currentRange.endContainer,
        currentRange.endOffset,
        expectedText.length + 1
      );

      if (extraStart) {
        var extraRange = doc.createRange();
        extraRange.setStart(extraStart.node, extraStart.offset);
        extraRange.setEnd(currentRange.endContainer, currentRange.endOffset);

        var extraText = extraRange.toString();
        var extraStripped = extraText.replace(/[\u200b\u200c\u200d\ufeff]/g, "");

        if (extraStripped.length > expectedText.length) {
          var lastChar = extraStripped.charAt(extraStripped.length - 1);
          var withoutLast = extraStripped.slice(0, -1);
          if (/[\s\u00a0]/.test(lastChar) && withoutLast === expectedText) {
            if (extraRange.endContainer.nodeType === 3 && extraRange.endOffset > 0) {
              try {
                extraRange.setEnd(extraRange.endContainer, extraRange.endOffset - 1);
              } catch (trimErr) {}
            }
            return extraRange;
          }
        }

        if (extraStripped === expectedText) {
          return extraRange;
        }
      }
    }

    var root = findEditableRoot(currentRange.endContainer);
    if (root) {
      var fallbackRange = findRangeByTextSearch(doc, root, expectedText);
      if (fallbackRange) {
        return fallbackRange;
      }

      if (isWordOnlineDocument(doc)) {
        var withSpaceRange = findRangeByTextSearch(doc, root, expectedText + " ");
        if (withSpaceRange) {
          var spaceText = withSpaceRange.toString();
          if (/(?:\s|\u00a0)$/.test(spaceText)) {
            if (withSpaceRange.endContainer.nodeType === 3 && withSpaceRange.endOffset > 0) {
              try {
                withSpaceRange.setEnd(withSpaceRange.endContainer, withSpaceRange.endOffset - 1);
              } catch (trimSpaceErr) {}
            }
          }
          return withSpaceRange;
        }
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
    if (
      global.MinutarioRichClipboard &&
      typeof global.MinutarioRichClipboard.prepareHtmlFragment === "function"
    ) {
      return global.MinutarioRichClipboard.prepareHtmlFragment(html, doc);
    }

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
    var htmlForClipboard = html || "";

    if (
      global.MinutarioRichClipboard &&
      typeof global.MinutarioRichClipboard.buildOfficeHtml === "function"
    ) {
      htmlForClipboard = global.MinutarioRichClipboard.buildOfficeHtml(htmlForClipboard, doc);
    } else {
      htmlForClipboard = [
        '<html xmlns:o="urn:schemas-microsoft-com:office:office"',
        ' xmlns:w="urn:schemas-microsoft-com:office:word"',
        ' xmlns="http://www.w3.org/TR/REC-html40">',
        '<head><meta charset="utf-8"></head><body>',
        htmlForClipboard,
        "</body></html>",
      ].join("");
    }

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
          "text/html": new BlobCtor([htmlForClipboard], { type: "text/html" }),
          "text/plain": new BlobCtor([plainText || stripHtml(htmlForClipboard)], {
            type: "text/plain",
          }),
        }),
      ]);
      return true;
    } catch (error) {
      return false;
    }
  }

  function preventHostCompletionEvent(event) {
    if (!event) {
      return;
    }

    try {
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    } catch (error) {}

    try {
      if (typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
    } catch (error) {}

    try {
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    } catch (error) {}
  }

  function insertWordOnlineTextAtCaret(doc, text) {
    if (!doc || !text) {
      return false;
    }

    var activeElement =
      activeExpansionContext &&
      activeExpansionContext.doc === doc &&
      activeExpansionContext.root &&
      isTextControl(activeExpansionContext.root)
        ? activeExpansionContext.root
        : doc.activeElement;
    var activeRange = getSelectedRange(doc);
    var activeRoot =
      findEditableRoot(activeElement) ||
      (activeRange && findEditableRoot(activeRange.startContainer));

    focusEditingSurface(doc, { root: activeRoot, scope: doc.body || doc.documentElement });

    if (typeof doc.execCommand === "function") {
      try {
        if (doc.execCommand("insertText", false, text) === true) {
          return true;
        }
      } catch (insertTextError) {}
    }

    if (activeRange) {
      try {
        activeRange.deleteContents();
        var textNode = doc.createTextNode(text);
        activeRange.insertNode(textNode);
        placeCaretAfterNode(doc, textNode);
        notifyWordInputEvents(doc, activeRoot || textNode.parentNode, "insertText", text);
        return true;
      } catch (domInsertError) {}
    }

    return false;
  }

  function insertWordOnlineHtmlAtCaret(doc, html, plainText) {
    if (!doc || (!html && !plainText)) {
      return false;
    }

    var activeRange = getSelectedRange(doc);
    var activeRoot =
      findEditableRoot(doc.activeElement) ||
      (activeRange && findEditableRoot(activeRange.startContainer));

    focusEditingSurface(doc, { root: activeRoot, scope: doc.body || doc.documentElement });

    if (typeof doc.execCommand === "function") {
      try {
        if (html && doc.execCommand("insertHTML", false, html) === true) {
          return true;
        }
      } catch (insertHtmlError) {}

      try {
        if (plainText && doc.execCommand("insertText", false, plainText) === true) {
          return true;
        }
      } catch (insertTextError) {}
    }

    if (activeRange) {
      try {
        return insertHtmlWithRange(doc, activeRange.cloneRange(), html, plainText);
      } catch (rangeInsertError) {}
    }

    return insertWordOnlineTextAtCaret(doc, plainText || stripHtml(html));
  }

  function findWordOnlineVisibleShortcutRange(doc, expectedText) {
    var activeRange = getSelectedRange(doc);
    var activeRoot =
      findEditableRoot(doc && doc.activeElement) ||
      (activeRange && findEditableRoot(activeRange.startContainer));

    if (activeRoot) {
      var rangeFromRoot = findRangeByTextSearch(doc, activeRoot, expectedText);
      if (rangeFromRoot) {
        return rangeFromRoot;
      }
    }

    return createShortcutRange(doc, expectedText);
  }

  function replaceWordOnlineVisibleShortcut(doc, expectedText, html, plainText) {
    var shortcutRange = findWordOnlineVisibleShortcutRange(doc, expectedText);
    if (!shortcutRange) {
      return false;
    }

    try {
      return insertHtmlWithRange(doc, shortcutRange.cloneRange(), html, plainText);
    } catch (error) {
      return false;
    }
  }

  async function readClipboardTextSafely(doc) {
    var view = getDocumentView(doc);
    var navigatorRef = view.navigator || global.navigator;

    if (
      !navigatorRef ||
      !navigatorRef.clipboard ||
      typeof navigatorRef.clipboard.readText !== "function"
    ) {
      return null;
    }

    try {
      return await navigatorRef.clipboard.readText();
    } catch (error) {
      return null;
    }
  }

  function restoreClipboardTextLater(doc, previousText, expectedCurrentText) {
    if (typeof previousText !== "string" || typeof global.setTimeout !== "function") {
      return;
    }

    global.setTimeout(async function() {
      var view = getDocumentView(doc);
      var navigatorRef = view.navigator || global.navigator;

      if (
        !navigatorRef ||
        !navigatorRef.clipboard ||
        typeof navigatorRef.clipboard.writeText !== "function" ||
        typeof navigatorRef.clipboard.readText !== "function"
      ) {
        return;
      }

      try {
        var currentText = await navigatorRef.clipboard.readText();
        if (currentText !== expectedCurrentText) {
          return;
        }

        await navigatorRef.clipboard.writeText(previousText);
      } catch (error) {
        // Leave the user's clipboard untouched when we cannot prove ownership.
      }
    }, 1600);
  }

  async function sendExtensionMessage(message) {
    if (
      typeof chrome === "undefined" ||
      !chrome ||
      !chrome.runtime ||
      typeof chrome.runtime.sendMessage !== "function"
    ) {
      return null;
    }

    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (!isBenignExtensionContextError(error)) {
        textExpanderWarn("Runtime message failed.", {
          type: message && message.type,
          error: getErrorMessage(error),
        });
      }
      return null;
    }
  }

  function isPositiveDebuggerResponse(response, dataKey) {
    return !!(
      response &&
      response.ok === true &&
      response.data &&
      response.data[dataKey] === true
    );
  }

  async function requestWordOnlineDebuggerPaste(doc, html, plainText) {
    var previousClipboardText = await readClipboardTextSafely(doc);
    var clipboardReady = await writeRichClipboard(doc, html, plainText);

    if (!clipboardReady) {
      logWordDecision(doc, "word-cdp-paste-clipboard-unavailable", {
        plainTextLength: plainText ? plainText.length : 0,
      });
      return false;
    }

    var response = await sendExtensionMessage({
      type: "WORD_ONLINE_CDP_PASTE",
      payload: {
        plainTextLength: plainText ? plainText.length : 0,
        htmlLength: html ? html.length : 0,
      },
    });
    var pasted = isPositiveDebuggerResponse(response, "pasted");

    logWordDecision(doc, "word-cdp-paste-result", {
      pasted: pasted,
      responseOk: !!(response && response.ok),
      error: response && response.error ? response.error : "",
    });

    if (pasted) {
      restoreClipboardTextLater(doc, previousClipboardText, plainText || stripHtml(html));
    }

    return pasted;
  }

  async function requestWordOnlineDebuggerText(doc, text) {
    if (!text) {
      return false;
    }

    var response = await sendExtensionMessage({
      type: "WORD_ONLINE_CDP_INSERT_TEXT",
      payload: {
        text: text,
      },
    });
    var inserted = isPositiveDebuggerResponse(response, "inserted");

    logWordDecision(doc, "word-cdp-insert-text-result", {
      inserted: inserted,
      textLength: text.length,
      responseOk: !!(response && response.ok),
      error: response && response.error ? response.error : "",
    });

    return inserted;
  }

  function insertWordOnlineBufferedText(doc, text) {
    if (!doc || !text) {
      return false;
    }

    requestWordOnlineDebuggerText(doc, text).then(function(inserted) {
      if (!inserted) {
        insertWordOnlineTextAtCaret(doc, text);
      }
    }).catch(function(error) {
      textExpanderWarn("Word Online buffered text insertion failed.", {
        error: getErrorMessage(error),
      });
      insertWordOnlineTextAtCaret(doc, text);
    });

    return true;
  }

  function getWordOnlineOverlayHost(doc) {
    if (!doc) {
      return null;
    }

    return doc.body || doc.documentElement || null;
  }

  function positionWordOnlineCommandOverlay(doc, overlay) {
    if (!doc || !overlay) {
      return;
    }

    var top = 24;
    var left = 24;
    var active = null;

    try {
      active = doc.activeElement;
    } catch (error) {
      active = null;
    }

    try {
      var selection = getSelection(doc);
      if (selection && selection.rangeCount > 0) {
        var range = selection.getRangeAt(0).cloneRange();
        range.collapse(false);
        var rect = range.getBoundingClientRect();
        if (rect && (rect.left || rect.top || rect.width || rect.height)) {
          left = rect.left + 8;
          top = rect.bottom + 8;
        }
      }
    } catch (rangeError) {}

    if (top === 24 && active && typeof active.getBoundingClientRect === "function") {
      try {
        var activeRect = active.getBoundingClientRect();
        if (activeRect && (activeRect.left || activeRect.top || activeRect.width || activeRect.height)) {
          left = activeRect.left + 24;
          top = activeRect.top + 24;
        }
      } catch (activeRectError) {}
    }

    overlay.style.left = Math.max(8, Math.min(left, (doc.documentElement.clientWidth || 9999) - 160)) + "px";
    overlay.style.top = Math.max(8, Math.min(top, (doc.documentElement.clientHeight || 9999) - 48)) + "px";
  }

  function showWordOnlineCommandOverlay(doc, text) {
    var host = getWordOnlineOverlayHost(doc);
    if (!host || !text) {
      hideWordOnlineCommandOverlay();
      return;
    }

    if (!wordOnlineCommandOverlay || wordOnlineCommandOverlay.ownerDocument !== doc) {
      hideWordOnlineCommandOverlay();
      wordOnlineCommandOverlay = doc.createElement("div");
      wordOnlineCommandOverlay.setAttribute("data-minutario-word-command", "true");
      wordOnlineCommandOverlay.style.position = "fixed";
      wordOnlineCommandOverlay.style.zIndex = "2147483647";
      wordOnlineCommandOverlay.style.maxWidth = "280px";
      wordOnlineCommandOverlay.style.padding = "4px 8px";
      wordOnlineCommandOverlay.style.border = "1px solid rgba(37, 99, 235, 0.35)";
      wordOnlineCommandOverlay.style.borderRadius = "6px";
      wordOnlineCommandOverlay.style.background = "rgba(255, 255, 255, 0.96)";
      wordOnlineCommandOverlay.style.color = "#1d4ed8";
      wordOnlineCommandOverlay.style.boxShadow = "0 8px 18px rgba(15, 23, 42, 0.16)";
      wordOnlineCommandOverlay.style.fontFamily = "Consolas, Monaco, monospace";
      wordOnlineCommandOverlay.style.fontSize = "13px";
      wordOnlineCommandOverlay.style.fontWeight = "600";
      wordOnlineCommandOverlay.style.lineHeight = "18px";
      wordOnlineCommandOverlay.style.pointerEvents = "none";
      wordOnlineCommandOverlay.style.whiteSpace = "nowrap";
      wordOnlineCommandOverlay.style.overflow = "hidden";
      wordOnlineCommandOverlay.style.textOverflow = "ellipsis";
      host.appendChild(wordOnlineCommandOverlay);
    }

    wordOnlineCommandOverlay.textContent = text;
    positionWordOnlineCommandOverlay(doc, wordOnlineCommandOverlay);
  }

  function hideWordOnlineCommandOverlay() {
    if (wordOnlineCommandOverlay && wordOnlineCommandOverlay.parentNode) {
      try {
        wordOnlineCommandOverlay.parentNode.removeChild(wordOnlineCommandOverlay);
      } catch (error) {}
    }

    wordOnlineCommandOverlay = null;
  }

  function replaceWordOnlineVisibleBuffer(doc, oldText, newText) {
    var visibleRange = findWordOnlineVisibleShortcutRange(doc, oldText);
    if (!visibleRange) {
      return false;
    }

    try {
      selectRange(doc, visibleRange);
      return insertWordOnlineTextAtCaret(doc, newText);
    } catch (error) {
      return false;
    }
  }

  async function expandWordOnlineWithNativeInput(doc, expectedText, html, plainText) {
    if (!doc || !expectedText || !plainText) {
      return false;
    }

    logWordDecision(doc, "word-shadow-expansion-request", {
      expectedText: expectedText,
      plainTextPreview: shortText(plainText, 160),
    });
    textExpanderLog("Expanding Word Online shortcut from pre-commit buffer.", {
      shortcut: expectedText,
    });

    // Word Online owns a private document model. The reliable path is to avoid
    // committing the shortcut to that model at all, then send the expansion as
    // browser-level text through Chrome DevTools Protocol. Input.insertText does
    // not depend on the system clipboard, so it avoids Word reading stale
    // clipboard contents while the browser is still settling a rich write.
    var inserted = await requestWordOnlineDebuggerText(doc, plainText);

    if (!inserted) {
      inserted = await requestWordOnlineDebuggerPaste(doc, html, plainText);
    }

    if (!inserted) {
      inserted = insertWordOnlineHtmlAtCaret(doc, html, plainText);
    }

    if (inserted) {
      logWordDecision(doc, "word-shadow-expansion-success", {
        expectedText: expectedText,
        strategy: "precommit-cdp",
      });
      scheduleWordProbeSnapshots(doc, expectedText, plainText);
      return true;
    }

    logWordDecision(doc, "word-shadow-expansion-failed", {
      expectedText: expectedText,
    });
    textExpanderWarn("Word Online shadow-buffer expansion failed; falling back to legacy path.", {
      shortcut: expectedText,
    });
    return false;
  }

  async function fallbackWordOnlineLegacyExpansion(doc, expectedText, html, plainText) {
    var shortcutRange =
      activeExpansionContext &&
      activeExpansionContext.doc === doc &&
      activeExpansionContext.root &&
      !isTextControl(activeExpansionContext.root)
        ? findRangeByTextSearch(doc, activeExpansionContext.root, expectedText)
        : null;
    if (!shortcutRange) {
      shortcutRange = createShortcutRange(doc, expectedText);
    }
    if (!shortcutRange) {
      return false;
    }

    return pasteHtmlWithRange(
      doc,
      shortcutRange.cloneRange(),
      expectedText,
      html,
      plainText
    );
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

  function shouldAvoidSyntheticRichPaste(doc) {
    var ctx = getDocumentProbeContext(doc);
    return /(?:^|\/\/)(?:mail|keep)\.google\.com/i.test(ctx);
  }

  function getSelectedRange(doc) {
    var selection = getSelection(doc);

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    return selection.getRangeAt(0);
  }

  function createCollapsedInsertionRange(doc, root, startOffset) {
    var insertionRange = null;

    if (root && root.isConnected && typeof startOffset === "number" && startOffset >= 0) {
      var rootLength = (root.textContent || "").length;
      var safeOffset = Math.max(0, Math.min(startOffset, rootLength));
      insertionRange = createRangeFromTextOffsets(doc, root, safeOffset, safeOffset);
    }

    if (!insertionRange) {
      insertionRange = getSelectedRange(doc);
    }

    if (!insertionRange) {
      var target = doc.activeElement || root || doc.body || doc.documentElement;
      if (target && target.nodeType === 1) {
        try {
          insertionRange = doc.createRange();
          insertionRange.selectNodeContents(target);
          insertionRange.collapse(false);
        } catch (fallbackError) {
          insertionRange = null;
        }
      }
    }

    if (insertionRange) {
      insertionRange.collapse(true);
      selectRange(doc, insertionRange);
    }

    return insertionRange;
  }

  function insertHtmlWithEditingCommand(doc, range, html, plainText) {
    if (!doc || !range || typeof doc.execCommand !== "function") {
      return false;
    }

    selectRange(doc, range);

    var root = findEditableRoot(range.startContainer);
    var shortcutText = range.toString ? range.toString() : "";
    var expectedWasPresent = root ? rootContainsText(root, shortcutText) : false;

    try {
      if (html && doc.execCommand("insertHTML", false, html) === true) {
        var textAfterHtmlCmd = root ? (root.textContent || "") : "";
        var shortcutStillPresentHtml = expectedWasPresent && textAfterHtmlCmd.indexOf(shortcutText) !== -1;
        if (!shortcutStillPresentHtml) {
          return true;
        }
      }
    } catch (htmlCommandError) {
      // Fall through to plain text command.
    }

    try {
      if (plainText && doc.execCommand("insertText", false, plainText) === true) {
        var textAfterTextCmd = root ? (root.textContent || "") : "";
        var shortcutStillPresent = expectedWasPresent && textAfterTextCmd.indexOf(shortcutText) !== -1;
        if (!shortcutStillPresent) {
          return true;
        }
      }
    } catch (textCommandError) {
      return false;
    }

    return false;
  }

  /**
   * Dispatches beforeinput/input events so Word Online's virtual document
   * model registers the mutation as a legitimate user edit. Without this,
   * Word may re-hydrate the deleted shortcut on the next reconciliation
   * cycle because its internal model never saw the deletion.
   */
  function notifyWordInputEvents(doc, target, inputType, data) {
    if (!doc || !target) {
      return;
    }

    var editableRoot = target || doc.activeElement || doc.body;
    var eventData = inputType === "insertText" ? (data || "") : null;

    var beforeEvent = null;
    try {
      beforeEvent = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: inputType,
        data: eventData,
        isComposing: false,
      });
    } catch (beforeInputCtorError) {
      // InputEvent constructor not available in this context.
    }

    if (beforeEvent) {
      editableRoot.dispatchEvent(beforeEvent);

      if (!beforeEvent.defaultPrevented) {
        try {
          var inputEvent = new InputEvent("input", {
            bubbles: true,
            cancelable: false,
            inputType: inputType,
            data: eventData,
            isComposing: false,
          });
          editableRoot.dispatchEvent(inputEvent);
        } catch (inputCtorError) {
          // Ignore.
        }
      }
    }
  }

  function waitForWordSelectionSync(doc) {
    var view = getDocumentView(doc || global.document);
    var raf = view.requestAnimationFrame || global.requestAnimationFrame;
    var wnd = view !== global ? view : global;
    var hasRaf = typeof raf === "function";
    var isWord = isWordOnlineDocument(doc || global.document);
    var frames = isWord ? 5 : 2;
    var delay = isWord ? 100 : 30;

    if (!hasRaf && typeof global.setTimeout !== "function") {
      return Promise.resolve();
    }

    return new Promise(function(resolve) {
      if (hasRaf) {
        function chainFrame(remaining) {
          if (remaining <= 0) {
            global.setTimeout(resolve, delay);
            return;
          }
          raf.call(wnd, function() {
            chainFrame(remaining - 1);
          });
        }
        chainFrame(frames);
      } else {
        global.setTimeout(resolve, isWord ? 200 : WORD_SELECTION_SYNC_DELAY_MS);
      }
    });
  }

  function focusEditingSurface(doc, shortcutContext) {
    var surface = null;

    if (shortcutContext && shortcutContext.root && typeof shortcutContext.root.focus === "function") {
      surface = shortcutContext.root;
    }

    if (!surface) {
      var active = doc.activeElement;
      if (active && isEditorRootElement(active) && typeof active.focus === "function") {
        surface = active;
      }
    }

    if (!surface) {
      try {
        var editables = collectEditableRoots(doc.body || doc.documentElement);
        for (var i = 0; i < editables.length; i++) {
          if (editables[i] && typeof editables[i].focus === "function") {
            surface = editables[i];
            break;
          }
        }
      } catch (e) {}
    }

    if (surface) {
      try {
        surface.focus();
      } catch (e) {}
    }
  }

  function deleteRangeForInsertion(doc, range, expectedText) {
    if (!doc || !range) {
      return null;
    }

    var root = findEditableRoot(range.startContainer) || findEditableRoot(range.commonAncestorContainer);
    var startOffset = root
      ? getTextOffsetWithinRoot(doc, root, range.startContainer, range.startOffset)
      : -1;
    var expectedWasPresent = rootContainsText(root, expectedText);

    lastDeleteInfo = {
      hostCommandAttempted: false,
      hostCommandSucceeded: false,
      hostCommandRemovedExpected: false,
      domFallbackUsed: false,
    };

    try {
      selectRange(doc, range);

      if (typeof doc.execCommand === "function") {
        lastDeleteInfo.hostCommandAttempted = true;
        try {
          lastDeleteInfo.hostCommandSucceeded = doc.execCommand("delete", false, null) === true;
        } catch (commandError) {
          lastDeleteInfo.hostCommandSucceeded = false;
        }
      }

      if (lastDeleteInfo.hostCommandSucceeded) {
        lastDeleteInfo.hostCommandRemovedExpected =
          !expectedText || !expectedWasPresent || !rootContainsText(root, expectedText);

        if (lastDeleteInfo.hostCommandRemovedExpected) {
          return createCollapsedInsertionRange(doc, root, startOffset);
        }
      }

      lastDeleteInfo.domFallbackUsed = true;
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

  function lockExpansion(doc, context, expectedText, html, plainText) {
    if (!doc || !context || !expectedText || !plainText || typeof global.setTimeout !== "function") {
      return;
    }

    var root = context.root;
    var scope = context.scope;
    var reapplyCount = 0;
    var maxReapplies = 12;
    var observer = null;
    var alive = true;
    var lastReapply = 0;
    var minReapplyInterval = 200;

    function shortcutIsPresent() {
      if (!root || !root.isConnected) {
        return false;
      }

      var rootText = normalizeEditorTextForRecovery(root.textContent || "");
      return rootText.indexOf(normalizeEditorTextForRecovery(expectedText)) !== -1;
    }

    function reapply() {
      if (!alive || !shortcutIsPresent()) {
        return;
      }

      var now = Date.now();
      if (now - lastReapply < minReapplyInterval) {
        return;
      }

      if (reapplyCount >= maxReapplies) {
        stop();
        return;
      }

      reapplyCount += 1;
      lastReapply = now;

      focusEditingSurface(doc, context);

      var matches = findShortcutOffsets(root.textContent || "", expectedText);
      if (!matches || matches.length === 0) {
        return;
      }

      var target = matches[0];
      var range = createRangeFromTextOffsets(doc, root, target.startOffset, target.endOffset);
      if (!range) {
        return;
      }

      selectRange(doc, range);

      if (typeof doc.execCommand === "function") {
        try {
          if (html) {
            doc.execCommand("insertHTML", false, html);
          }
        } catch (e) {}

        try {
          if (plainText && shortcutIsPresent()) {
            doc.execCommand("insertText", false, plainText);
          }
        } catch (e) {}

        try {
          doc.execCommand("insertText", false, "\u200b");
          doc.execCommand("delete", false, null);
        } catch (e) {}
      }
    }

    function stop() {
      alive = false;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    [300, 700, 1200, 1800, 2500, 3300, 4200, 5200, 6300, 7500, 8800, 10000].forEach(function(delay) {
      global.setTimeout(function() {
        if (alive && shortcutIsPresent()) {
          reapply();
        }
      }, delay);
    });

    if (global.MutationObserver && scope) {
      observer = new global.MutationObserver(function() {
        if (alive && shortcutIsPresent()) {
          global.setTimeout(reapply, 60);
        }
      });

      observer.observe(scope, {
        childList: true,
        characterData: true,
        subtree: true,
      });

      global.setTimeout(stop, 12000);
    } else {
      global.setTimeout(stop, 12000);
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

    if (isWordOnlineDocument(doc)) {
      focusEditingSurface(doc, shortcutContext);
      selectRange(doc, range);
      logWordDecision(doc, "word-edit-command-insert-attempt", {
        expectedText: expectedText || "",
        selectedText: safeSelectionText(doc),
        rootText: safeRootText(shortcutContext && shortcutContext.root),
      });

      await waitForWordSelectionSync(doc);
      selectRange(doc, range);

      var wordEditCommandHandled = insertHtmlWithEditingCommand(
        doc,
        range.cloneRange(),
        html,
        plainText
      );
      var wordEditCommandSelectedText = safeSelectionText(doc);
      var wordEditCommandRootText = safeRootText(shortcutContext && shortcutContext.root);
      var wordEditCommandRootContainsExpected = rootContainsText(
        shortcutContext && shortcutContext.root,
        expectedText
      );

      if (wordEditCommandHandled) {
        cleanupResidualShortcut(doc, shortcutContext, expectedText);
      }

      logWordDecision(doc, "word-edit-command-insert-result", {
        expectedText: expectedText || "",
        handled: wordEditCommandHandled,
        selectedText: safeSelectionText(doc),
        selectedTextBeforeCleanup: wordEditCommandSelectedText,
        rootText: safeRootText(shortcutContext && shortcutContext.root),
        rootTextBeforeCleanup: wordEditCommandRootText,
        rootContainsExpected: rootContainsText(
          shortcutContext && shortcutContext.root,
          expectedText
        ),
        rootContainsExpectedBeforeCleanup: wordEditCommandRootContainsExpected,
      });

      if (wordEditCommandHandled) {
        scheduleResidualShortcutCleanup(doc, shortcutContext, expectedText);
        lockExpansion(doc, shortcutContext, expectedText, html, plainText);
        scheduleWordProbeSnapshots(doc, expectedText, plainText);
        return true;
      }

      selectRange(doc, range);
      await waitForWordSelectionSync(doc);

      if (typeof doc.execCommand === "function") {
        try {
          doc.execCommand("delete", false, null);
        } catch (delErr) {}

        await waitForWordSelectionSync(doc);

        var shortcutGone = !rootContainsText(
          shortcutContext && shortcutContext.root,
          expectedText
        );

        if (shortcutGone) {
          try {
            if (html && doc.execCommand("insertHTML", false, html) === true) {
              scheduleResidualShortcutCleanup(doc, shortcutContext, expectedText);
              lockExpansion(doc, shortcutContext, expectedText, html, plainText);
              scheduleWordProbeSnapshots(doc, expectedText, plainText);
              return true;
            }
          } catch (insHtmlErr) {}

          try {
            if (plainText && doc.execCommand("insertText", false, plainText) === true) {
              scheduleResidualShortcutCleanup(doc, shortcutContext, expectedText);
              lockExpansion(doc, shortcutContext, expectedText, html, plainText);
              scheduleWordProbeSnapshots(doc, expectedText, plainText);
              return true;
            }
          } catch (insErr) {}
        }
      }

      logWordDecision(doc, "word-edit-command-fallback-to-paste", {
        expectedText: expectedText || "",
        selectedText: safeSelectionText(doc),
        rootText: safeRootText(shortcutContext && shortcutContext.root),
      });
    }

    logWordProbe(doc, "before-shortcut-delete", expectedText, plainText);
    var beforeDeleteDetails = {
      expectedText: expectedText || "",
      beforeRangeText: safeRangeText(range),
      beforeSelectionText: safeSelectionText(doc),
      beforeRootText: safeRootText(shortcutContext && shortcutContext.root),
      beforeRootContainsExpected: rootContainsText(
        shortcutContext && shortcutContext.root,
        expectedText
      ),
      rootConnected: !!(shortcutContext && shortcutContext.root && shortcutContext.root.isConnected),
      rangeStart: describeProbeNode(range.startContainer),
      rangeEnd: describeProbeNode(range.endContainer),
    };
    var insertionRange = deleteRangeForInsertion(doc, range, expectedText);
    logWordDecision(doc, "shortcut-delete-result", {
      expectedText: beforeDeleteDetails.expectedText,
      beforeRangeText: beforeDeleteDetails.beforeRangeText,
      afterRangeText: safeRangeText(insertionRange),
      beforeSelectionText: beforeDeleteDetails.beforeSelectionText,
      afterSelectionText: safeSelectionText(doc),
      beforeRootText: beforeDeleteDetails.beforeRootText,
      afterRootText: safeRootText(shortcutContext && shortcutContext.root),
      beforeRootContainsExpected: beforeDeleteDetails.beforeRootContainsExpected,
      afterRootContainsExpected: rootContainsText(
        shortcutContext && shortcutContext.root,
        expectedText
      ),
      rootConnected: !!(shortcutContext && shortcutContext.root && shortcutContext.root.isConnected),
      deleteReturnedRange: !!insertionRange,
      deleteInfo: lastDeleteInfo,
      rangeStart: beforeDeleteDetails.rangeStart,
      rangeEnd: beforeDeleteDetails.rangeEnd,
    });
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

    if (isWordOnlineDocument(doc)) {
      var wordRoot = findEditableRoot(range.startContainer);

      if (typeof doc.execCommand === "function") {
        selectRange(doc, range);

        try {
          if (html && doc.execCommand("insertHTML", false, html) === true) {
            var afterHtml = wordRoot ? (wordRoot.textContent || "") : "";
            var shortcutHtml = range.toString ? range.toString() : "";
            if (!shortcutHtml || afterHtml.indexOf(shortcutHtml) === -1) {
              return true;
            }
          }
        } catch (e) {}

        try {
          selectRange(doc, range);
          if (plainText && doc.execCommand("insertText", false, plainText) === true) {
            var afterText = wordRoot ? (wordRoot.textContent || "") : "";
            var shortcutText = range.toString ? range.toString() : "";
            if (!shortcutText || afterText.indexOf(shortcutText) === -1) {
              return true;
            }
          }
        } catch (e) {}
      }

      range.deleteContents();

      var wordInsertedNodes = [];
      var wordFragment = doc.createDocumentFragment();

      if (html) {
        var wordContainer = doc.createElement("div");
        wordContainer.innerHTML = html;
        while (wordContainer.firstChild) {
          wordInsertedNodes.push(wordContainer.firstChild);
          wordFragment.appendChild(wordContainer.firstChild);
        }
      } else if (plainText) {
        var wordTextNode = doc.createTextNode(plainText);
        wordInsertedNodes.push(wordTextNode);
        wordFragment.appendChild(wordTextNode);
      }

      if (wordFragment.childNodes.length > 0) {
        range.insertNode(wordFragment);
        notifyWordInputEvents(
          doc,
          wordRoot,
          html ? "insertHTML" : "insertText",
          html || plainText
        );
        if (wordInsertedNodes.length > 0) {
          placeCaretAtEndOfInsertedNodes(doc, wordInsertedNodes);
        }
        return true;
      }

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

    var activeElement =
      activeExpansionContext &&
      activeExpansionContext.doc === doc &&
      activeExpansionContext.root &&
      isTextControl(activeExpansionContext.root)
        ? activeExpansionContext.root
        : doc.activeElement;
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

    var shortcutRange =
      activeExpansionContext &&
      activeExpansionContext.doc === doc &&
      activeExpansionContext.root &&
      !isTextControl(activeExpansionContext.root)
        ? findRangeByTextSearch(doc, activeExpansionContext.root, expectedText)
        : null;
    if (!shortcutRange) {
      shortcutRange = createShortcutRange(doc, expectedText);
    }
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

  function getCompletionInsertionText(event) {
    if (!event) {
      return "";
    }

    if (event.key === " " || event.code === "Space") {
      return " ";
    }

    if (event.key === "Enter") {
      return "\n";
    }

    return typeof event.key === "string" && event.key.length === 1 ? event.key : "";
  }

  function flushWordOnlineShadowBuffer(doc, suffix) {
    if (!buffer) {
      return false;
    }

    var literalText = buffer + (suffix || "");
    buffer = "";
    hideWordOnlineCommandOverlay();
    return literalText ? insertWordOnlineBufferedText(doc, literalText) : true;
  }

  function findWordOnlineShadowTemplate(activeBuffer) {
    var shortcut = String(activeBuffer || "").slice(1).toLowerCase();
    if (!shortcut) {
      return null;
    }

    return templateCache[shortcut] || null;
  }

  function hasLongerShortcutWithPrefix(shortcut) {
    var prefix = String(shortcut || "").toLowerCase();
    var keys = Object.keys(templateCache || {});

    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].length > prefix.length && keys[i].indexOf(prefix) === 0) {
        return true;
      }
    }

    return false;
  }

  function expandWordOnlineShadowTemplate(doc, activeBuffer, template) {
    if (!template || typeof template.content !== "string") {
      return false;
    }

    var normalizedWordHtml = normalizeTemplateHtml(doc, template.content);
    var plainText = stripHtml(template.content);

    expandWordOnlineWithNativeInput(
      doc,
      activeBuffer,
      normalizedWordHtml,
      plainText
    ).then(function(expanded) {
      if (expanded) {
        notifyTemplateUsed(template);
        return;
      }

      return fallbackWordOnlineLegacyExpansion(
        doc,
        activeBuffer,
        normalizedWordHtml,
        plainText
      ).then(function(fallbackExpanded) {
        if (fallbackExpanded) {
          notifyTemplateUsed(template);
        }
      });
    }).catch(function(error) {
      textExpanderWarn("Word Online expansion pipeline failed.", {
        shortcut: activeBuffer,
        error: getErrorMessage(error),
      });
    });

    return true;
  }

  function handleWordOnlineKeydown(event, eventDoc) {
    if (!isWordOnlineDocument(eventDoc)) {
      return false;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      if (buffer) {
        flushWordOnlineShadowBuffer(eventDoc, "");
      }
      return false;
    }

    if (event.key === triggerChar) {
      preventHostCompletionEvent(event);
      buffer = triggerChar;
      showWordOnlineCommandOverlay(eventDoc, buffer);
      logWordDecision(eventDoc, "word-shadow-trigger-char", {
        key: event.key,
        code: event.code || "",
        strategy: "precommit-buffer",
      });
      return true;
    }

    if (!buffer) {
      return false;
    }

    if (event.key === "Backspace") {
      preventHostCompletionEvent(event);
      buffer = buffer.length > 1 ? buffer.slice(0, -1) : "";
      if (buffer) {
        showWordOnlineCommandOverlay(eventDoc, buffer);
      } else {
        hideWordOnlineCommandOverlay();
      }
      logWordDecision(eventDoc, "word-precommit-backspace", {
        buffer: buffer,
      });
      return true;
    }

    if (event.key === "Escape") {
      preventHostCompletionEvent(event);
      buffer = "";
      hideWordOnlineCommandOverlay();
      logWordDecision(eventDoc, "word-precommit-cancel", {});
      return true;
    }

    if (isShortcutChar(event.key)) {
      preventHostCompletionEvent(event);
      buffer += event.key;
      showWordOnlineCommandOverlay(eventDoc, buffer);
      logWordDecision(eventDoc, "word-precommit-buffer-char", {
        key: event.key,
        code: event.code || "",
        buffer: buffer,
      });

      var activeShortcut = buffer.slice(1).toLowerCase();
      var exactTemplate = findWordOnlineShadowTemplate(buffer);
      if (exactTemplate && !hasLongerShortcutWithPrefix(activeShortcut)) {
        var activeBuffer = buffer;
        buffer = "";
        hideWordOnlineCommandOverlay();
        logWordDecision(eventDoc, "word-shadow-exact-shortcut", {
          activeBuffer: activeBuffer,
        });
        expandWordOnlineShadowTemplate(eventDoc, activeBuffer, exactTemplate);
      }

      return true;
    }

    if (isCompletionKey(event)) {
      var activeBuffer = buffer;
      buffer = "";
      hideWordOnlineCommandOverlay();
      preventHostCompletionEvent(event);
      logWordDecision(eventDoc, "word-shadow-completion-key", {
        key: event.key,
        code: event.code || "",
        activeBuffer: activeBuffer,
      });

      if (!handleCompletionKey(event, activeBuffer, eventDoc)) {
        var exactTemplate = findWordOnlineShadowTemplate(activeBuffer);
        if (exactTemplate) {
          expandWordOnlineShadowTemplate(eventDoc, activeBuffer, exactTemplate);
        } else {
          insertWordOnlineBufferedText(eventDoc, activeBuffer + getCompletionInsertionText(event));
        }
      }

      return true;
    }

    if (typeof event.key === "string" && event.key.length === 1) {
      preventHostCompletionEvent(event);
      var literalBuffer = buffer + event.key;
      buffer = "";
      hideWordOnlineCommandOverlay();
      insertWordOnlineBufferedText(eventDoc, literalBuffer);
      return true;
    }

    flushWordOnlineShadowBuffer(eventDoc, "");
    return false;
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
    var contextElement =
      activeExpansionContext &&
      activeExpansionContext.doc === targetDoc &&
      activeExpansionContext.root &&
      isTextControl(activeExpansionContext.root)
        ? activeExpansionContext.root
        : null;
    var activeElement = contextElement || targetDoc.activeElement;
    var isWordOnline = isWordOnlineDocument(targetDoc);
    var canAttemptRichPaste =
      canUseRichPaste(targetDoc, template.content) &&
      !isTextControl(activeElement) &&
      !shouldAvoidSyntheticRichPaste(targetDoc);
    var shortcutRange = null;

    logWordDecision(targetDoc, "completion-key-received", {
      activeBuffer: activeBuffer,
      activeTag: activeElement && activeElement.tagName,
      activeContenteditable:
        !!(activeElement && activeElement.getAttribute && activeElement.getAttribute("contenteditable") === "true"),
      isTextControl: isTextControl(activeElement),
      canUseRichPaste: canUseRichPaste(targetDoc, template.content),
      avoidSyntheticRichPaste: shouldAvoidSyntheticRichPaste(targetDoc),
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

    if (isWordOnline) {
      var normalizedWordHtml = normalizeTemplateHtml(targetDoc, template.content);
      preventHostCompletionEvent(event);
      logWordDecision(targetDoc, "completion-key-word-shadow-path", {
        activeBuffer: activeBuffer,
        activeTag: activeElement && activeElement.tagName,
        replacementPreview: shortText(plainText, 160),
      });

      expandWordOnlineWithNativeInput(
        targetDoc,
        activeBuffer,
        normalizedWordHtml,
        plainText
      ).then(function(expanded) {
        if (expanded) {
          notifyTemplateUsed(template);
          return;
        }

        return fallbackWordOnlineLegacyExpansion(
          targetDoc,
          activeBuffer,
          normalizedWordHtml,
          plainText
        ).then(function(fallbackExpanded) {
          if (fallbackExpanded) {
            notifyTemplateUsed(template);
          }
        });
      }).catch(function(error) {
        textExpanderWarn("Word Online expansion pipeline failed.", {
          shortcut: activeBuffer,
          error: getErrorMessage(error),
        });
      });

      return true;
    }

    if (canAttemptRichPaste) {
      shortcutRange =
        activeExpansionContext &&
        activeExpansionContext.doc === targetDoc &&
        activeExpansionContext.root &&
        !isTextControl(activeExpansionContext.root)
          ? findRangeByTextSearch(targetDoc, activeExpansionContext.root, activeBuffer)
          : null;
      if (!shortcutRange) {
        shortcutRange = createShortcutRange(targetDoc, activeBuffer);
      }
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
    hideWordOnlineCommandOverlay: hideWordOnlineCommandOverlay,
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
    var eventContext = getEventEditorContext(event, eventDoc);

    if (handleWordOnlineKeydown(event, eventDoc)) {
      return;
    }

    if (event.key === triggerChar) {
      logWordDecision(eventDoc, "keydown-trigger-char", {
        key: event.key,
        code: event.code || "",
      });
      buffer = triggerChar;
      bufferContext = eventContext;
      return;
    }

    if (!buffer) {
      return;
    }

    if (!sameEditorContext(bufferContext, eventContext)) {
      buffer = "";
      bufferContext = null;
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
      var completionContext = bufferContext;
      buffer = "";
      bufferContext = null;
      logWordDecision(eventDoc, "keydown-completion-key", {
        key: event.key,
        code: event.code || "",
        activeBuffer: activeBuffer,
      });
      activeExpansionContext = completionContext;
      try {
        handleCompletionKey(event, activeBuffer, eventDoc);
      } finally {
        activeExpansionContext = null;
      }
      return;
    }

    logWordDecision(eventDoc, "keydown-buffer-reset", {
      key: event.key,
      code: event.code || "",
      buffer: buffer,
    });
    buffer = "";
    bufferContext = null;
  }, true);

  loadSettings();
  scheduleTemplateReload("startup");
})(typeof globalThis !== "undefined" ? globalThis : this);
