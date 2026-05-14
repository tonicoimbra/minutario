# AGENTS.md

## Quick Commands

```bash
npm test                                  # all 12 test files via node:test + jsdom
node --test tests/content.test.js         # single test file
npm run check                             # syntax-check all JS files (10 files)
npm run pack:chrome                       # build Chrome zip in dist/chrome
npm run pack:firefox                      # build Firefox package in dist/firefox
npm run sign:firefox                      # pack Firefox + sign .xpi via AMO API
npm run release:pilot                     # test + check + pack Chrome + pack Firefox
npm run release:pilot:full:patch          # bump patch version + release:pilot
```

## Project Type

Chrome Extension (Manifest V3). **No build step** — all JS is vanilla ES5/ES2017, loaded directly by Chrome. No bundler, no TypeScript. `package.json` is `"type": "commonjs"`.

## Loading in Chrome

`chrome://extensions` → Developer mode → Load unpacked → select this directory.

Required: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` must exist.

## Architecture

| File / Dir | Role |
|---|---|
| `manifest.json` | MV3 manifest — content_scripts, permissions, keyboard commands |
| `background.js` | Service worker (message router); loads shared modules via `importScripts()` |
| `content.js` | Injected into all pages — keydown listener, template expansion (~3500 lines) |
| `shared/browser-compat.js` | Firefox polyfill — aliases `browser` → `chrome` if present |
| `shared/config.js` | `MinutarioConfig` global — Supabase URL/key, DB name/version |
| `shared/db.js` | `MinutarioDB` global — IndexedDB CRUD for templates/folders |
| `shared/api.js` | `MinutarioAPI` global — Supabase CRUD; camelCase↔snake_case normalization |
| `shared/sync.js` | `MinutarioSync` global — bidirectional merge (local IndexedDB ↔ remote Supabase) |
| `popup/` | Toolbar popup |
| `quick-access/` | Quick-access panel (Ctrl+Shift+K / Cmd+Shift+K) |
| `dashboard/` | Full-page CRUD UI |
| `dashboard/sync/*.js` | Sync modules (CSV, Supabase) |
| `firefox/` | Firefox-specific copies of content/background/popup/etc. with Manifest V2 shim |
| `supabase/schema.sql` | Canonical Supabase schema |
| `supabase/reset.sql` | DROP + recreate script for wiping DB |
| `lib/` | Bundled third-party libs (Quill, PapaParse, Supabase client) — must work offline |

### Content script injection order

`manifest.json` injects in this exact order:
```
shared/browser-compat.js → shared/config.js → shared/db.js → shared/api.js → shared/sync.js → content.js
```
Each module after `browser-compat.js` reads `global.MinutarioConfig` set by the previous one.

### Firefox variant

`firefox/` contains adapted copies of background.js, content.js, popup, dashboard, etc. Changes to the Chrome files must be mirrored to the Firefox equivalents when relevant.

## Testing

- Uses `node:test` + **jsdom** (no browser required). 12 test files in `tests/`.
- Each test bootstraps a JSDOM, injects JS via `window.eval`, and exercises exported APIs.
- `content.js` exports `MacroBlazeContent` on `global` (and `module.exports`) for test compatibility — **keep this internal name even though the product is Minutário**.
- **jsdom tests do NOT simulate Word Online's MutationObserver behavior** — passing tests do not guarantee the Word Online expansion fix works in production. Always manually verify in Word Online and Google Docs after changing `content.js` paste/expansion logic.

## Key Constraints

- **`shared/config.js` is gitignored** — real Supabase credentials live there; `shared/config.example.js` is the committed template. Note: `config.example.js` has `DB_VERSION: 1` but real config uses `2` — do not copy the example's DB_VERSION blindly.
- **Quota**: `chrome.storage.sync` max 8 KB per key, 100 KB total
- **MV3 service worker**: no persistent state beyond message handler; always `await migrationPromise` before responding in `background.js`
- **Shortcut rules**: must start with `triggerChar` (default `/`), contain only `[a-zA-Z0-9-]`
- **Quill is bundled** (`lib/`) — do not load from CDN; extension must work offline
- **Clipboard API** in popup requires `clipboardWrite` permission and secure context

## Data Model

- **Isolation**: Per-user (`user_id`), not per-organization
- **Primary storage**: IndexedDB (`MinutarioDB`, version 2) — `templates` and `folders` object stores, both keyed by UUID and indexed on `user_id`
- **Secondary storage**: `chrome.storage.sync` holds `settings` (triggerChar, triggerKey); `chrome.storage.local` holds `storageVersion` and `recent` (up to 3 template IDs)
- **Sync key**: `minutario_user_id` in `chrome.storage.local`

## Supabase

- Schema canonical source: `supabase/schema.sql`
- Tables: `templates`, `folders` — both have `user_id` column and `ON DELETE CASCADE`
- `plain_text` column is `NOT NULL`
- `shared/api.js` strips extra camelCase fields before sending to PostgREST to avoid rejection

## Language

Respond in Brazilian Portuguese (pt-BR) per user preference.
