# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

**Minutário** — a Chrome extension (Manifest V3) developed by **Elvertoni Coimbra** for text expansion / macros anywhere in the browser. Users type a shortcut like `/contrato` followed by Space and the extension replaces it with rich HTML content in any text field, textarea, or contenteditable element.

## Commands

```bash
npm test                          # runs all tests via node:test
node --test tests/*.test.js       # equivalent
node --test tests/content.test.js # run single test file
npm run check                     # syntax-check all JS files (no execution)
npm run pack:chrome               # dist/chrome/minutario-chrome-vX.Y.Z.zip
npm run pack:firefox              # dist/firefox/minutario-firefox-vX.Y.Z.zip
npm run sign:firefox              # pack + sign via web-ext (needs AMO_JWT_ISSUER, AMO_JWT_SECRET)
npm run version:bump:patch        # bump patch version in manifest.json
npm run release:pilot             # test + check + pack:chrome + pack:firefox
npm run release:pilot:full:patch  # bump:patch + release:pilot
```

Tests use **jsdom** (no browser required). Each test bootstraps a real DOM, injects the relevant JS files via `window.eval`, and exercises the exported APIs.

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
| `shared/browser-compat.js` | Firefox compat shim — polyfills `window.browser` → `window.chrome` for content scripts |
| `password-reset/password-reset.{html,js}` | Supabase auth recovery page — exchanges recovery token from URL hash |
| `dashboard/sw.js` | Dashboard service worker — offline caching |
| `scripts/pack-chrome.ps1` | Stages files and creates Chrome distribution zip |
| `scripts/pack-firefox.ps1` | Stages files and creates Firefox distribution zip |
| `scripts/bump-version.js` | Updates version in `manifest.json` (patch/minor/major) |
| `firefox/` | Full Firefox port (Manifest V2) — mirrors all source files with `browser.*` namespace |

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

Notable options beyond the required credentials:
- `DEBUG_LOGS: false` — set `true` to enable `[MinutarioSync]`, `[MinutarioAPI]`, `[Minutário]` console output
- `PASSWORD_RESET_REDIRECT_URL` — must be registered in Supabase → Authentication → URL Configuration; defaults to `chrome.runtime.getURL("password-reset/password-reset.html")`

### Message contract (background.js)

All messages follow `{ type, payload }` → `{ ok, data?, error? }`.

| type | payload | response |
|---|---|---|
| `OPEN_DASHBOARD` | `{ focusExisting? }` | `{ ok: true }` |
| `GET_TEMPLATES` | `{ folderId?, query? }` | `{ ok: true, data: Template[] }` |
| `UPDATE_RECENT` | `{ templateId }` | `{ ok: true }` |
| `GET_FOLDERS` | `{}` | `{ ok: true, data: Folder[] }` |
| `GET_RECENT` | `{}` | `{ ok: true, data: Template[] }` |
| `FORCE_SYNC` | `{}` | `{ ok: true, data: { updated?, count?, error? } }` |
| `OPEN_QUICK_ACCESS` | `{}` | `{ ok: true }` |
| `GET_SYNC_STATE` | `{}` | `{ ok: true, data: { state: "idle"\|"syncing" } }` |
| `WORD_ONLINE_CDP_PASTE` | `{}` | `{ ok: true, data: { pasted: true } }` |
| `WORD_ONLINE_CDP_INSERT_TEXT` | `{ text }` | `{ ok: true }` |

Background also broadcasts `TEMPLATES_UPDATED` (no payload) to all content scripts after sync completes.

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

**Auto-sync (background)**
- `chrome.alarms` fires every 5 min (`SYNC_ALARM_NAME = "minutario-sync"`)
- `shared/sync.js` debounces local triggers 800ms; 5s retry, max 3 retries
- Failed deletes stored in `MinutarioDB.meta` as `minutario_pending_template_deletes:userId` / `minutario_pending_folder_deletes:userId`

### Expansion flow (content.js)

1. `keydown` listener captures characters after the `triggerChar` (default `/`) into `buffer`.
2. On `triggerKey` (default `Space`): look up `buffer` (minus the prefix) in `templateCache`.
3. `expandTemplateAtSelection` → `normalizeTemplateHtml` (strips Quill classes/styles to safe subset) → `insertHtmlWithRange` (tries `execCommand("insertHTML")` first, falls back to manual DOM insertion with backwards text walk to locate and delete the shortcut).
4. Sends `UPDATE_RECENT` to background.

`content.js` exports `MacroBlazeContent` on `global` and also via `module.exports` so the same file runs in both Chrome and jsdom tests. Keep this internal API name for compatibility even though the visible extension name is Minutário.

### Word Online / CDP integration (background.js)

Word Online's sandbox blocks standard DOM expansion. `background.js` uses Chrome DevTools Protocol as fallback:

- `withDebuggerSession(tabId, fn)` — attaches CDP debugger, runs `fn`, auto-detaches
- `pasteWithDebugger(sender)` — sends Ctrl+V key events via CDP
- `insertTextWithDebugger(sender, payload)` — inserts text directly via protocol

**jsdom tests do NOT simulate Word Online's MutationObserver** — always manually verify Word Online and Google Docs after changing expansion logic.

Debug probing: `logWordProbe()` writes diagnostic snapshots to `chrome.storage.local` with `probe_*` keys at 0ms, 150ms, 500ms, 1200ms post-expansion.

### Firefox port

`firefox/` mirrors all source files for Manifest V2 distribution. Key differences:

- Uses `browser.*` namespace (shimmed to `chrome.*` by `shared/browser-compat.js` for cross-browser compatibility)
- No CDP support — falls back to DOM expansion only for Word Online
- Signing: `npm run sign:firefox` requires `AMO_JWT_ISSUER` + `AMO_JWT_SECRET` env vars

### Publication metadata

`manifest.json` uses `"author": "Elvertoni Coimbra"` for the local/MVP build. When publishing a CRX, Chrome Web Store may require this value to match the publisher account email.

## Key Constraints

- **No build step** — all JS is vanilla ES5/ES2017, loaded directly by Chrome. No bundler, no TypeScript.
- **Quill is bundled** (`lib/`) — do not load from CDN; the extension must work offline.
- **MV3 service worker** — `background.js` has no persistent state beyond the message handler; always await `migrationPromise` before responding.
- **Clipboard API** — popup uses `navigator.clipboard.write` with `ClipboardItem`; requires `clipboardWrite` permission and a secure context.
- **Shortcut rules**: must start with `triggerChar`, contain only `[a-zA-Z0-9-]`, be unique across all templates.
- **`shared/config.js` is gitignored** — real credentials never committed; `shared/config.example.js` is the committed template.
- **Data model**: `plain_text NOT NULL` required in Supabase `templates` (stripped HTML for search/preview); `(user_id, shortcut)` is a unique constraint; `shared/api.js` converts camelCase JS ↔ snake_case SQL on every request.

## Reference Material

`refs/text blaze/` — downloaded Text Blaze assets for competitive analysis (not part of the extension build).

`docs/superpowers/specs/` — Minutário design spec (originally MacroBlaze; implementation reference).
