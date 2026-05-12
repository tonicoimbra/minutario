# AGENTS.md

## Quick Commands

```bash
npm test                                  # all tests via node:test + jsdom
node --test tests/content.test.js         # single test file
node --check background.js content.js     # syntax check (no tests)
npm run pack:chrome                       # build Chrome zip in dist/chrome
npm run sign:firefox                      # sign Firefox package (.xpi) via AMO API
npm run release:pilot:full:patch          # bump patch + test/check + pack Chrome/Firefox
```

## Loading in Chrome

`chrome://extensions` → Developer mode → Load unpacked → select this directory.

Required: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` must exist.

## Project Type

Chrome Extension (Manifest V3). **No build step** — all JS is vanilla ES5/ES2017, loaded directly by Chrome. No bundler, no TypeScript.

## Architecture

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — content_scripts, permissions, keyboard commands |
| `background.js` | Service worker (message router); loads shared modules via `importScripts()` |
| `content.js` | Injected into all pages — keydown listener, template expansion |
| `shared/config.js` | `MinutarioConfig` global — Supabase URL/key, DB name/version |
| `shared/db.js` | `MinutarioDB` global — IndexedDB CRUD for templates/folders |
| `shared/api.js` | `MinutarioAPI` global — Supabase CRUD; camelCase↔snake_case normalization |
| `shared/sync.js` | `MinutarioSync` global — bidirectional merge (local IndexedDB ↔ remote Supabase) |
| `popup/popup.*` | Toolbar popup |
| `quick-access/quick-access.*` | Quick-access panel (Ctrl+ShiftK / Cmd+Shift+K) |
| `dashboard/dashboard.*` | Full-page CRUD UI |
| `dashboard/sync/*.js` | Sync modules (CSV, Drive, Supabase) |
| `supabase/schema.sql` | Canonical Supabase schema |
| `supabase/reset.sql` | DROP + recreate script for wiping DB |

### Content script injection order

`manifest.json` injects in this exact order:
```
shared/config.js → shared/db.js → shared/api.js → shared/sync.js → content.js
```
Each module reads `global.MinutarioConfig` set by the previous one.

## Testing

- Uses `node:test` + **jsdom** (no browser required).
- Each test bootstraps a DOM, injects JS via `window.eval`, and exercises exported APIs.
- `content.js` exports `MacroBlazeContent` on `global` (and `module.exports`) for test compatibility — **keep this internal name even though the product is Minutário**.
- **jsdom tests do NOT simulate Word Online's MutationObserver behavior** — passing tests do not guarantee the Word Online expansion fix works in production. Always manually verify in Word Online and Google Docs after changing `content.js` paste/expansion logic.

## Key Constraints

- **Quota**: `chrome.storage.sync` max 8 KB per key, 100 KB total
- **MV3 service worker**: no persistent state beyond message handler; always await `migrationPromise` before responding in `background.js`
- **Shortcut rules**: must start with `triggerChar` (default `/`), contain only `[a-zA-Z0-9-]`
- **Quill is bundled** (`lib/`) — do not load from CDN; extension must work offline
- **Clipboard API** in popup requires `clipboardWrite` permission and secure context
- **`shared/config.js` is gitignored** — real Supabase credentials live there; `shared/config.example.js` is the committed template

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
