# MacroBlaze — Chrome Extension Design Spec

**Date:** 2026-04-28  
**Status:** Approved  
**Working name:** MacroBlaze ⚡

---

## Overview

MacroBlaze is a Chrome extension that expands text shortcuts into rich HTML templates inside Word Online (office.com). The user types a trigger sequence (e.g. `/contrato`) followed by Space, and the matching template is pasted into the document — replacing the shortcut in place.

**Motivation:** Repetitive legal/business documents typed manually in Word Online. No existing tool integrates directly with Word Online's editor via a Chrome extension.

---

## Target Platform

- **Browser:** Google Chrome (Manifest V3)
- **Host page:** Word Online — `https://word.live.com/*` and `https://*.officeapps.live.com/*`
- **User profile:** Individual or small team; personal/professional use

---

## Architecture

### Extension components

| Component | Type | Role |
|---|---|---|
| `content.js` | Content script | Monitors keystrokes in Word Online, detects trigger sequences, executes paste |
| `dashboard/` | Full-tab page opened via `chrome.tabs.create` | Primary UI for managing templates and folders |
| `popup/` | Browser action popup | Launcher only — opens dashboard, shows last 3 used templates |
| `background.js` | MV3 service worker (event-driven, terminates when idle) | Handles storage migrations and cross-tab messaging on demand |

In MV3 the background script is technically a service worker, but it is event-driven: it wakes on message or alarm events and terminates when idle. The content script reads `chrome.storage.sync` directly without going through the background.

### Background Message Contract

`background.js` is the single message router between popup, dashboard, and content scripts. All cross-tab actions use explicit typed messages.

```ts
interface OpenDashboardMessage {
  type: "OPEN_DASHBOARD";
  payload?: {
    source?: "popup" | "content" | "dashboard";
    focusExisting?: boolean; // default true
  };
}

interface GetTemplatesMessage {
  type: "GET_TEMPLATES";
  payload?: {
    folderId?: string | null;
    query?: string;
  };
}

type BackgroundMessage = OpenDashboardMessage | GetTemplatesMessage;

interface BackgroundOkResponse<T> {
  ok: true;
  data: T;
}

interface BackgroundErrorResponse {
  ok: false;
  error: string;
}
```

- `OPEN_DASHBOARD`: opens the dashboard tab via `chrome.tabs.create`; if `focusExisting` is true and a dashboard tab already exists, focus that tab instead of creating duplicates.
- `GET_TEMPLATES`: returns filtered templates loaded from `chrome.storage.sync` keys matching `tpl_*`, optionally filtered by `folderId` and `query`.

Storage migration state is tracked in `chrome.storage.local` under key `storageVersion`.

```ts
const STORAGE_VERSION_KEY = "storageVersion";
const CURRENT_STORAGE_VERSION = 1;
```

Migration protocol:
1. On background service worker startup, read `storageVersion` from `chrome.storage.local` (default `0` when missing).
2. If stored version is lower than `CURRENT_STORAGE_VERSION`, run incremental migrations in order (`1`, `2`, `3`, ...).
3. Each migration must be idempotent and scoped (read current data, transform only required keys, write back).
4. After all migrations succeed, write `storageVersion = CURRENT_STORAGE_VERSION` to mark completion.

Failure behavior:
- On migration error, log structured details with `console.error` (migration step, key, exception).
- Leave existing user data intact; never delete, overwrite with empty values, or silently discard data on failure.
- Return an error response for dependent messages while keeping extension UI responsive.

### Insertion approach: Clipboard Paste (Approach A)

1. Content script detects `/shortcut` + Space keystroke in Word Online.
2. Deletes the typed shortcut characters (backspace simulation).
3. Copies the template HTML to the system clipboard via `navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })])`.
4. Dispatches a synthetic `paste` event that Word Online intercepts and renders as rich text.

This approach is reliable across Word Online updates because it uses the browser's native paste pathway — no direct DOM injection into Word's internal editor.

---

## Trigger Mechanism

- **Trigger character:** `/` (configurable in Settings)
- **Completion key:** Space
- **Flow:** User types `/contrato` → presses Space → shortcut is deleted → template is pasted
- **No match:** If no template matches the shortcut, the Space is typed normally (no interruption)
- **Shortcuts** are stored without the leading `/`. The content script prepends `/` when matching.

### Shortcut Rules

- **Normalization:** Matching is case-insensitive. Shortcuts are stored in lowercase and compared in lowercase at runtime.
- **Allowed characters (v1):** `a-z`, `0-9`, and hyphen (`-`) only.
- **Validation location:** The dashboard Shortcut field validates input as the user types and shows an inline error for invalid characters.
- **Maximum length:** 30 characters (excluding the trigger character).
- **Duplicate handling:** Duplicate shortcuts are rejected at save time with a specific error message naming the conflicting template, e.g. `Atalho já em uso pelo template "Contrato de Serviço".`
- **Unicode scope:** Unicode and emoji shortcuts are out of scope for v1 and must be rejected by validation.

---

## Data Model

### Template object

```ts
interface Template {
  id: string;          // UUID v4
  name: string;        // Display name, e.g. "Contrato de Serviço"
  shortcut: string;    // Without leading slash, e.g. "contrato"
  content: string;     // Rich text as HTML string, e.g. "<strong>Prezado...</strong>"
  folderId: string | null;
  createdAt: number;   // Unix timestamp (ms)
  updatedAt: number;
}
```

### Folder object

```ts
interface Folder {
  id: string;          // UUID v4
  name: string;        // e.g. "Contratos"
  order: number;       // For drag-to-reorder
}
```

### Settings object

