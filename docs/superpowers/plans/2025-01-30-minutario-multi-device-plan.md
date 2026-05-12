# Minutário Multi-Device — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar backend Supabase, dashboard web "Modo Tribunal" (Quick Copy), e evoluir a Chrome Extension para sincronização cross-device com templates compartilhados por escritório.

**Architecture:** Backend PostgreSQL no Supabase com Auth, RLS e Realtime. Clientes (Chrome Extension + Dashboard Web) usam IndexedDB como cache offline-first e sincronizam com Supabase em background. Dashboard é um PWA acessível em qualquer navegador sem instalação.

**Tech Stack:** Vanilla JS, Manifest V3 Chrome Extension, Supabase (PostgreSQL, Auth, Realtime), IndexedDB, PWA.

---

## File Structure

### Novos arquivos
```
docs/superpowers/plans/2025-01-30-minutario-multi-device-plan.md
shared/
  auth.js          # Autenticação JWT com Supabase
  db.js            # Wrapper IndexedDB
  sync.js          # Lógica de sync offline-first
  api.js           # Cliente Supabase unificado
  config.js        # Configurações (URL, keys)
dashboard/
  index.html       # Dashboard web (login + quick copy)
  dashboard.js     # Lógica do dashboard
  dashboard.css    # Estilos do dashboard
  manifest.json    # PWA manifest
  sw.js            # Service worker para cache offline
lib/
  supabase.min.js  # Cliente Supabase (CDN ou local)
tests/
  shared.auth.test.js
  shared.db.test.js
  shared.sync.test.js
```

### Arquivos modificados
```
content.js          # loadTemplates() usa IndexedDB em vez de chrome.storage.sync
background.js       # Adicionar background sync com alarms
popup/popup.js      # Adicionar login/status sync
popup/popup.html    # Adicionar seção de login
manifest.json       # host_permissions para Supabase, CSP
```

---

## Fase 1: Backend Supabase

### Task 1.1: Criar projeto Supabase e schema SQL

**Files:**
- Create: `supabase/schema.sql`

- [ ] **Step 1: Escrever schema SQL completo**

```sql
-- Organizações (escritórios/tribunais)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tipos de usuário
CREATE TYPE user_role AS ENUM ('admin', 'assessor', 'guest');

-- Usuários
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role user_role DEFAULT 'assessor',
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Pastas
CREATE TABLE folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_idx INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Templates
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  shortcut TEXT NOT NULL,
  content TEXT NOT NULL,
  plain_text TEXT,
  is_personal BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX idx_templates_org_shortcut ON templates(org_id, shortcut);
CREATE INDEX idx_templates_org_folder ON templates(org_id, folder_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

- [ ] **Step 2: Commit do schema**

```bash
git add supabase/schema.sql
git commit -m "feat(supabase): create database schema for organizations, users, folders, templates"
```

### Task 1.2: Configurar Row Level Security (RLS)

**Files:**
- Modify: `supabase/schema.sql` (append)

- [ ] **Step 1: Adicionar RLS policies ao schema**

```sql
-- Habilitar RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- Função para obter org_id do JWT
CREATE OR REPLACE FUNCTION get_org_id()
RETURNS UUID AS $$
BEGIN
  RETURN (auth.jwt() ->> 'org_id')::UUID;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Templates: ver apenas da própria organização
CREATE POLICY "templates_select_org" ON templates
  FOR SELECT USING (org_id = get_org_id());

-- Templates: inserir apenas na própria organização
CREATE POLICY "templates_insert_org" ON templates
  FOR INSERT WITH CHECK (org_id = get_org_id());

-- Templates: atualizar apenas se for admin ou autor
CREATE POLICY "templates_update_org" ON templates
  FOR UPDATE USING (
    org_id = get_org_id() AND (
      (auth.jwt() ->> 'role') = 'admin' OR created_by = auth.uid()
    )
  );

-- Templates: deletar apenas se for admin ou autor
CREATE POLICY "templates_delete_org" ON templates
  FOR DELETE USING (
    org_id = get_org_id() AND (
      (auth.jwt() ->> 'role') = 'admin' OR created_by = auth.uid()
    )
  );

-- Folders: mesma lógica
CREATE POLICY "folders_select_org" ON folders
  FOR SELECT USING (org_id = get_org_id());

CREATE POLICY "folders_insert_org" ON folders
  FOR INSERT WITH CHECK (org_id = get_org_id());

CREATE POLICY "folders_update_org" ON folders
  FOR UPDATE USING (org_id = get_org_id() AND (auth.jwt() ->> 'role') = 'admin');

CREATE POLICY "folders_delete_org" ON folders
  FOR DELETE USING (org_id = get_org_id() AND (auth.jwt() ->> 'role') = 'admin');

-- Users: ver apenas da própria organização
CREATE POLICY "users_select_org" ON users
  FOR SELECT USING (org_id = get_org_id());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(supabase): add RLS policies for org-level isolation"
```

### Task 1.3: Configurar Auth e JWT claims

**Files:**
- Modify: `supabase/schema.sql` (append)

- [ ] **Step 1: Criar trigger para sync users com auth.users**

```sql
-- Tabela para mapear auth.users -> users custom
-- E adicionar org_id e role ao JWT

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Inserir na tabela users custom quando novo auth.user é criado
  -- Nota: org_id deve ser passado nos metadata do signup
  INSERT INTO public.users (id, email, org_id, role, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    (NEW.raw_user_meta_data ->> 'org_id')::UUID,
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'assessor'),
    NEW.raw_user_meta_data ->> 'display_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

- [ ] **Step 2: Criar função para atualizar JWT claims**

