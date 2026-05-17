(function(global) {
  "use strict";

  var DEFAULT_FONT_FAMILY = "Arial, sans-serif";
  var DEFAULT_FONT_SIZE = "11pt";
  var DEFAULT_COLOR = "#1a1a1a";
  var FONT_SIZE_VALUES = [
    "8pt",
    "9pt",
    "10pt",
    "11pt",
    "12pt",
    "14pt",
    "16pt",
    "18pt",
    "20pt",
    "24pt",
    "28pt",
    "32pt",
    "36pt",
    "48pt",
    "72pt",
  ];
  var QL_SIZE_MAP = {
    "ql-size-small": "10pt",
    "ql-size-large": "18pt",
    "ql-size-huge": "24pt",
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  function stripHtml(html) {
    var doc = global.document;
    if (!doc) return String(html || "");
    var container = doc.createElement("div");
    container.innerHTML = html || "";
    return (container.textContent || container.innerText || "").trim();
  }

  function normalizeFontSize(value) {
    var raw = String(value || "").trim().toLowerCase();
    var match = raw.match(/^(\d+(?:[.,]\d+)?)(pt|px)?$/);
    var numberValue;

    if (!match) {
      return "";
    }

    numberValue = parseFloat(match[1].replace(",", "."));
    if (!isFinite(numberValue) || numberValue < 1 || numberValue > 200) {
      return "";
    }

    if (match[2] === "px") {
      numberValue = numberValue * 72 / 96;
    }

    return String(Math.round(numberValue * 10) / 10).replace(/\.0$/, "") + "pt";
  }

  function cloneStyle(style) {
    var copy = {};
    var key;
    for (key in style) {
      if (Object.prototype.hasOwnProperty.call(style, key)) {
        copy[key] = style[key];
      }
    }
    return copy;
  }

  function parseInlineStyle(styleText) {
    var style = {};
    String(styleText || "").split(";").forEach(function(part) {
      var separator = part.indexOf(":");
      var name;
      var value;

      if (separator === -1) return;

      name = part.slice(0, separator).trim().toLowerCase();
      value = part.slice(separator + 1).trim();

      if (!value) return;

      if (name === "font-size") {
        value = normalizeFontSize(value);
        if (value) style["font-size"] = value;
      } else if (name === "font-family") {
        style["font-family"] = value;
      } else if (name === "color") {
        style.color = value;
      } else if (name === "background-color" || name === "background") {
        style["background-color"] = value;
      } else if (name === "text-align") {
        style["text-align"] = value;
      } else if (name === "font-weight") {
        style["font-weight"] = value;
      } else if (name === "font-style") {
        style["font-style"] = value;
      } else if (name === "text-decoration" || name === "text-decoration-line") {
        style["text-decoration"] = value;
      }
    });
    return style;
  }

  function mergeTextDecoration(existing, value) {
    if (!existing) return value;
    if (existing.indexOf(value) !== -1) return existing;
    return existing + " " + value;
  }

  function styleFromClasses(node) {
    var style = {};
    var classes = String(node.className || "").split(/\s+/);

    classes.forEach(function(className) {
      if (QL_SIZE_MAP[className]) {
        style["font-size"] = QL_SIZE_MAP[className];
      } else if (className.indexOf("ql-align-") === 0) {
        style["text-align"] = className.replace("ql-align-", "");
      }
    });

    return style;
  }

  function styleForNode(node, inheritedStyle, tagName) {
    var style = cloneStyle(inheritedStyle || {});
    var classStyle = styleFromClasses(node);
    var inlineStyle = parseInlineStyle(node.getAttribute("style") || "");
    var key;

    for (key in classStyle) {
      style[key] = classStyle[key];
    }
    for (key in inlineStyle) {
      style[key] = inlineStyle[key];
    }

    if (tagName === "strong" || tagName === "b") {
      style["font-weight"] = "bold";
    }
    if (tagName === "em" || tagName === "i") {
      style["font-style"] = "italic";
    }
    if (tagName === "u") {
      style["text-decoration"] = mergeTextDecoration(style["text-decoration"], "underline");
    }
    if (tagName === "s" || tagName === "strike") {
      style["text-decoration"] = mergeTextDecoration(style["text-decoration"], "line-through");
    }

    if (!style["font-family"]) style["font-family"] = DEFAULT_FONT_FAMILY;
    if (!style["font-size"]) style["font-size"] = DEFAULT_FONT_SIZE;
    if (!style.color) style.color = DEFAULT_COLOR;

    return style;
  }

  function styleToAttribute(style, extra) {
    var ordered = [
      "font-size",
      "font-family",
      "color",
      "background-color",
      "font-weight",
      "font-style",
      "text-decoration",
      "text-align",
      "margin",
      "padding-left",
    ];
    var parts = [];
    var included = {};

    if (extra) {
      Object.keys(extra).forEach(function(key) {
        style[key] = extra[key];
      });
    }

    ordered.forEach(function(key) {
      if (style[key]) {
        included[key] = true;
        parts.push(key + ":" + style[key]);
      }
    });

    Object.keys(style).forEach(function(key) {
      if (!included[key] && style[key]) {
        parts.push(key + ":" + style[key]);
      }
    });

    return ' style="' + escapeAttribute(parts.join("; ") + ";") + '"';
  }

  function normalizeChildren(node, inheritedStyle) {
    var html = "";
    var children = node.childNodes || [];
    var i;

    for (i = 0; i < children.length; i += 1) {
      html += normalizeNode(children[i], inheritedStyle, false);
    }

    return html;
  }

  function normalizeList(node, tagName, inheritedStyle) {
    var style = styleForNode(node, inheritedStyle, tagName);
    var html = "";
    var children = node.childNodes || [];
    var i;

    for (i = 0; i < children.length; i += 1) {
      if (children[i] && children[i].nodeType === 1) {
        html += normalizeNode(children[i], style, false);
      }
    }

    return html ? "<" + tagName + styleToAttribute(style, { margin: "0 0 8pt 18pt" }) + ">" + html + "</" + tagName + ">" : "";
  }

  function normalizeNode(node, inheritedStyle, isTopLevel) {
    var tagName;
    var style;
    var content;
    var href;

    if (!node) return "";

    if (node.nodeType === 3) {
      return escapeHtml(node.nodeValue || "");
    }

    if (node.nodeType !== 1) {
      return "";
    }

    tagName = String(node.tagName || "").toLowerCase();

    if (tagName === "br") {
      return "<br>";
    }

    if (tagName === "ul" || tagName === "ol") {
      return normalizeList(node, tagName, inheritedStyle);
    }

    if (tagName === "li") {
      style = styleForNode(node, inheritedStyle, tagName);
      content = normalizeChildren(node, style);
      return content ? "<li" + styleToAttribute(style) + ">" + content + "</li>" : "";
    }

    if (tagName === "p" || tagName === "div") {
      style = styleForNode(node, inheritedStyle, tagName);
      content = normalizeChildren(node, style);
      if (!content) return "";
      return "<p" + styleToAttribute(style, { margin: "0 0 8pt 0" }) + ">" + content + "</p>";
    }

    if (tagName === "strong" || tagName === "b") tagName = "strong";
    else if (tagName === "em" || tagName === "i") tagName = "em";
    else if (tagName === "s" || tagName === "strike") tagName = "span";
    else if (tagName !== "span" && tagName !== "u" && tagName !== "a") tagName = "span";

    style = styleForNode(node, inheritedStyle, tagName);
    content = normalizeChildren(node, style);
    if (!content) return "";

    if (tagName === "a") {
      href = node.getAttribute("href") || "";
      return href
        ? '<a href="' + escapeAttribute(href) + '"' + styleToAttribute(style) + ">" + content + "</a>"
        : "<span" + styleToAttribute(style) + ">" + content + "</span>";
    }

    return "<" + tagName + styleToAttribute(style) + ">" + content + "</" + tagName + ">";
  }

  function prepareHtmlFragment(html, doc) {
    var ownerDocument = doc || global.document;
    var template = ownerDocument.createElement("template");
    var baseStyle = {
      "font-family": DEFAULT_FONT_FAMILY,
      "font-size": DEFAULT_FONT_SIZE,
      color: DEFAULT_COLOR,
    };
    var output = "";
    var children;
    var i;

    template.innerHTML = html || "";
    children = template.content.childNodes || [];

    for (i = 0; i < children.length; i += 1) {
      output += normalizeNode(children[i], baseStyle, true);
    }

    if (!output && html) {
      output = "<p" + styleToAttribute(baseStyle, { margin: "0 0 8pt 0" }) + ">" + escapeHtml(stripHtml(html)) + "</p>";
    }

    return output;
  }

  function buildOfficeHtml(html, doc) {
    var bodyHtml = prepareHtmlFragment(html, doc);
    return [
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"',
      ' xmlns:w="urn:schemas-microsoft-com:office:word"',
      ' xmlns="http://www.w3.org/TR/REC-html40">',
      '<head><meta charset="utf-8"></head>',
      "<body>",
      bodyHtml,
      "</body></html>",
    ].join("");
  }

  function copyWithEventFallback(officeHtml, plainText, doc) {
    var ownerDocument = doc || global.document;
    var selection = ownerDocument.getSelection ? ownerDocument.getSelection() : null;
    var previousRanges = [];
    var host = ownerDocument.createElement("div");
    var range;
    var copied = false;
    var copyHandler = function(event) {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/html", officeHtml);
      event.clipboardData.setData("text/plain", plainText);
      copied = true;
    };

    if (selection) {
      for (var i = 0; i < selection.rangeCount; i += 1) {
        previousRanges.push(selection.getRangeAt(i).cloneRange());
      }
    }

    host.setAttribute("contenteditable", "true");
    host.style.position = "fixed";
    host.style.left = "-9999px";
    host.style.top = "0";
    host.innerHTML = officeHtml;
    ownerDocument.body.appendChild(host);

    try {
      range = ownerDocument.createRange();
      range.selectNodeContents(host);
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }

      ownerDocument.addEventListener("copy", copyHandler, true);
      copied = ownerDocument.execCommand && ownerDocument.execCommand("copy") === true;
    } finally {
      ownerDocument.removeEventListener("copy", copyHandler, true);
      host.remove();

      if (selection) {
        selection.removeAllRanges();
        previousRanges.forEach(function(savedRange) {
          selection.addRange(savedRange);
        });
      }
    }

    return copied;
  }

  async function copyRichText(html, plainText, options) {
    var settings = options || {};
    var doc = settings.document || global.document;
    var nav = settings.navigator || global.navigator;
    var ClipboardItemCtor = settings.ClipboardItem || global.ClipboardItem;
    var BlobCtor = settings.Blob || global.Blob;
    var text = plainText || stripHtml(html);
    var officeHtml = buildOfficeHtml(html, doc);

    if (
      nav &&
      nav.clipboard &&
      typeof nav.clipboard.write === "function" &&
      typeof ClipboardItemCtor === "function" &&
      typeof BlobCtor === "function"
    ) {
      try {
        await nav.clipboard.write([
          new ClipboardItemCtor({
            "text/html": new BlobCtor([officeHtml], { type: "text/html" }),
            "text/plain": new BlobCtor([text], { type: "text/plain" }),
          }),
        ]);
        return { mode: "rich", html: officeHtml, plainText: text };
      } catch (error) {}
    }

    if (doc && doc.addEventListener && copyWithEventFallback(officeHtml, text, doc)) {
      return { mode: "fallback", html: officeHtml, plainText: text };
    }

    throw new Error("Clipboard rico indisponivel");
  }

  function registerQuillFontSize(QuillCtor) {
    var SizeStyle;

    if (!QuillCtor || typeof QuillCtor.import !== "function" || typeof QuillCtor.register !== "function") {
      return false;
    }

    SizeStyle = QuillCtor.import("attributors/style/size");
    if (!SizeStyle) return false;

    SizeStyle.whitelist = FONT_SIZE_VALUES.slice();
    QuillCtor.register(SizeStyle, true);
    return true;
  }

  function ensureQuillFontSizeValue(QuillCtor, value) {
    var normalized = normalizeFontSize(value);
    var SizeStyle;

    if (!normalized || !QuillCtor || typeof QuillCtor.import !== "function") {
      return normalized;
    }

    SizeStyle = QuillCtor.import("attributors/style/size");
    if (SizeStyle && Array.isArray(SizeStyle.whitelist) && SizeStyle.whitelist.indexOf(normalized) === -1) {
      SizeStyle.whitelist.push(normalized);
    }

    return normalized;
  }

  global.MinutarioRichClipboard = {
    FONT_SIZE_VALUES: FONT_SIZE_VALUES.slice(),
    buildOfficeHtml: buildOfficeHtml,
    copyRichText: copyRichText,
    ensureQuillFontSizeValue: ensureQuillFontSizeValue,
    normalizeFontSize: normalizeFontSize,
    prepareHtmlFragment: prepareHtmlFragment,
    registerQuillFontSize: registerQuillFontSize,
    stripHtml: stripHtml,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.MinutarioRichClipboard;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
