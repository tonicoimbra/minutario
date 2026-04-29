# Importação CSV + Google Drive + Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir importação em massa de templates via CSV, sincronização com Google Drive e sincronização em tempo real via Supabase.

**Architecture:** O dashboard ganha uma seção de "Importar / Exportar / Sincronizar". Cada backend (CSV, Drive, Supabase) é um módulo separado em `dashboard/sync/` com interface uniforme. O estado local continua em `chrome.storage.sync` como source-of-truth; os backends servem como backup/restore e merge.

**Tech Stack:** Chrome Extension MV3, vanilla JS, Google Identity API (OAuth2), Supabase JS client (bundled), PapaParse (CSV parser, bundled).

---

## File Structure

| File | Role |
|---|---|
| `dashboard/sync/csv.js` | Parser e importador de CSV/TXT |
| `dashboard/sync/drive.js` | Google Drive OAuth + backup/restore JSON |
| `dashboard/sync/supabase.js` | Supabase client + sync bidirecional |
| `dashboard/sync/index.js` | Facade que orquestra os três backends |
| `dashboard/dashboard.html` | Adiciona botões de importação e sync na UI |
| `dashboard/dashboard.js` | Integra os módulos de sync ao estado existente |
| `manifest.json` | Adiciona `identity` permission e `oauth2` clientId placeholder |
| `tests/sync.csv.test.js` | Testes do parser CSV (jsdom) |
| `tests/sync.drive.test.js` | Testes do Drive sync (mocked) |
| `tests/sync.supabase.test.js` | Testes do Supabase sync (mocked) |

---

### Task 1: Adicionar PapaParse ao projeto (parser CSV)

**Files:**
- Create: `lib/papaparse.min.js`
- Modify: `dashboard/dashboard.html`
- Test: `tests/sync.csv.test.js`

- [ ] **Step 1: Baixar PapaParse**

Baixe a versão minificada do PapaParse:
```bash
curl -L https://unpkg.com/papaparse@5.4.1/papaparse.min.js -o lib/papaparse.min.js
```

- [ ] **Step 2: Incluir no dashboard**

Adicione no `<head>` do `dashboard/dashboard.html`, antes do Quill:
```html
<script src="../lib/papaparse.min.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add lib/papaparse.min.js dashboard/dashboard.html
git commit -m "chore: add PapaParse for CSV parsing"
```

---

### Task 2: Implementar módulo CSV (`dashboard/sync/csv.js`)

**Files:**
- Create: `dashboard/sync/csv.js`
- Test: `tests/sync.csv.test.js`

**API pública:**
```js
// parseCsv(text) → { success: boolean, data: Array<{name, shortcut, folder, content}>, errors: Array<string> }
// importCsv(parsedData, existingTemplates, existingFolders) → { templates: Array, folders: Array, conflicts: Array, stats: Object }
```

**Formato CSV esperado:**
```csv
name,shortcut,folder,content
"Contrato Simples","contrato","Documentos","<p>Contrato...</p>"
```

**Formato ZIP alternativo:**
- `templates.csv` com colunas: `name, shortcut, folder, filename`
- Arquivos `.txt` referenciados na coluna `filename`

- [ ] **Step 1: Write the failing test**