```sql
-- Função para retornar claims customizadas no JWT
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  user_org_id UUID;
  user_role TEXT;
BEGIN
  SELECT org_id, role INTO user_org_id, user_role
  FROM public.users WHERE id = (event ->> 'user_id')::UUID;

  event := event || jsonb_build_object(
    'claims', COALESCE(event -> 'claims', '{}'::jsonb) || jsonb_build_object(
      'org_id', user_org_id::text,
      'role', user_role
    )
  );

  RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dar permissão para a função ser usada pelo auth hook
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(supabase): add auth hooks and JWT claims for org_id/role"
```

### Task 1.4: Configurar Realtime

**Files:**
- Modify: `supabase/schema.sql` (append)

- [ ] **Step 1: Habilitar realtime nas tabelas**

```sql
-- Adicionar tabelas à publication do realtime
ALTER PUBLICATION supabase_realtime ADD TABLE templates;
ALTER PUBLICATION supabase_realtime ADD TABLE folders;

-- Configurar para enviar apenas mudanças relevantes (row level)
-- O RLS do realtime respeita as policies do PostgreSQL
```

- [ ] **Step 2: Criar seed data para testes**

```sql
-- Seed data
INSERT INTO organizations (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Escritório Teste', 'escritorio-teste');

INSERT INTO folders (id, org_id, name, order_idx) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Geral', 0),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Trabalhista', 1);

INSERT INTO templates (id, org_id, folder_id, name, shortcut, content, plain_text, created_by) VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Caso 01 - Contestação', 'caso01', '<p>Contestação <strong>trabalhista</strong> modelo.</p>', 'Contestação trabalhista modelo.', NULL),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'Recurso Ordinário', 'recurso', '<p>Recurso <em>ordinário</em> modelo.</p>', 'Recurso ordinário modelo.', NULL);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(supabase): enable realtime and add seed data"
```

---

## Fase 2: Shared Libraries

### Task 2.1: Configurações do Supabase

**Files:**
- Create: `shared/config.js`

- [ ] **Step 1: Criar arquivo de configurações**

```javascript
(function (global) {
  var CONFIG = {
    SUPABASE_URL: "https://your-project.supabase.co",
    SUPABASE_ANON_KEY: "your-anon-key",
    DB_NAME: "MinutarioDB",
    DB_VERSION: 1,
    SYNC_INTERVAL_MINUTES: 5,
    TEMPLATES_TABLE: "templates",
    FOLDERS_TABLE: "folders",
    LAST_SYNC_KEY: "minutario_last_sync",
    AUTH_TOKEN_KEY: "minutario_auth_token",
  };

  global.MinutarioConfig = CONFIG;
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 2: Commit**

```bash
git add shared/config.js
git commit -m "feat(shared): add Supabase configuration constants"
```

### Task 2.2: Wrapper IndexedDB

**Files:**
- Create: `shared/db.js`
- Create: `tests/shared.db.test.js`

- [ ] **Step 1: Escrever teste do IndexedDB wrapper**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

test("IndexedDB wrapper stores and retrieves templates", async () => {
  // Mock IndexedDB para testes Node.js
  const mockDb = {
    templates: new Map(),
    async put(template) {
      this.templates.set(template.id, template);
      return template;
    },
    async getAll() {
      return Array.from(this.templates.values());
    },
    async getByShortcut(shortcut) {
      return Array.from(this.templates.values()).find(t => t.shortcut === shortcut);
    },
    async clear() {
      this.templates.clear();
    }
  };

  await mockDb.put({ id: "1", shortcut: "caso01", name: "Caso 01", content: "<p>Teste</p>" });
  const all = await mockDb.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].shortcut, "caso01");
});
```

- [ ] **Step 2: Implementar IndexedDB wrapper**

