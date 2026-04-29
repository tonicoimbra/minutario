# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

**Minutário** — a Chrome extension (Manifest V3) developed by **Elvertoni Coimbra** for text expansion / macros in Word Online (office.com). Users type a shortcut like `/contrato` followed by Space and the extension replaces it with rich HTML content.

## Running Tests

```bash
npm test                   # runs all tests via node:test
node --test tests/*.test.js  # equivalent
```

Tests use **jsdom** (no browser required). Each test bootstraps a real DOM, injects `content.js` via `window.eval`, and exercises the exported `MacroBlazeContent` API.

To syntax-check JS files without running them:
```bash
node --check background.js content.js popup/popup.js dashboard/dashboard.js
```

## Loading in Chrome

`chrome://extensions` → Enable Developer mode → Load unpacked → select this directory.

Required: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` must exist (referenced in `manifest.json`).

The extension only injects into `https://word.live.com/*` and `https://*.officeapps.live.com/*`.

## Architecture

### Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — permissions, host_permissions, content_scripts |
| `background.js` | Service worker — message router + storage migration |
| `content.js` | Injected into Word Online — keydown listener, template expansion |
| `popup/popup.{html,js,css}` | Toolbar popup — opens dashboard, shows 3 recent templates |
| `dashboard/dashboard.{html,js,css}` | Full-page CRUD UI — template management, folders, search |
| `lib/quill.min.js` + `lib/quill.snow.css` | Quill 1.3.7 (bundled, no CDN) — rich-text editor in dashboard |
| `icons/` | 16×16, 48×48, 128×128 PNGs |

### Storage layout (`chrome.storage.sync`)

- One key per template: `tpl_<id>` → `{ id, name, shortcut, content (HTML), folderId?, createdAt, updatedAt }`
- `settings` key → `{ triggerChar, triggerKey }`
- `storageVersion` key (in `chrome.storage.local`) → migration version integer
- `recent` key (in `chrome.storage.local`) → array of up to 3 template IDs

### Message contract (background.js)

All messages follow `{ type, payload }` → `{ ok, data?, error? }`.

| type | payload | response |
|---|---|---|
| `OPEN_DASHBOARD` | `{ focusExisting? }` | `{ ok: true }` |
| `GET_TEMPLATES` | `{ folderId?, query? }` | `{ ok: true, data: Template[] }` |
| `UPDATE_RECENT` | `{ templateId }` | `{ ok: true }` |

### Expansion flow (content.js)

1. `keydown` listener captures characters after the `triggerChar` (default `/`) into `buffer`.
2. On `triggerKey` (default `Space`): look up `buffer` (minus the prefix) in `templateCache`.
3. `expandTemplateAtSelection` → `normalizeTemplateHtml` (strips Quill classes/styles to safe subset) → `insertHtmlWithRange` (tries `execCommand("insertHTML")` first, falls back to manual DOM insertion).
4. Sends `UPDATE_RECENT` to background.

`content.js` exports `MacroBlazeContent` on `global` and also via `module.exports` so the same file runs in both Chrome and jsdom tests. Keep this internal API name for compatibility even though the visible extension name is Minutário.

### Publication metadata

`manifest.json` uses `"author": "Elvertoni Coimbra"` for the local/MVP build. When publishing a CRX, Chrome Web Store may require this value to match the publisher account email.

## Key Constraints

- **No build step** — all JS is vanilla ES5/ES2017, loaded directly by Chrome. No bundler, no TypeScript.
- **Quill is bundled** (`lib/`) — do not load from CDN; the extension must work offline.
- **MV3 service worker** — `background.js` has no persistent state beyond the message handler; always await `migrationPromise` before responding.
- **Clipboard API** — popup uses `navigator.clipboard.write` with `ClipboardItem`; requires `clipboardWrite` permission and a secure context.
- **Shortcut rules**: must start with `triggerChar`, contain only `[a-zA-Z0-9-]`, be unique across all templates.
- **Quota**: `chrome.storage.sync` max 8 KB per key, 100 KB total — dashboard enforces this before saving.

## Reference Material

`refs/text blaze/` — downloaded Text Blaze assets for competitive analysis (not part of the extension build).

`docs/superpowers/specs/` — Minutário design spec (originally MacroBlaze; implementation reference).