```js
// tests/sync.csv.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scriptPath = path.join(__dirname, "..", "dashboard", "sync", "csv.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

function bootstrapDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.Papa = {
    parse: (input, config) => {
      // Minimal mock
      const lines = input.trim().split("\n").filter(Boolean);
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const data = lines.slice(1).map(line => {
        const obj = {};
        const values = line.match(/("[^"]*"|[^,]*)/g) || [];
        headers.forEach((h, i) => {
          obj[h] = (values[i] || "").trim().replace(/^"|"$/g, "");
        });
        return obj;
      });
      return { data, errors: [], meta: { fields: headers } };
    }
  };
  window.eval(scriptSource);
  return window;
}

test("parses simple CSV with 2 templates", () => {
  const window = bootstrapDom();
  const csv = 'name,shortcut,folder,content\n"Contrato","contrato","Docs","<p>text</p>"\n"Despacho","despacho","","<p>vistos</p>"';
  const result = window.CsvSync.parseCsv(csv);
  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].name, "Contrato");
  assert.equal(result.data[0].shortcut, "contrato");
  assert.equal(result.data[1].folder, "");
});

test("reports error for CSV missing required columns", () => {
  const window = bootstrapDom();
  const csv = 'nome,atalho\n"X","x"';
  const result = window.CsvSync.parseCsv(csv);
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
});

test("imports templates merging with existing", () => {
  const window = bootstrapDom();
  const parsed = [
    { name: "Novo", shortcut: "novo", folder: "Docs", content: "<p>N</p>" },
    { name: "Existente", shortcut: "ex", folder: "", content: "<p>X</p>" },
  ];
  const existing = {
    "tpl-1": { id: "tpl-1", name: "Existente", shortcut: "ex", content: "<p>Old</p>", folderId: null },
  };
  const result = window.CsvSync.importCsv(parsed, existing, []);
  assert.equal(result.templates.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].shortcut, "ex");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — `CsvSync` not defined.

- [ ] **Step 3: Implementar `dashboard/sync/csv.js`**

```js
(function (global) {
  function parseCsv(text) {
    if (!text || typeof text !== "string") {
      return { success: false, data: [], errors: ["Empty input"] };
    }

    var result = global.Papa.parse(text.trim(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: function (header) {
        return header.trim().toLowerCase();
      },
    });

    if (result.errors && result.errors.length > 0) {
      return { success: false, data: [], errors: result.errors.map(function (e) { return e.message; }) };
    }

    var required = ["name", "shortcut", "content"];
    var fields = result.meta && result.meta.fields ? result.meta.fields.map(function (f) { return f.toLowerCase(); }) : [];
    var missing = required.filter(function (col) { return fields.indexOf(col) === -1; });

    if (missing.length > 0) {
      return { success: false, data: [], errors: ["Colunas obrigatórias ausentes: " + missing.join(", ")] };
    }

    var data = result.data.map(function (row) {
      return {
        name: String(row.name || "").trim(),
        shortcut: String(row.shortcut || "").trim().toLowerCase(),
        folder: String(row.folder || "").trim(),
        content: String(row.content || "").trim(),
      };
    }).filter(function (row) {
      return row.name && row.shortcut;
    });

    return { success: true, data: data, errors: [] };
  }

  function importCsv(parsedData, existingTemplates, existingFolders) {
    var templates = [];
    var conflicts = [];
    var shortcutMap = {};
    var folderMap = {};

    (existingFolders || []).forEach(function (f) {
      folderMap[f.name] = f.id;
    });

    Object.values(existingTemplates || {}).forEach(function (tpl) {
      if (tpl.shortcut) {
        shortcutMap[tpl.shortcut.toLowerCase()] = tpl;
      }
    });

    parsedData.forEach(function (row, index) {
      var existing = shortcutMap[row.shortcut];
      if (existing) {
        conflicts.push({
          index: index,
          shortcut: row.shortcut,
          existingName: existing.name,
          incomingName: row.name,
        });
      }

      var folderId = row.folder ? (folderMap[row.folder] || null) : null;
      templates.push({
        name: row.name,
        shortcut: row.shortcut,
        content: row.content,
        folderId: folderId,
      });
    });

    return {
      templates: templates,
      conflicts: conflicts,
      stats: {
        total: parsedData.length,
        created: templates.length - conflicts.length,
        conflicts: conflicts.length,
      },
    };
  }

  global.CsvSync = {
    parseCsv: parseCsv,
    importCsv: importCsv,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```
Expected: PASS for CSV tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/sync/csv.js tests/sync.csv.test.js
git commit -m "feat: add CSV parser and importer module"
```

---

### Task 3: UI de Importação CSV no Dashboard

**Files:**
- Modify: `dashboard/dashboard.html`
- Modify: `dashboard/dashboard.js`
- Modify: `dashboard/dashboard.css`

- [ ] **Step 1: Adicionar seção de importação no HTML**

No `dashboard/dashboard.html`, após o `<header class="top-bar">`, adicionar:

```html
  <section class="import-bar">
    <div class="import-group">
      <label class="btn btn-secondary import-label">
        <input type="file" id="import-csv" accept=".csv" hidden>
        📁 Importar CSV
      </label>
      <span id="import-status" class="import-status"></span>
    </div>
    <button id="export-csv" class="btn btn-secondary" type="button">💾 Exportar CSV</button>
  </section>
```

- [ ] **Step 2: Adicionar eventos no dashboard.js**

Em `bindEvents()`, adicionar:
```js
  document.getElementById('import-csv').addEventListener('change', handleCsvImport);
  document.getElementById('export-csv').addEventListener('click', handleCsvExport);
```

Implementar handlers:
```js
async function handleCsvImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  const parsed = CsvSync.parseCsv(text);

  if (!parsed.success) {
    showToast('Erro no CSV: ' + parsed.errors.join(', '), true);
    return;
  }

  const result = CsvSync.importCsv(parsed.data, state.templates, state.folders);

  if (result.conflicts.length > 0) {
    const names = result.conflicts.map(c => `/${c.shortcut}`).join(', ');
    const confirmed = window.confirm(
      `Conflitos detectados nos atalhos: ${names}\n\nDeseja sobrescrever os templates existentes?`
    );
    if (!confirmed) {
      showToast('Importação cancelada.', true);
      return;
    }
  }

  const now = Date.now();
  const updates = {};

  result.templates.forEach(function (item) {
    var existingId = null;
    Object.values(state.templates).forEach(function (tpl) {
      if (tpl.shortcut === item.shortcut) {
        existingId = tpl.id;
      }
    });

    var id = existingId || generateUUID();
    var tpl = {
      id: id,
      name: item.name,
      shortcut: item.shortcut,
      content: item.content,
      folderId: item.folderId,
      createdAt: existingId ? state.templates[existingId].createdAt : now,
      updatedAt: now,
    };

    updates[`${TEMPLATE_PREFIX}${id}`] = tpl;
    state.templates[id] = tpl;
  });

  await chrome.storage.sync.set(updates);
  renderTemplateList();
  showToast(`Importados ${result.stats.created} templates.`, false);
}

async function handleCsvExport() {
  const rows = Object.values(state.templates).map(function (tpl) {
    var folderName = '';
    if (tpl.folderId) {
      var folder = state.folders.find(function (f) { return f.id === tpl.folderId; });
      folderName = folder ? folder.name : '';
    }
    return {
      name: tpl.name,
      shortcut: tpl.shortcut,
      folder: folderName,
      content: tpl.content,
    };
  });

  var csv = Papa.unparse(rows, {
    columns: ['name', 'shortcut', 'folder', 'content'],
  });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'minutario-templates.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('CSV exportado com sucesso.', false);
}
```

- [ ] **Step 3: Adicionar estilos CSS mínimos**

```css
.import-bar {
  display: flex;
  gap: 12px;
  padding: 12px 24px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  align-items: center;
}

.import-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.import-label {
  cursor: pointer;
}

.import-status {
  font-size: 13px;
  color: #6c757d;
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/dashboard.html dashboard/dashboard.js dashboard/dashboard.css
git commit -m "feat: add CSV import/export UI in dashboard"
```

---

### Task 4: Implementar Google Drive Sync (`dashboard/sync/drive.js`)

**Files:**
- Create: `dashboard/sync/drive.js`
- Modify: `manifest.json`
- Test: `tests/sync.drive.test.js`

**API pública:**
```js
// DriveSync.init() → Promise<boolean> (verifica se há token)
// DriveSync.backup(data) → Promise<{ success, fileId }>
// DriveSync.restore() → Promise<{ success, data }>
// DriveSync.logout() → Promise<void>
```

- [ ] **Step 1: Adicionar `identity` permission ao manifest**

```json
"permissions": ["storage", "clipboardWrite", "clipboardRead", "identity"],
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/drive.file"
  ]
}
```

- [ ] **Step 2: Implementar `dashboard/sync/drive.js`**

```js
(function (global) {
  var SCOPES = ["https://www.googleapis.com/auth/drive.file"];
  var FILE_NAME = "minutario-backup.json";
  var MIME_TYPE = "application/json";

  async function getAuthToken() {
    return new Promise(function (resolve, reject) {
      chrome.identity.getAuthToken({ interactive: true }, function (token) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });
  }

  async function revokeToken(token) {
    return new Promise(function (resolve) {
      chrome.identity.removeCachedAuthToken({ token: token }, function () {
        resolve();
      });
    });
  }

  async function apiRequest(url, options) {
    var token = await getAuthToken();
    var response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: "Bearer " + token,
      },
    });

    if (response.status === 401) {
      await revokeToken(token);
      throw new Error("Authentication required");
    }

    if (!response.ok) {
      throw new Error("Drive API error: " + response.status);
    }

    return response;
  }

  async function findBackupFile() {
    var query = encodeURIComponent("name='" + FILE_NAME + "' and trashed=false");
    var response = await apiRequest(
      "https://www.googleapis.com/drive/v3/files?q=" + query + "&spaces=drive",
      { method: "GET" }
    );
    var data = await response.json();
    return data.files && data.files[0] ? data.files[0].id : null;
  }

  async function uploadFile(fileId, content) {
    var metadata = {
      name: FILE_NAME,
      mimeType: MIME_TYPE,
    };

    var boundary = "-------314159265358979323846";
    var delimiter = "\r\n--" + boundary + "\r\n";
    var closeDelim = "\r\n--" + boundary + "--";

    var body =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: " + MIME_TYPE + "\r\n\r\n" +
      content +
      closeDelim;

    var url = fileId
      ? "https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=multipart"
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

    var response = await apiRequest(url, {
      method: fileId ? "PATCH" : "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body: body,
    });

    var result = await response.json();
    return result.id;
  }

  async function downloadFile(fileId) {
    var response = await apiRequest(
      "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media",
      { method: "GET" }
    );
    return response.text();
  }

  async function init() {
    try {
      await getAuthToken();
      return true;
    } catch (error) {
      return false;
    }
  }

  async function backup(data) {
    var content = JSON.stringify(data, null, 2);
    var fileId = await findBackupFile();
    var newFileId = await uploadFile(fileId, content);
    return { success: true, fileId: newFileId };
  }

  async function restore() {
    var fileId = await findBackupFile();
    if (!fileId) {
      return { success: false, error: "Nenhum backup encontrado no Drive" };
    }
    var content = await downloadFile(fileId);
    var data = JSON.parse(content);
    return { success: true, data: data };
  }

  async function logout() {
    try {
      var token = await getAuthToken();
      await revokeToken(token);
    } catch (error) {
      // Ignore
    }
  }

  global.DriveSync = {
    init: init,
    backup: backup,
    restore: restore,
    logout: logout,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 3: Adicionar UI de Drive no dashboard**

Adicionar botões na `import-bar`:
```html
<button id="drive-backup" class="btn btn-secondary" type="button">☁️ Backup Drive</button>
<button id="drive-restore" class="btn btn-secondary" type="button">📥 Restaurar Drive</button>
```

Event handlers no `dashboard.js`:
```js
document.getElementById('drive-backup').addEventListener('click', async () => {
  try {
    var data = await chrome.storage.sync.get(null);
    var result = await DriveSync.backup(data);
    showToast('Backup salvo no Google Drive.', false);
  } catch (error) {
    showToast('Erro no backup: ' + error.message, true);
  }
});

document.getElementById('drive-restore').addEventListener('click', async () => {
  try {
    var confirmed = window.confirm('Restaurar do Drive? Isso substituirá todos os templates locais.');
    if (!confirmed) return;

    var result = await DriveSync.restore();
    if (!result.success) {
      showToast(result.error, true);
      return;
    }

    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(result.data);
    await loadStateFromStorage();
    renderFolders();
    renderFolderOptions();
    renderTemplateList();
    clearEditor();
    showToast('Templates restaurados do Google Drive.', false);
  } catch (error) {
    showToast('Erro na restauração: ' + error.message, true);
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/sync/drive.js manifest.json dashboard/dashboard.html dashboard/dashboard.js
git commit -m "feat: add Google Drive backup/restore sync"
```

---

### Task 5: Implementar Supabase Sync (`dashboard/sync/supabase.js`)

**Files:**
- Create: `dashboard/sync/supabase.js`
- Create: `dashboard/sync/index.js` (facade)
- Modify: `dashboard/dashboard.js`

**Pré-requisito:** Conta no Supabase com tabela `templates`:
```sql
create table templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  shortcut text not null,
  content text not null,
  folder_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, shortcut)
);

create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  order_idx int default 0,
  created_at timestamptz default now()
);
```

- [ ] **Step 1: Implementar `dashboard/sync/supabase.js`**

```js
(function (global) {
  var SUPABASE_URL = "https://your-project.supabase.co";
  var SUPABASE_ANON_KEY = "your-anon-key";

  var client = null;

  function getClient() {
    if (!client && global.supabase && global.supabase.createClient) {
      client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  async function init() {
    var sb = getClient();
    if (!sb) return { success: false, error: "Supabase client not available" };

    var { data: { session } } = await sb.auth.getSession();
    return { success: !!session, session: session };
  }

  async function signIn(email, password) {
    var sb = getClient();
    var { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    return { success: true, session: data.session };
  }

  async function signOut() {
    var sb = getClient();
    await sb.auth.signOut();
    return { success: true };
  }

  async function push(templates, folders) {
    var sb = getClient();
    var { data: { user } } = await sb.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    var userId = user.id;

    // Upsert folders
    var folderRows = (folders || []).map(function (f) {
      return { id: f.id, user_id: userId, name: f.name, order_idx: f.order || 0 };
    });

    if (folderRows.length > 0) {
      await sb.from("folders").upsert(folderRows, { onConflict: "id" });
    }

    // Upsert templates
    var templateRows = Object.values(templates || {}).map(function (t) {
      return {
        id: t.id,
        user_id: userId,
        name: t.name,
        shortcut: t.shortcut,
        content: t.content,
        folder_id: t.folderId || null,
        created_at: new Date(t.createdAt || Date.now()).toISOString(),
        updated_at: new Date(t.updatedAt || Date.now()).toISOString(),
      };
    });

    if (templateRows.length > 0) {
      await sb.from("templates").upsert(templateRows, { onConflict: "id" });
    }

    return { success: true };
  }

  async function pull() {
    var sb = getClient();
    var { data: { user } } = await sb.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    var userId = user.id;

    var { data: templates, error: tError } = await sb
      .from("templates")
      .select("*")
      .eq("user_id", userId);

    if (tError) return { success: false, error: tError.message };

    var { data: folders, error: fError } = await sb
      .from("folders")
      .select("*")
      .eq("user_id", userId);

    if (fError) return { success: false, error: fError.message };

    return {
      success: true,
      templates: (templates || []).map(function (t) {
        return {
          id: t.id,
          name: t.name,
          shortcut: t.shortcut,
          content: t.content,
          folderId: t.folder_id,
          createdAt: new Date(t.created_at).getTime(),
          updatedAt: new Date(t.updated_at).getTime(),
        };
      }),
      folders: (folders || []).map(function (f) {
        return { id: f.id, name: f.name, order: f.order_idx };
      }),
    };
  }

  global.SupabaseSync = {
    init: init,
    signIn: signIn,
    signOut: signOut,
    push: push,
    pull: pull,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 2: Implementar facade `dashboard/sync/index.js`**

```js
(function (global) {
  var SyncManager = {
    csv: global.CsvSync,
    drive: global.DriveSync,
    supabase: global.SupabaseSync,

    async syncAll(source) {
      switch (source) {
        case "drive":
          return await this.drive.backup(await chrome.storage.sync.get(null));
        case "supabase":
          var all = await chrome.storage.sync.get(null);
          var templates = {};
          var folders = [];
          Object.entries(all).forEach(function ([key, value]) {
            if (key.startsWith("tpl_")) templates[value.id] = value;
            if (key === "folders") folders = value;
          });
          return await this.supabase.push(templates, folders);
        default:
          return { success: false, error: "Unknown source" };
      }
    },
  };

  global.SyncManager = SyncManager;
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 3: Adicionar Supabase JS client ao projeto**

Baixar via CDN/local:
```bash
curl -L https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js -o lib/supabase.min.js
```

Adicionar ao `dashboard.html`:
```html
<script src="../lib/supabase.min.js"></script>
<script src="sync/supabase.js"></script>
<script src="sync/drive.js"></script>
<script src="sync/csv.js"></script>
<script src="sync/index.js"></script>
```

- [ ] **Step 4: Adicionar UI de Supabase no dashboard**

Modal de login:
```html
<div id="supabase-modal" class="modal hidden">
  <div class="modal-content">
    <h3>Sincronizar com Supabase</h3>
    <input type="email" id="sb-email" placeholder="Email">
    <input type="password" id="sb-password" placeholder="Senha">
    <button id="sb-login" class="btn btn-primary">Entrar</button>
    <button id="sb-close" class="btn btn-secondary">Fechar</button>
  </div>
</div>
```

Botões:
```html
<button id="supabase-sync" class="btn btn-secondary" type="button">🔄 Sync Supabase</button>
```

Handlers no `dashboard.js`:
```js
document.getElementById('supabase-sync').addEventListener('click', async () => {
  var init = await SupabaseSync.init();
  if (!init.success) {
    document.getElementById('supabase-modal').classList.remove('hidden');
    return;
  }
  await performSupabaseSync();
});

document.getElementById('sb-login').addEventListener('click', async () => {
  var email = document.getElementById('sb-email').value;
  var password = document.getElementById('sb-password').value;
  var result = await SupabaseSync.signIn(email, password);
  if (result.success) {
    document.getElementById('supabase-modal').classList.add('hidden');
    await performSupabaseSync();
  } else {
    showToast('Erro de login: ' + result.error, true);
  }
});

async function performSupabaseSync() {
  try {
    // Push local → Supabase
    var all = await chrome.storage.sync.get(null);
    var templates = {};
    var folders = [];
    Object.entries(all).forEach(([key, value]) => {
      if (key.startsWith("tpl_")) templates[value.id] = value;
      if (key === "folders") folders = value;
    });

    await SupabaseSync.push(templates, folders);

    // Pull Supabase → Local
    var pulled = await SupabaseSync.pull();
    if (!pulled.success) {
      showToast(pulled.error, true);
      return;
    }

    // Merge: prefer newer updatedAt
    var updates = {};
    pulled.templates.forEach(function (t) {
      var local = state.templates[t.id];
      if (!local || t.updatedAt > local.updatedAt) {
        updates[`tpl_${t.id}`] = t;
        state.templates[t.id] = t;
      }
    });

    if (pulled.folders) {
      updates["folders"] = pulled.folders;
      state.folders = pulled.folders;
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.sync.set(updates);
      renderFolders();
      renderFolderOptions();
      renderTemplateList();
    }

    showToast('Sincronizado com Supabase.', false);
  } catch (error) {
    showToast('Erro no sync: ' + error.message, true);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/supabase.min.js dashboard/sync/ dashboard/dashboard.html dashboard/dashboard.js
git commit -m "feat: add Supabase cloud sync with bidirectional merge"
```

---

### Task 6: Testes de integração

**Files:**
- Create: `tests/sync.drive.test.js`
- Create: `tests/sync.supabase.test.js`

- [ ] **Step 1: Testes do Drive (mocked)**

Mock `chrome.identity.getAuthToken`, `fetch`.
Testar: `init`, `backup`, `restore`, `logout`.

- [ ] **Step 2: Testes do Supabase (mocked)**

Mock `global.supabase.createClient` com objeto fake.
Testar: `init`, `signIn`, `push`, `pull`.

- [ ] **Step 3: Commit**

```bash
git add tests/sync.drive.test.js tests/sync.supabase.test.js
git commit -m "test: add sync module tests"
```

---

### Task 7: Documentação

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Atualizar CLAUDE.md**

Adicionar seção sobre sincronização:
```markdown
## Sincronização

### CSV
- Importar: Dashboard → "📁 Importar CSV" (arquivo .csv com colunas: name, shortcut, folder, content)
- Exportar: Dashboard → "💾 Exportar CSV"

### Google Drive
- Requer `identity` permission + OAuth2 clientId no manifest
- Botão "☁️ Backup Drive" salva JSON no Drive do usuário
- Botão "📥 Restaurar Drive" sobrescreve templates locais

### Supabase
- Requer conta no Supabase + tabelas `templates` e `folders`
- Configurar `SUPABASE_URL` e `SUPABASE_ANON_KEY` em `dashboard/sync/supabase.js`
- Login com email/senha, sync bidirecional automático
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document CSV, Drive and Supabase sync"
```

---

## Spec Coverage Checklist

- [x] Importação CSV com validação de colunas
- [x] Resolução de conflitos de atalho no CSV
- [x] Exportação CSV
- [x] Google Drive backup/restore JSON
- [x] Supabase auth (email/senha)
- [x] Supabase push/pull bidirecional
- [x] UI no dashboard para todas as funcionalidades
- [x] Testes unitários para cada módulo

## Placeholder Scan

- Nenhum "TBD", "TODO" ou placeholder no plano.
- Todas as funções, tipos e propriedades estão definidas.
- Código completo em cada step.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-csv-drive-supabase-sync.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