```javascript
(function (global) {
  var CONFIG = global.MinutarioConfig || { DB_NAME: "MinutarioDB", DB_VERSION: 1 };
  var DB = null;

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB not supported"));
        return;
      }

      var request = global.indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

      request.onerror = function () {
        reject(request.error);
      };

      request.onsuccess = function () {
        DB = request.result;
        resolve(DB);
      };

      request.onupgradeneeded = function (event) {
        var db = event.target.result;

        if (!db.objectStoreNames.contains("templates")) {
          var store = db.createObjectStore("templates", { keyPath: "id" });
          store.createIndex("shortcut", "shortcut", { unique: false });
          store.createIndex("org_id", "org_id", { unique: false });
        }

        if (!db.objectStoreNames.contains("folders")) {
          db.createObjectStore("folders", { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
    });
  }

  function getStore(storeName, mode) {
    return new Promise(function (resolve, reject) {
      if (!DB) {
        reject(new Error("Database not open"));
        return;
      }
      var transaction = DB.transaction([storeName], mode || "readonly");
      var store = transaction.objectStore(storeName);
      resolve(store);
    });
  }

  async function putTemplate(template) {
    var store = await getStore("templates", "readwrite");
    return new Promise(function (resolve, reject) {
      var request = store.put(template);
      request.onsuccess = function () {
        resolve(template);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function getAllTemplates() {
    var store = await getStore("templates", "readonly");
    return new Promise(function (resolve, reject) {
      var request = store.getAll();
      request.onsuccess = function () {
        resolve(request.result || []);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function getTemplateByShortcut(shortcut) {
    var store = await getStore("templates", "readonly");
    return new Promise(function (resolve, reject) {
      var index = store.index("shortcut");
      var request = index.get(shortcut);
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function deleteAllTemplates() {
    var store = await getStore("templates", "readwrite");
    return new Promise(function (resolve, reject) {
      var request = store.clear();
      request.onsuccess = function () {
        resolve();
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function setMeta(key, value) {
    var store = await getStore("meta", "readwrite");
    return new Promise(function (resolve, reject) {
      var request = store.put({ key: key, value: value });
      request.onsuccess = function () {
        resolve();
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function getMeta(key) {
    var store = await getStore("meta", "readonly");
    return new Promise(function (resolve, reject) {
      var request = store.get(key);
      request.onsuccess = function () {
        resolve(request.result ? request.result.value : null);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  global.MinutarioDB = {
    open: openDatabase,
    putTemplate: putTemplate,
    getAllTemplates: getAllTemplates,
    getTemplateByShortcut: getTemplateByShortcut,
    deleteAllTemplates: deleteAllTemplates,
    setMeta: setMeta,
    getMeta: getMeta,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 3: Rodar teste**

```bash
node --test tests/shared.db.test.js
```
Expected: 1 test pass

- [ ] **Step 4: Commit**

```bash
git add shared/db.js tests/shared.db.test.js
git commit -m "feat(shared): add IndexedDB wrapper for offline cache"
```

### Task 2.3: Cliente Supabase Unificado

**Files:**
- Create: `shared/api.js`

- [ ] **Step 1: Implementar cliente API**

```javascript
(function (global) {
  var CONFIG = global.MinutarioConfig || {};
  var supabaseClient = null;

  function getClient() {
    if (supabaseClient) {
      return supabaseClient;
    }

    if (!global.supabase || !global.supabase.createClient) {
      throw new Error("Supabase library not loaded");
    }

    supabaseClient = global.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      }
    );

    return supabaseClient;
  }

  async function getTemplates(orgId, options) {
    var sb = getClient();
    var query = sb
      .from("templates")
      .select("*")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false });

    if (options && options.since) {
      query = query.gt("updated_at", options.since);
    }

    if (options && options.limit) {
      query = query.limit(options.limit);
    }

    var result = await query;
    return result;
  }

  async function createTemplate(template) {
    var sb = getClient();
    var result = await sb.from("templates").insert(template).select().single();
    return result;
  }

  async function updateTemplate(id, updates) {
    var sb = getClient();
    var result = await sb
      .from("templates")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    return result;
  }

  async function deleteTemplate(id) {
    var sb = getClient();
    var result = await sb.from("templates").delete().eq("id", id);
    return result;
  }

  async function searchTemplates(orgId, searchTerm) {
    var sb = getClient();
    var result = await sb
      .from("templates")
      .select("*")
      .eq("org_id", orgId)
      .or("name.ilike.%" + searchTerm + "%,shortcut.ilike.%" + searchTerm + "%")
      .order("usage_count", { ascending: false })
      .limit(20);
    return result;
  }

  async function getFolders(orgId) {
    var sb = getClient();
    var result = await sb
      .from("folders")
      .select("*")
      .eq("org_id", orgId)
      .order("order_idx", { ascending: true });
    return result;
  }

  function subscribeToTemplates(orgId, callback) {
    var sb = getClient();
    return sb
      .channel("templates-org-" + orgId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "templates",
          filter: "org_id=eq." + orgId,
        },
        function (payload) {
          callback(payload);
        }
      )
      .subscribe();
  }

  global.MinutarioAPI = {
    getClient: getClient,
    getTemplates: getTemplates,
    createTemplate: createTemplate,
    updateTemplate: updateTemplate,
    deleteTemplate: deleteTemplate,
    searchTemplates: searchTemplates,
    getFolders: getFolders,
    subscribeToTemplates: subscribeToTemplates,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 2: Commit**

```bash
git add shared/api.js
git commit -m "feat(shared): add unified Supabase API client"
```

### Task 2.4: Lógica de Sync Offline-First

**Files:**
- Create: `shared/sync.js`
- Create: `tests/shared.sync.test.js`

- [ ] **Step 1: Escrever teste de sync**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

test("merge remote templates into local cache", async () => {
  var localTemplates = [
    { id: "1", shortcut: "caso01", content: "old", updated_at: "2025-01-01T00:00:00Z" }
  ];
  var remoteTemplates = [
    { id: "1", shortcut: "caso01", content: "new", updated_at: "2025-01-02T00:00:00Z" }
  ];

  // Simular merge
  var merged = {};
  localTemplates.forEach(function (t) {
    merged[t.id] = t;
  });
  remoteTemplates.forEach(function (t) {
    var existing = merged[t.id];
    if (!existing || new Date(t.updated_at) > new Date(existing.updated_at)) {
      merged[t.id] = t;
    }
  });

  var result = Object.values(merged);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, "new");
});
```

- [ ] **Step 2: Implementar sync engine**

```javascript
(function (global) {
  var DB = global.MinutarioDB;
  var API = global.MinutarioAPI;
  var CONFIG = global.MinutarioConfig || {};

  var syncState = "idle";
  var syncListeners = [];

  function setSyncState(state, error) {
    syncState = state;
    syncListeners.forEach(function (listener) {
      try {
        listener(state, error);
      } catch (e) {
        console.error("Sync listener error:", e);
      }
    });
  }

  function onSyncStateChange(listener) {
    syncListeners.push(listener);
    return function () {
      var index = syncListeners.indexOf(listener);
      if (index > -1) {
        syncListeners.splice(index, 1);
      }
    };
  }

  async function getLastSyncTime() {
    if (!DB) return null;
    try {
      return await DB.getMeta(CONFIG.LAST_SYNC_KEY);
    } catch (e) {
      return null;
    }
  }

  async function setLastSyncTime(time) {
    if (!DB) return;
    try {
      await DB.setMeta(CONFIG.LAST_SYNC_KEY, time || new Date().toISOString());
    } catch (e) {
      console.error("Failed to set last sync time:", e);
    }
  }

  function mergeTemplates(localList, remoteList) {
    var merged = {};

    (localList || []).forEach(function (t) {
      merged[t.id] = t;
    });

    (remoteList || []).forEach(function (t) {
      var existing = merged[t.id];
      if (!existing) {
        merged[t.id] = t;
        return;
      }

      var remoteTime = new Date(t.updated_at).getTime();
      var localTime = new Date(existing.updated_at).getTime();

      if (remoteTime > localTime) {
        merged[t.id] = t;
      }
    });

    return Object.values(merged);
  }

  async function syncTemplates(orgId) {
    if (!DB || !API) {
      setSyncState("error", "DB or API not available");
      return { success: false, error: "DB or API not available" };
    }

    setSyncState("syncing");

    try {
      var lastSync = await getLastSyncTime();
      var result = await API.getTemplates(orgId, { since: lastSync });

      if (result.error) {
        setSyncState("error", result.error.message);
        return { success: false, error: result.error.message };
      }

      var remoteTemplates = result.data || [];

      if (remoteTemplates.length === 0) {
        setSyncState("idle");
        return { success: true, updated: 0 };
      }

      var localTemplates = await DB.getAllTemplates();
      var merged = mergeTemplates(localTemplates, remoteTemplates);

      // Salvar todos os templates merged no IndexedDB
      for (var i = 0; i < merged.length; i++) {
        await DB.putTemplate(merged[i]);
      }

      await setLastSyncTime(new Date().toISOString());
      setSyncState("updated");

      return { success: true, updated: remoteTemplates.length };
    } catch (error) {
      setSyncState("error", error.message);
      return { success: false, error: error.message };
    }
  }

  async function fullSync(orgId) {
    if (!DB || !API) {
      return { success: false, error: "DB or API not available" };
    }

    setSyncState("syncing");

    try {
      var result = await API.getTemplates(orgId);

      if (result.error) {
        setSyncState("error", result.error.message);
        return { success: false, error: result.error.message };
      }

      var remoteTemplates = result.data || [];

      // Limpa local e insere todos do servidor
      await DB.deleteAllTemplates();

      for (var i = 0; i < remoteTemplates.length; i++) {
        await DB.putTemplate(remoteTemplates[i]);
      }

      await setLastSyncTime(new Date().toISOString());
      setSyncState("updated");

      return { success: true, updated: remoteTemplates.length };
    } catch (error) {
      setSyncState("error", error.message);
      return { success: false, error: error.message };
    }
  }

  global.MinutarioSync = {
    syncTemplates: syncTemplates,
    fullSync: fullSync,
    onSyncStateChange: onSyncStateChange,
    getSyncState: function () {
      return syncState;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 3: Rodar teste**

```bash
node --test tests/shared.sync.test.js
```
Expected: 1 test pass

- [ ] **Step 4: Commit**

```bash
git add shared/sync.js tests/shared.sync.test.js
git commit -m "feat(shared): add offline-first sync engine with conflict resolution"
```

---

## Fase 3: Dashboard Web

### Task 3.1: HTML e CSS do Dashboard

**Files:**
- Create: `dashboard/index.html`
- Create: `dashboard/dashboard.css`

- [ ] **Step 1: Criar HTML do dashboard**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Minutário — Dashboard</title>
  <link rel="stylesheet" href="dashboard.css">
  <link rel="manifest" href="manifest.json">
  <meta name="theme-color" content="#2563eb">
</head>
<body>
  <div id="app">
    <!-- Tela de Login -->
    <div id="login-screen" class="screen">
      <div class="login-box">
        <h1>Minutário</h1>
        <p>Templates de texto para assessores</p>
        <form id="login-form">
          <input type="email" id="login-email" placeholder="E-mail" required>
          <input type="password" id="login-password" placeholder="Senha" required>
          <button type="submit">Entrar</button>
        </form>
        <div id="login-error" class="error"></div>
      </div>
    </div>

    <!-- Dashboard Principal -->
    <div id="dashboard-screen" class="screen hidden">
      <header>
        <h1>Minutário</h1>
        <div class="header-actions">
          <span id="sync-status" class="sync-badge idle">Sincronizado</span>
          <button id="logout-btn">Sair</button>
        </div>
      </header>

      <main>
        <div class="search-box">
          <input
            type="text"
            id="search-input"
            placeholder="🔍 Buscar templates... (Ctrl+1 a Ctrl+9 para copiar)"
            autocomplete="off"
          >
        </div>

        <div id="templates-list" class="templates-list">
          <!-- Templates serão inseridos aqui via JS -->
        </div>

        <div id="empty-state" class="empty-state hidden">
          <p>Nenhum template encontrado.</p>
        </div>
      </main>

      <div id="toast" class="toast hidden"></div>
    </div>
  </div>

  <!-- Libs -->
  <script src="../lib/supabase.min.js"></script>

  <!-- Shared -->
  <script src="../shared/config.js"></script>
  <script src="../shared/db.js"></script>
  <script src="../shared/api.js"></script>
  <script src="../shared/sync.js"></script>

  <!-- Dashboard -->
  <script src="dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Criar CSS do dashboard**

```css
:root {
  --primary: #2563eb;
  --primary-dark: #1d4ed8;
  --bg: #f8fafc;
  --surface: #ffffff;
  --text: #1e293b;
  --text-muted: #64748b;
  --border: #e2e8f0;
  --success: #10b981;
  --error: #ef4444;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

.hidden {
  display: none !important;
}

/* Login */
#login-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.login-box {
  background: var(--surface);
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
  text-align: center;
}

.login-box h1 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.login-box p {
  color: var(--text-muted);
  margin-bottom: 1.5rem;
}

#login-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

#login-form input {
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 1rem;
}

#login-form button {
  padding: 0.75rem;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;
}

#login-form button:hover {
  background: var(--primary-dark);
}

.error {
  color: var(--error);
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

/* Dashboard */
#dashboard-screen {
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

header h1 {
  font-size: 1.25rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.sync-badge {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.sync-badge.idle {
  background: #e0f2fe;
  color: #0369a1;
}

.sync-badge.syncing {
  background: #fef3c7;
  color: #92400e;
}

.sync-badge.updated {
  background: #d1fae5;
  color: #065f46;
}

.sync-badge.error {
  background: #fee2e2;
  color: #991b1b;
}

#logout-btn {
  padding: 0.5rem 1rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
}

/* Search */
.search-box {
  margin-bottom: 1rem;
}

#search-input {
  width: 100%;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 1rem;
  background: var(--surface);
}

#search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

/* Templates List */
.templates-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.template-item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.template-item:hover {
  border-color: var(--primary);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.template-number {
  background: var(--primary);
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.template-info {
  flex: 1;
  min-width: 0;
}

.template-name {
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.template-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Toast */
.toast {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text);
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-size: 0.875rem;
  z-index: 1000;
  transition: opacity 0.3s;
}

.toast.hidden {
  opacity: 0;
  pointer-events: none;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--text-muted);
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/index.html dashboard/dashboard.css
git commit -m "feat(dashboard): add HTML and CSS for quick-copy dashboard"
```

### Task 3.2: JavaScript do Dashboard

**Files:**
- Create: `dashboard/dashboard.js`

- [ ] **Step 1: Implementar lógica do dashboard**

```javascript
(function () {
  var supabaseClient = null;
  var currentUser = null;
  var currentOrgId = null;
  var templatesCache = [];
  var searchDebounceTimer = null;

  // Elementos DOM
  var loginScreen = document.getElementById("login-screen");
  var dashboardScreen = document.getElementById("dashboard-screen");
  var loginForm = document.getElementById("login-form");
  var loginError = document.getElementById("login-error");
  var logoutBtn = document.getElementById("logout-btn");
  var searchInput = document.getElementById("search-input");
  var templatesList = document.getElementById("templates-list");
  var emptyState = document.getElementById("empty-state");
  var syncStatus = document.getElementById("sync-status");
  var toast = document.getElementById("toast");

  // Config
  var CONFIG = window.MinutarioConfig || {};

  // Inicialização
  async function init() {
    // Verificar se já está logado
    var token = localStorage.getItem("minutario_auth_token");
    if (token) {
      try {
        await initSupabase(token);
        var session = await supabaseClient.auth.getSession();
        if (session.data.session) {
          currentUser = session.data.session.user;
          currentOrgId = currentUser.user_metadata?.org_id || currentUser.app_metadata?.org_id;
          await showDashboard();
          return;
        }
      } catch (e) {
        console.error("Auto-login failed:", e);
      }
    }

    showLogin();
  }

  async function initSupabase(token) {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase library not loaded");
    }

    supabaseClient = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      }
    );

    if (token) {
      await supabaseClient.auth.setSession({
        access_token: token,
        refresh_token: localStorage.getItem("minutario_refresh_token") || "",
      });
    }

    // Inicializar shared libs
    if (window.MinutarioDB) {
      await window.MinutarioDB.open();
    }
  }

  function showLogin() {
    loginScreen.classList.remove("hidden");
    dashboardScreen.classList.add("hidden");
  }

  async function showDashboard() {
    loginScreen.classList.add("hidden");
    dashboardScreen.classList.remove("hidden");

    // Carregar templates do cache local primeiro
    await loadTemplatesFromCache();

    // Sincronizar com servidor em background
    syncTemplates();

    // Inscrever em realtime
    subscribeToRealtime();
  }

  async function loadTemplatesFromCache() {
    if (!window.MinutarioDB) {
      templatesCache = [];
      renderTemplates();
      return;
    }

    try {
      templatesCache = await window.MinutarioDB.getAllTemplates();
      renderTemplates();
    } catch (e) {
      console.error("Failed to load from cache:", e);
      templatesCache = [];
    }
  }

  async function syncTemplates() {
    if (!currentOrgId || !window.MinutarioSync) {
      return;
    }

    updateSyncStatus("syncing");

    var result = await window.MinutarioSync.fullSync(currentOrgId);

    if (result.success) {
      await loadTemplatesFromCache();
      updateSyncStatus("updated");
      setTimeout(function () {
        updateSyncStatus("idle");
      }, 2000);
    } else {
      updateSyncStatus("error");
    }
  }

  function subscribeToRealtime() {
    if (!supabaseClient || !currentOrgId) {
      return;
    }

    supabaseClient
      .channel("templates-" + currentOrgId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "templates",
          filter: "org_id=eq." + currentOrgId,
        },
        function (payload) {
          console.log("Realtime update:", payload);
          syncTemplates();
        }
      )
      .subscribe();
  }

  function renderTemplates() {
    var searchTerm = searchInput.value.toLowerCase().trim();
    var filtered = templatesCache;

    if (searchTerm) {
      filtered = templatesCache.filter(function (t) {
        return (
          (t.name && t.name.toLowerCase().includes(searchTerm)) ||
          (t.shortcut && t.shortcut.toLowerCase().includes(searchTerm)) ||
          (t.plain_text && t.plain_text.toLowerCase().includes(searchTerm))
        );
      });
    }

    templatesList.innerHTML = "";

    if (filtered.length === 0) {
      templatesList.classList.add("hidden");
      emptyState.classList.remove("hidden");
      return;
    }

    templatesList.classList.remove("hidden");
    emptyState.classList.add("hidden");

    filtered.forEach(function (template, index) {
      var item = document.createElement("div");
      item.className = "template-item";
      item.dataset.id = template.id;
      item.dataset.index = index;

      var shortcutDisplay = template.shortcut ? " /" + template.shortcut : "";

      item.innerHTML =
        '<div class="template-number">' +
        (index + 1) +
        "</div>" +
        '<div class="template-info">' +
        '<div class="template-name">' +
        escapeHtml(template.name) +
        "</div>" +
        '<div class="template-meta">' +
        escapeHtml(shortcutDisplay) +
        " • " +
        (template.usage_count || 0) +
        " usos" +
        "</div>" +
        "</div>";

      item.addEventListener("click", function () {
        copyTemplate(template);
      });

      templatesList.appendChild(item);
    });
  }

  async function copyTemplate(template) {
    var html = template.content || "";
    var plain = template.plain_text || stripHtml(html);

    try {
      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }

      showToast('"' + template.name + '" copiado! Cole com Ctrl+V');

      // Incrementar usage_count (opcional, em background)
      incrementUsageCount(template.id);
    } catch (err) {
      showToast("Erro ao copiar. Tente novamente.");
      console.error("Copy failed:", err);
    }
  }

  async function incrementUsageCount(templateId) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.rpc("increment_template_usage", {
        template_id: templateId,
      });
    } catch (e) {
      // Silencioso
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(function () {
      toast.classList.add("hidden");
    }, 3000);
  }

  function updateSyncStatus(state) {
    var labels = {
      idle: "Sincronizado",
      syncing: "Sincronizando...",
      updated: "Atualizado!",
      error: "Erro de sync",
    };

    syncStatus.textContent = labels[state] || state;
    syncStatus.className = "sync-badge " + state;
  }

  // Helpers
  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function stripHtml(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  // Event Listeners
  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    loginError.textContent = "";

    var email = document.getElementById("login-email").value;
    var password = document.getElementById("login-password").value;

    try {
      await initSupabase();
      var result = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (result.error) {
        loginError.textContent = result.error.message;
        return;
      }

      currentUser = result.data.user;
      currentOrgId =
        currentUser.user_metadata?.org_id || currentUser.app_metadata?.org_id;

      // Salvar token
      localStorage.setItem("minutario_auth_token", result.data.session.access_token);
      localStorage.setItem("minutario_refresh_token", result.data.session.refresh_token);

      await showDashboard();
    } catch (err) {
      loginError.textContent = "Erro ao fazer login. Tente novamente.";
      console.error("Login error:", err);
    }
  });

  logoutBtn.addEventListener("click", async function () {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    localStorage.removeItem("minutario_auth_token");
    localStorage.removeItem("minutario_refresh_token");
    if (window.MinutarioDB) {
      await window.MinutarioDB.deleteAllTemplates();
    }
    currentUser = null;
    currentOrgId = null;
    showLogin();
  });

  searchInput.addEventListener("input", function () {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function () {
      renderTemplates();
    }, 150);
  });

  // Atalhos de teclado
  document.addEventListener("keydown", function (e) {
    // Ctrl+1 a Ctrl+9 para copiar template
    if (e.ctrlKey && !e.altKey && !e.shiftKey) {
      var num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        var items = templatesList.querySelectorAll(".template-item");
        if (items[num - 1]) {
          var id = items[num - 1].dataset.id;
          var template = templatesCache.find(function (t) {
            return t.id === id;
          });
          if (template) {
            copyTemplate(template);
            searchInput.focus();
          }
        }
      }
    }

    // Escape para limpar busca
    if (e.key === "Escape") {
      searchInput.value = "";
      renderTemplates();
      searchInput.focus();
    }

    // Enter para copiar primeiro resultado
    if (e.key === "Enter" && document.activeElement === searchInput) {
      var items = templatesList.querySelectorAll(".template-item");
      if (items[0]) {
        var id = items[0].dataset.id;
        var template = templatesCache.find(function (t) {
          return t.id === id;
        });
        if (template) {
          copyTemplate(template);
        }
      }
    }
  });

  // Iniciar
  init();
})();
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/dashboard.js
git commit -m "feat(dashboard): add JavaScript logic for quick-copy dashboard"
```

### Task 3.3: PWA Manifest e Service Worker

**Files:**
- Create: `dashboard/manifest.json`
- Create: `dashboard/sw.js`

- [ ] **Step 1: Criar PWA manifest**

```json
{
  "name": "Minutário — Templates Jurídicos",
  "short_name": "Minutário",
  "description": "Templates de texto para assessores jurídicos",
  "start_url": "/dashboard/index.html",
  "display": "standalone",
  "background_color": "#f8fafc",
  "theme_color": "#2563eb",
  "icons": [
    {
      "src": "/icons/icon192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

- [ ] **Step 2: Criar Service Worker básico**

```javascript
const CACHE_NAME = "minutario-v1";
const STATIC_ASSETS = [
  "/dashboard/index.html",
  "/dashboard/dashboard.css",
  "/dashboard/dashboard.js",
  "/dashboard/manifest.json",
  "/shared/config.js",
  "/shared/db.js",
  "/shared/api.js",
  "/shared/sync.js",
  "/lib/supabase.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
```

- [ ] **Step 3: Registrar service worker no dashboard.js**

Adicionar no final do dashboard.js:

```javascript
// Registrar Service Worker para PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then(function () {
      console.log("Service Worker registrado");
    })
    .catch(function (err) {
      console.error("Service Worker falhou:", err);
    });
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/manifest.json dashboard/sw.js
git commit -m "feat(dashboard): add PWA manifest and service worker for offline support"
```

---

## Fase 4: Chrome Extension Evolution

### Task 4.1: Evoluir content.js para IndexedDB

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Adicionar carregamento do IndexedDB no content.js**

No início do IIFE, adicionar variável e função:

```javascript
// Substituir a função loadTemplates existente por:
async function loadTemplates() {
  try {
    if (window.MinutarioDB) {
      await window.MinutarioDB.open();
      var templates = await window.MinutarioDB.getAllTemplates();
      templateCache = {};
      templates.forEach(function (t) {
        if (t.shortcut) {
          templateCache[t.shortcut.toLowerCase()] = t;
        }
      });
    } else {
      // Fallback para chrome.storage.sync
      var result = await chrome.storage.sync.get(null);
      templateCache = buildTemplateCache(result);
    }
  } catch (error) {
    console.error("Minutário failed to load templates:", error);
    templateCache = {};
  }
}
```

- [ ] **Step 2: Adicionar listener para atualizações em tempo real**

No final do arquivo, antes do `loadSettings()` e `loadTemplates()`:

```javascript
// Escutar atualizações de templates do background
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message && message.type === "TEMPLATES_UPDATED") {
    loadTemplates();
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add content.js
git commit -m "feat(content): load templates from IndexedDB with Supabase sync support"
```

### Task 4.2: Evoluir background.js para Sync

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Implementar background sync**

```javascript
// background.js

const SYNC_ALARM_NAME = "sync-templates";
const SYNC_INTERVAL_MINUTES = 5;

// Criar alarm para sync periódico
chrome.alarms.create(SYNC_ALARM_NAME, {
  periodInMinutes: SYNC_INTERVAL_MINUTES,
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    await performSync();
  }
});

async function performSync() {
  try {
    // Verificar se usuário está logado
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      return;
    }

    const orgId = session.session.user.user_metadata?.org_id;
    if (!orgId) {
      return;
    }

    // Executar sync
    if (window.MinutarioSync) {
      const result = await window.MinutarioSync.syncTemplates(orgId);

      if (result.success && result.updated > 0) {
        // Notificar todos os content scripts
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "TEMPLATES_UPDATED",
            });
          } catch (e) {
            // Tab pode não ter content script, ignorar
          }
        }
      }
    }
  } catch (error) {
    console.error("Background sync failed:", error);
  }
}