```ts
interface Settings {
  triggerChar: string;  // default "/"
  triggerKey: string;   // default "Space"
}
```

### Storage layout in `chrome.storage.sync`

```
"tpl_<uuid>"  →  Template object    (one key per template, max 8 KB each)
"folders"     →  Folder[]           (single key, full array)
"settings"    →  Settings           (single key)
```

**Why one key per template:** `chrome.storage.sync` limits each key to 8 KB. Storing all templates in one array would cap the entire collection at 8 KB. Individual keys give each template its own 8 KB budget.

**Capacity:** 100 KB total sync quota, ~2 KB average per rich template → ~50 templates. Sufficient for personal/small-team use.

### Quota Handling

Before saving any template, the extension validates both per-key and total sync quota.

1. **Per-key check:** Serialize the candidate template (`JSON.stringify`), compute UTF-8 byte length (`new TextEncoder().encode(raw).length`). Block save if > 8,192 bytes.
2. **Total quota check:** Read all `tpl_*` keys, estimate new total after the write. Block save if projected total > 102,400 bytes.
3. **User-facing error:** Non-blocking toast with byte counts, e.g. `Template size: 9,340 / 8,192 bytes`. Editor stays open; no data is lost.
4. **Guidance text:** `Delete old templates or shorten template content to save space.` shown whenever save is blocked by quota limits.

---

## Dashboard UI

Full Chrome tab opened from the popup or via the extension icon. Three-panel layout:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚡ MacroBlaze          Gerenciador de Templates     + Novo  │  ← top bar (#1d4ed8)
├──────────────┬──────────────────┬───────────────────────────┤
│ PASTAS       │ 🔍 Buscar...      │  [Template editor]        │
│              │──────────────────│                           │
│ 📁 Todos     │ Contrato …       │  Name field               │
│ 📁 Contratos │   /contrato      │  Shortcut field           │
│ 📁 E-mails   │──────────────────│  Folder selector          │
│ 📁 Relatórios│ Saudação …       │                           │
│              │   /saudacao      │  Rich text editor         │
│ + Nova Pasta │ Rodapé …         │  (B I U · lists · H1 H2)  │
│              │   /rodape        │                           │
│              │ Aviso …          │  [Salvar]  [Excluir]      │
│              │   /reuniao       │                           │
└──────────────┴──────────────────┴───────────────────────────┘
  200 px          240 px               flex 1
```

**Panel 1 — Folders sidebar (200 px)**
- "Todos os Templates" always shown at top (no folder filter)
- Folder list below; active folder highlighted in blue
- "Nova Pasta" at bottom

**Panel 2 — Template list (240 px)**
- Search bar filters by name or shortcut
- Each row: template name + shortcut in muted text + first line of content as preview
- Active template highlighted with blue left border

**Panel 3 — Template editor (flex)**
- Name input
- Shortcut input (prefix `/` shown as decoration, user types without it)
- Folder dropdown
- Rich text editor with toolbar: **B**, *I*, U, H1, H2, bullet list, numbered list
- Save and Delete buttons

### Popup

Minimal — opens dashboard on click. Shows last 3 used templates as quick-launch buttons.

**Popup Acceptance Criteria:**
- Clicking a recent template copies its content to the clipboard and shows a `Copiado!` confirmation for 1.5 s. No tab switch occurs.
- The recent list updates after every successful paste in the content script: content script → message to background → background writes to `chrome.storage.local` key `recent`.
- `recent` stores an array of template IDs, deduplicated newest-first, capped at 3.
- If fewer than 3 recents exist, only the available items are shown.

---

## Rich Text Editor

Use **Quill.js** (same library used by Text Blaze) for the in-dashboard editor.

Toolbar modules: `bold`, `italic`, `underline`, `header` (1 and 2), `list` (bullet and ordered).

Template `content` is stored as Quill's HTML output (`quill.root.innerHTML`). On paste into Word Online, this HTML is placed on the clipboard as `text/html` so Word renders formatting correctly.

---

## Variables (future scope)

Not in v1. Placeholder syntax `{nome}` may be detected at paste time in a future version to prompt the user for values before insertion. No variable resolution logic is implemented in this spec.

---

## Settings Page

Accessible from dashboard footer or popup. Controls:

- Trigger character (default `/`)
- Trigger completion key (default Space)

Stored in `settings` key of `chrome.storage.sync`.

---

## Files & Directory Structure

```
extensao_macro/
├── manifest.json
├── background.js
├── content.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.js
│   └── dashboard.css
├── lib/
│   └── quill.min.js       (bundled, no CDN dependency)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Permissions (manifest.json)

Complete MV3 manifest skeleton:

```json
{
  "manifest_version": 3,
  "name": "MacroBlaze",
  "version": "1.0.0",
  "description": "Expand text shortcuts into rich HTML templates in Word Online.",
  "permissions": ["storage", "clipboardWrite", "clipboardRead"],
  "host_permissions": [
    "https://word.live.com/*",
    "https://*.officeapps.live.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "MacroBlaze"
  },
  "content_scripts": [
    {
      "matches": [
        "https://word.live.com/*",
        "https://*.officeapps.live.com/*"
      ],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "dashboard/dashboard.html",
        "dashboard/dashboard.js",
        "dashboard/dashboard.css"
      ],
      "matches": ["<all_urls>"]
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

`popup/popup.js` opens the dashboard via `chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') })`.

---

## Out of Scope (v1)

- Variables / dynamic fields
- Shared team templates (multi-user sync)
- Import/export of template libraries
- Support for Google Docs, Notion, or other editors
- Offline mode / `chrome.storage.local` fallback
- Template usage analytics
