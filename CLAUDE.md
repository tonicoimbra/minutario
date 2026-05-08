# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

**Minutário** — a Chrome extension (Manifest V3) developed by **Elvertoni Coimbra** for text expansion / macros anywhere in the browser. Users type a shortcut like `/contrato` followed by Space and the extension replaces it with rich HTML content in any text field, textarea, or contenteditable element.

## Running Tests

```bash
npm test                          # runs all tests via node:test
node --test tests/*.test.js       # equivalent
node --test tests/content.test.js # run single test file
```

Tests use **jsdom** (no browser required). Each test bootstraps a real DOM, injects the relevant JS files via `window.eval`, and exercises the exported APIs.

To syntax-check JS files without running them:
```bash
node --check background.js content.js popup/popup.js dashboard/dashboard.js dashboard/sync/*.js shared/*.js quick-access/quick-access.js
```

## Loading in Chrome

`chrome://extensions` → Enable Developer mode → Load unpacked → select this directory.

Required: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` must exist (referenced in `manifest.json`).

## Architecture

### Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — permissions, host_permissions, content_scripts, keyboard commands |
| `background.js` | Service worker — message router + IndexedDB migration system |
| `content.js` | Injected into all pages — keydown listener, template expansion |
| `shared/config.js` | `MinutarioConfig` global — Supabase URL/key, DB name/version, sync interval |
| `shared/config.example.js` | Template for `shared/config.js` — copy and fill in credentials |
| `shared/db.js` | `MinutarioDB` global — IndexedDB open/CRUD for templates and folders |
| `shared/api.js` | `MinutarioAPI` global — Supabase CRUD; handles camelCase↔snake_case normalization |
| `shared/sync.js` | `MinutarioSync` global — bidirectional merge logic (local IndexedDB ↔ remote Supabase) |
| `popup/popup.{html,js,css}` | Toolbar popup — opens dashboard, shows 3 recent templates |
| `quick-access/quick-access.{html,js,css}` | Quick-access panel (Ctrl+Shift+K / Cmd+Shift+K) — search, preview, copy templates |
| `dashboard/dashboard.{html,js,css}` | Full-page CRUD UI — template management, folders, search |
| `dashboard/sync/csv.js` | CSV parser + importer module |
| `dashboard/sync/supabase.js` | Supabase auth + dashboard-level push/pull sync |
| `dashboard/sync/index.js` | SyncManager facade — orchestrates all backends |
| `lib/quill.min.js` + `lib/quill.snow.css` | Quill 1.3.7 (bundled, no CDN) — rich-text editor in dashboard |
| `lib/papaparse.min.js` | PapaParse 5.4.1 (bundled) — CSV parser for import/export |
| `lib/supabase.min.js` | Supabase JS client (bundled) — cloud sync |
| `supabase/schema.sql` | Full Supabase schema (canonical source of truth) |
| `supabase/reset.sql` | DROP + recreate script for wiping Supabase DB from scratch |
| `icons/` | 16×16, 48×48, 128×128 PNGs |

### Content script injection order

`manifest.json` injects these files into every page in this order:

```
shared/config.js → shared/db.js → shared/api.js → shared/sync.js → content.js
```

Each shared module reads `global.MinutarioConfig` set by the previous one. `content.js` uses `MinutarioDB` and `MinutarioSync` directly for template lookups and sync.

### Storage layout

**Primary storage: IndexedDB** (`MinutarioDB`, version 2, managed by `shared/db.js`)
- `templates` object store — keyed by `id` (UUID), indexed on `shortcut` and `user_id`
- `folders` object store — keyed by `id` (UUID), indexed on `user_id`

**Secondary storage: `chrome.storage`**
- `chrome.storage.sync`: `settings` → `{ triggerChar, triggerKey }`
- `chrome.storage.local`: `storageVersion` (migration integer), `recent` (array of up to 3 template IDs)

### Configuration

Supabase credentials and DB config live in `shared/config.js` as `MinutarioConfig`. To set up a new environment, copy `shared/config.example.js` to `shared/config.js` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

### Message contract (background.js)

All messages follow `{ type, payload }` → `{ ok, data?, error? }`.

| type | payload | response |
|---|---|---|
| `OPEN_DASHBOARD` | `{ focusExisting? }` | `{ ok: true }` |
| `GET_TEMPLATES` | `{ folderId?, query? }` | `{ ok: true, data: Template[] }` |
| `UPDATE_RECENT` | `{ templateId }` | `{ ok: true }` |

### Sync Modules (dashboard)

Three backends available from the dashboard's import bar:

**CSV Import/Export**
- Format: `name,shortcut,folder,content` (columns are case-insensitive)
- Import: validates required columns, detects shortcut conflicts, asks before overwriting
- Export: downloads `minutario-templates.csv` with all templates + folder names

**Google Drive**
- Uses `chrome.identity` OAuth2 with `drive.file` scope
- Backup: uploads `minutario-backup.json` to user's Drive
- Restore: downloads and replaces local state
- Requires `oauth2.client_id` in `manifest.json` (replace placeholder before publishing)

**Supabase**
- Auth: email/password via Supabase Auth
- Sync: bidirectional merge — pushes local IndexedDB, pulls remote, keeps newest by `updated_at`
- `shared/api.js` (`MinutarioAPI`) handles all Supabase CRUD; `dashboard/sync/supabase.js` handles auth session for the dashboard

### Expansion flow (content.js)

1. `keydown` listener captures characters after the `triggerChar` (default `/`) into `buffer`.
2. On `triggerKey` (default `Space`): look up `buffer` (minus the prefix) in `templateCache`.
3. `expandTemplateAtSelection` → `normalizeTemplateHtml` (strips Quill classes/styles to safe subset) → `insertHtmlWithRange` (tries `execCommand("insertHTML")` first, falls back to manual DOM insertion with backwards text walk to locate and delete the shortcut).
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
- **`shared/config.js` is gitignored** — real credentials never committed; `shared/config.example.js` is the committed template.

## Reference Material

`refs/text blaze/` — downloaded Text Blaze assets for competitive analysis (not part of the extension build).

`docs/superpowers/specs/` — Minutário design spec (originally MacroBlaze; implementation reference).