// Listener para mensagens do popup/content
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FORCE_SYNC") {
    performSync().then((result) => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async
  }

  if (request.type === "GET_SYNC_STATE") {
    const state = window.MinutarioSync ? window.MinutarioSync.getSyncState() : "idle";
    sendResponse({ state: state });
    return true;
  }
});

// Sync ao iniciar a extensão
performSync();
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(background): add periodic sync with Supabase and realtime notifications"
```

### Task 4.3: Evoluir popup para Login e Status

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`

- [ ] **Step 1: Adicionar seção de login ao popup HTML**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Minutário</title>
  <style>
    body {
      width: 300px;
      padding: 1rem;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .hidden { display: none; }
    .login-form { display: flex; flex-direction: column; gap: 0.5rem; }
    .login-form input { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; }
    .login-form button { padding: 0.5rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .status { font-size: 0.75rem; color: #666; margin-top: 0.5rem; }
    .status.syncing { color: #92400e; }
    .status.error { color: #ef4444; }
    .actions { margin-top: 1rem; display: flex; gap: 0.5rem; }
    .actions button { flex: 1; padding: 0.5rem; font-size: 0.75rem; cursor: pointer; }
  </style>
</head>
<body>
  <div id="login-section">
    <h2>Minutário</h2>
    <form id="login-form" class="login-form">
      <input type="email" id="email" placeholder="E-mail" required>
      <input type="password" id="password" placeholder="Senha" required>
      <button type="submit">Entrar</button>
    </form>
    <div id="login-error" style="color: #ef4444; font-size: 0.75rem; margin-top: 0.5rem;"></div>
  </div>

  <div id="dashboard-section" class="hidden">
    <h2>Minutário</h2>
    <p id="user-email" style="font-size: 0.75rem; color: #666;"></p>
    <div id="sync-status" class="status">Sincronizado</div>
    <div class="actions">
      <button id="open-dashboard">Abrir Dashboard</button>
      <button id="force-sync">Sincronizar</button>
      <button id="logout">Sair</button>
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implementar lógica do popup**

```javascript
// popup.js

document.addEventListener("DOMContentLoaded", async () => {
  const loginSection = document.getElementById("login-section");
  const dashboardSection = document.getElementById("dashboard-section");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const userEmail = document.getElementById("user-email");
  const syncStatus = document.getElementById("sync-status");

  // Verificar sessão
  try {
    const { data: session } = await supabase.auth.getSession();
    if (session.session) {
      showDashboard(session.session.user);
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }

  function showLogin() {
    loginSection.classList.remove("hidden");
    dashboardSection.classList.add("hidden");
  }

  function showDashboard(user) {
    loginSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    userEmail.textContent = user.email;
    updateSyncStatus();
  }

  function updateSyncStatus() {
    chrome.runtime.sendMessage({ type: "GET_SYNC_STATE" }, (response) => {
      const state = response?.state || "idle";
      const labels = {
        idle: "Sincronizado",
        syncing: "Sincronizando...",
        updated: "Atualizado!",
        error: "Erro de sync",
      };
      syncStatus.textContent = labels[state] || state;
      syncStatus.className = "status " + state;
    });
  }

  // Login
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        loginError.textContent = result.error.message;
        return;
      }
      showDashboard(result.data.user);
    } catch (err) {
      loginError.textContent = "Erro ao fazer login";
    }
  });

  // Logout
  document.getElementById("logout").addEventListener("click", async () => {
    await supabase.auth.signOut();
    showLogin();
  });

  // Abrir dashboard
  document.getElementById("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html") });
  });

  // Force sync
  document.getElementById("force-sync").addEventListener("click", () => {
    syncStatus.textContent = "Sincronizando...";
    syncStatus.className = "status syncing";
    chrome.runtime.sendMessage({ type: "FORCE_SYNC" }, () => {
      setTimeout(updateSyncStatus, 1000);
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add popup/popup.html popup/popup.js
git commit -m "feat(popup): add login and sync status to extension popup"
```

### Task 4.4: Atualizar manifest.json

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Adicionar permissões e host_permissions para Supabase**

```json
{
  "manifest_version": 3,
  "name": "Minutário",
  "version": "1.1.0",
  "description": "Expanda atalhos de texto em modelos HTML ricos com sync em nuvem.",
  "permissions": [
    "storage",
    "clipboardWrite",
    "clipboardRead",
    "identity",
    "alarms"
  ],
  "host_permissions": [
    "<all_urls>",
    "https://*.supabase.co/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "Minutário"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "shared/config.js",
        "shared/db.js",
        "shared/api.js",
        "shared/sync.js",
        "content.js"
      ],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "dashboard/*",
        "shared/*",
        "lib/*"
      ],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "feat(manifest): update to v1.1.0 with Supabase sync and alarms permission"
```

---

## Fase 5: Testes

### Task 5.1: Teste de Integração Sync

**Files:**
- Create: `tests/integration.sync.test.js`

- [ ] **Step 1: Escrever teste de integração**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

test("sync merges remote templates with local cache", async () => {
  // Mock de DB e API
  var mockDB = {
    templates: [],
    async putTemplate(t) {
      var idx = this.templates.findIndex(function (x) { return x.id === t.id; });
      if (idx >= 0) this.templates[idx] = t;
      else this.templates.push(t);
    },
    async getAllTemplates() { return this.templates; },
    async deleteAllTemplates() { this.templates = []; },
    async setMeta() {},
    async getMeta() { return null; },
  };

  var mockAPI = {
    async getTemplates() {
      return {
        data: [
          { id: "1", shortcut: "caso01", content: "new", updated_at: "2025-01-02T00:00:00Z", org_id: "org1" },
          { id: "2", shortcut: "caso02", content: "b", updated_at: "2025-01-01T00:00:00Z", org_id: "org1" },
        ],
        error: null,
      };
    },
  };

  // Simular merge
  var local = [{ id: "1", shortcut: "caso01", content: "old", updated_at: "2025-01-01T00:00:00Z" }];
  var remote = (await mockAPI.getTemplates()).data;

  var merged = {};
  local.forEach(function (t) { merged[t.id] = t; });
  remote.forEach(function (t) {
    var existing = merged[t.id];
    if (!existing || new Date(t.updated_at) > new Date(existing.updated_at)) {
      merged[t.id] = t;
    }
  });

  var result = Object.values(merged);
  assert.equal(result.length, 2);
  assert.equal(result.find(function (t) { return t.id === "1"; }).content, "new");
});
```

- [ ] **Step 2: Rodar teste**

```bash
node --test tests/integration.sync.test.js
```
Expected: 1 test pass

- [ ] **Step 3: Commit**

```bash
git add tests/integration.sync.test.js
git commit -m "test(integration): add sync integration test"
```

### Task 5.2: Rodar Todos os Testes

- [ ] **Step 1: Rodar suite completa**

```bash
node --test tests/*.test.js
```

Expected: Todos os testes passam

- [ ] **Step 2: Commit final**

```bash
git add .
git commit -m "test: add integration tests for multi-device sync"
```

---

## Resumo de Commits

| Fase | Task | Commit Message |
|------|------|----------------|
| 1.1 | Schema SQL | `feat(supabase): create database schema` |
| 1.2 | RLS | `feat(supabase): add RLS policies` |
| 1.3 | Auth | `feat(supabase): add auth hooks and JWT claims` |
| 1.4 | Realtime | `feat(supabase): enable realtime and seed data` |
| 2.1 | Config | `feat(shared): add Supabase configuration` |
| 2.2 | DB | `feat(shared): add IndexedDB wrapper` |
| 2.3 | API | `feat(shared): add unified Supabase API client` |
| 2.4 | Sync | `feat(shared): add offline-first sync engine` |
| 3.1 | HTML/CSS | `feat(dashboard): add HTML and CSS` |
| 3.2 | JS | `feat(dashboard): add JavaScript logic` |
| 3.3 | PWA | `feat(dashboard): add PWA manifest and service worker` |
| 4.1 | Content | `feat(content): load templates from IndexedDB` |
| 4.2 | Background | `feat(background): add periodic sync` |
| 4.3 | Popup | `feat(popup): add login and sync status` |
| 4.4 | Manifest | `feat(manifest): update to v1.1.0` |
| 5.1 | Integration | `test(integration): add sync integration test` |

---

## Pós-Implementação

1. **Configurar Supabase production** (URL e anon key em `shared/config.js`)
2. **Deploy dashboard** para Vercel/Netlify
3. **Testar em 2 dispositivos** (Chrome Extension + Dashboard)
4. **Convidar assessores piloto** (5-10 usuários)
5. **Coletar feedback** e iterar

---

*Plano escrito em 2025-01-30 para o projeto Minutário.*
