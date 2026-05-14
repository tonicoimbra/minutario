# Minutário Desktop — Plano de Implementação

App desktop Windows (Tauri + Rust + Web) para expansão de atalhos de texto no Word e qualquer aplicativo. Roda em paralelo com a extensão Chrome — mesmo usuário, mesmo Supabase, mesma base de templates.

---

## Sprint 1 — Fundação do projeto Tauri

### 1.1 — Scaffold do projeto Tauri

- Instalar Rust toolchain (`rustup`) e Tauri CLI (`cargo install tauri-cli`)
- Criar projeto com `cargo create-tauri-app minutario-desktop`
  - Frontend: HTML/CSS/JS puro (sem framework), compatível com o dashboard atual
  - Backend: Rust
- Configurar `tauri.conf.json`:
  - `identifier`: `com.minutario.desktop`
  - `windows[0]`: janela principal do dashboard (1024×768, centrada, sem `_allow_global_shortcuts`)
  - `systemTray`: habilitado com ícone da bandeja
  - `bundle.targets`: `["msi", "nsis"]`
- Verificar build: `cargo tauri build` deve gerar executável sem erros
- Commit inicial com estrutura funcional

### 1.2 — Estrutura de diretórios

```
minutario-desktop/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # entry point Tauri
│   │   ├── hooks/
│   │   │   ├── mod.rs
│   │   │   └── keyboard.rs      # global keyboard hook (Win32)
│   │   ├── clipboard/
│   │   │   ├── mod.rs
│   │   │   └── manager.rs       # clipboard HTML + paste simulado
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   └── sqlite.rs        # SQLite local (substitui IndexedDB)
│   │   └── tray.rs              # system tray ícone e menu
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── src/                          # frontend web (reaproveitado da extensão)
│   ├── index.html                # janela principal (dashboard)
│   ├── css/
│   │   └── dashboard.css         # copiado de dashboard/dashboard.css
│   ├── js/
│   │   ├── dashboard.js          # adaptado de dashboard/dashboard.js
│   │   ├── shared/
│   │   │   ├── config.js         # MinutarioConfig (Supabase URL/key)
│   │   │   ├── api.js            # MinutarioAPI (adaptado para Tauri invoke)
│   │   │   └── sync.js           # MinutarioSync (adaptado)
│   │   └── lib/
│   │       ├── quill.min.js
│   │       └── papaparse.min.js
│   └── assets/
│       └── icons/
└── package.json                  # scripts de build frontend (se necessário)
```

### 1.3 — Configuração do WebView

- Janela principal carrega `src/index.html` com o dashboard completo
- Habilitar `devtools` em modo debug (`tauri.conf.json` → `build.devtools: true`)
- Configurar CSP para permitir carregamento dos scripts locais e CDN Supabase
- Testar: dashboard renderiza com Quill editor funcional dentro do WebView2

### 1.4 — System tray

- Ícone na bandeja do Windows (reaproveitar `icons/icon16.png` da extensão)
- Menu do tray:
  - "Abrir Minutário" → abre/foca a janela do dashboard
  - "Expansão: Ativada ✓" / "Expansão: Desativada" → toggle do hook de teclado
  - "Sair" → encerra o app completamente
- App continua rodando em background ao fechar a janela (hide ao invés de close)
- Verificar: ícone aparece na bandeja, menu funcional, app não morre ao fechar janela

---

## Sprint 2 — Armazenamento local (SQLite)

### 2.1 — Schema do banco SQLite

- Criar `src-tauri/src/db/sqlite.rs` com inicialização do banco
- Adicionar dependência `rusqlite` no `Cargo.toml` (com feature `bundled` para não depender de SQLite no sistema)
- Schema:

```sql
CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    shortcut    TEXT NOT NULL,
    content     TEXT NOT NULL,
    plain_text  TEXT NOT NULL DEFAULT '',
    folder_id   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at  TEXT,
    UNIQUE(user_id, shortcut)
);

CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_shortcut ON templates(user_id, shortcut);

CREATE TABLE IF NOT EXISTS folders (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    order_idx   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

- Banco armazenado em `app_data_dir()` do Tauri (compatível com Roaming no Windows)
- Criar tabela `settings` com chave-valor para `triggerChar`, `triggerKey`, `userId`, etc.
- Migration automática ao iniciar (CREATE IF NOT EXISTS)

### 2.2 — CRUD via Tauri Commands

- Implementar commands Tauri (Rust → JS) para o frontend:
  - `get_templates(user_id)` → retorna todos os templates ativos do usuário
  - `get_template(id)` → retorna template por ID
  - `save_template(template)` → insert ou update
  - `delete_template(id)` → soft delete (set `deleted_at`)
  - `get_folders(user_id)` → lista pastas
  - `save_folder(folder)` → insert ou update
  - `delete_folder(id)` → soft delete
  - `get_setting(key)` → busca setting
  - `set_setting(key, value)` → salva setting
- Cada command retorna `Result<T, String>` para tratamento de erro no frontend
- Serialização com `serde_json` — structs Rust com `#[derive(Serialize, Deserialize)]`

### 2.3 — Adaptação do frontend para usar Tauri Commands

- Criar wrapper `src/js/shared/db.js` que substitui `MinutarioDB`:
  - Em vez de IndexedDB direto, chama `window.__TAURI__.invoke('get_templates', { userId })`
  - Manter a mesma interface (mesmos nomes de função) para minimizar mudanças no `dashboard.js`
- Adaptar `dashboard.js`:
  - Trocar chamadas `chrome.storage.*` por `invoke('get_setting')` / `invoke('set_setting')`
  - Trocar `indexedDB` por chamadas Tauri
- Testar: CRUD completo de templates e pastas funciona no dashboard via SQLite

---

## Sprint 3 — Keyboard Hook Global (Win32)

### 3.1 — Hook de teclado low-level

- Implementar em `src-tauri/src/hooks/keyboard.rs`
- Usar Win32 API via crate `windows`:
  - `SetWindowsHookExW` com `WH_KEYBOARD_LL`
  - `LowLevelKeyboardProc` callback
  - `GetMessageW` loop em thread dedicada
- Capturar: `vkCode`, `flags` (detectar keydown vs keyup), `scanCode`
- Mapear `vkCode` para caracteres usando `MapVirtualKeyW` e `ToUnicode` (considerar teclado ABNT2/ABNT)
- Filtrar eventos do próprio WebView do Tauri (não processar teclas quando o dashboard estiver focado, a menos que seja um campo de texto específico)

### 3.2 — Buffer e detecção de atalho

- Manter buffer circular de caracteres digitados (últimos ~50 caracteres)
- Quando o buffer terminar com `{triggerChar}{shortcut} ` (ex: `/contrato `):
  1. Extrair o shortcut (texto entre `/` e ` `)
  2. Consultar template no SQLite pelo `shortcut` do usuário logado
  3. Se encontrado, acionar rotina de expansão
  4. Se não encontrado, ignorar (buffer continua)
- Configurações carregadas do SQLite:
  - `triggerChar` (default: `/`)
  - `triggerKey` (default: `Space`)
- Casos especiais:
  - Backspace → remove último caractere do buffer
  - Escape → limpa o buffer
  - Troca de janela/foco → limpa o buffer
  - Teclas modificadoras sozinhas (Ctrl, Alt, Shift) → não adicionam ao buffer

### 3.3 — Toggle e estado do hook

- Command Tauri `toggle_hook(enabled: bool)` → ativa/desativa o hook
- Estado padrão: ativado ao iniciar o app
- Menu do tray reflete o estado atual
- Persistir estado em `settings` para restaurar ao reiniciar
- Atalho global para toggle (ex: `Ctrl+Alt+M`) via `tauri.conf.json` → `globalShortcut`

---

## Sprint 4 — Expansão de texto (clipboard + paste)

### 4.1 — Copiar HTML para clipboard

- Implementar em `src-tauri/src/clipboard/manager.rs`
- Usar Win32 API para clipboard:
  - `OpenClipboard` / `CloseClipboard`
  - `SetClipboardData` com formato `CF_HTML` (HTML Format) e `CF_UNICODETEXT` (texto puro)
- Formato HTML do clipboard requer header específico:
  ```
  Version:0.9
  StartHTML:0000000105
  EndHTML:0000000300
  StartFragment:0000000140
  EndFragment:0000000260
  <html><body><!--StartFragment-->{conteúdo}<!--EndFragment--></body></html>
  ```
- Implementar função `set_clipboard_html(html: &str, plain_text: &str)` que registra ambos os formatos
- Testar: colar no Word mantém formatação (negrito, itálico, listas, tabelas)

### 4.2 — Limpar atalho digitado

- Após detectar o atalho e antes de colar:
  1. Calcular comprimento do atalho (`triggerChar + shortcut + triggerKey` = ex: `/contrato ` = 10 caracteres)
  2. Simular N backspaces via `SendInput` (Win32) para apagar o que foi digitado
- Pausa mínima entre backspaces (~5ms) para Word processar
- Verificar: texto do atalho some completamente antes da colagem

### 4.3 — Simular Ctrl+V (paste)

- Usar `SendInput` (Win32 `user32`) para simular:
  - `KeyDown(Ctrl)` → `KeyDown(V)` → `KeyUp(V)` → `KeyUp(Ctrl)`
- Pausa entre keydown e keyup (~10ms)
- Restaurar clipboard original após paste (opcional, para não poluir clipboard do usuário)
- Testar em:
  - Microsoft Word (Office 365 / 2021+)
  - Bloco de notas (texto puro)
  - LibreOffice Writer
  - Outlook desktop
  - Campos de texto de outros apps

### 4.4 — Fluxo completo de expansão

Sequência implementada no Rust:

```
1. Hook detecta "/contrato " no buffer
2. Consulta SQLite → encontra template com shortcut "contrato"
3. Salva clipboard atual do usuário (para restaurar depois)
4. Limpa buffer interno
5. Simula N× Backspace (apaga "/contrato ")
6. Copia HTML do template para clipboard (CF_HTML + CF_UNICODETEXT)
7. Aguarda 20ms
8. Simula Ctrl+V
9. Aguarda 100ms
10. Restaura clipboard original do usuário
```

- Se o app alvo não aceitar HTML, o fallback `CF_UNICODETEXT` entrega texto puro
- Adicionar timeout máximo de 2s para toda a operação (evitar travamento)

---

## Sprint 5 — Supabase Sync (adaptado para Tauri)

### 5.1 — Módulo de API Supabase em Rust

- Implementar em `src-tauri/src/sync/` (ou via frontend com fetch no WebView)
- **Decisão de arquitetura**: usar `reqwest` no Rust OU fetch no WebView (ambos funcionam)
  - Recomendação: usar fetch no WebView (JavaScript) para maximizar reaproveitamento do `shared/api.js`
  - Adaptar `shared/api.js`:
    - Remover dependência de `chrome.storage` → usar `window.__TAURI__.invoke('get_setting')`
    - Remover dependência de `createClient` do `lib/supabase.min.js` (carregar via `<script>`)
    - Auth: substituir `chrome.storage.local` por `invoke('set_setting')` para tokens
- Mesma lógica de camelCase ↔ snake_case do `shared/api.js` original

### 5.2 — Módulo de sync bidirecional

- Adaptar `shared/sync.js` para Tauri:
  - `pushTemplates()` → envia templates locais modificados para Supabase
  - `pullTemplates()` → baixa templates remotos e salva no SQLite
  - Merge: manter versão com `updated_at` mais recente (mesma lógica atual)
- Mesma lógica de `minutario_last_sync` timestamp
- Trigger de sync:
  - Ao abrir o app
  - Ao criar/editar/deletar template
  - A cada 5 minutos (alarm)
  - Manual via botão no dashboard
- Conflict resolution: `updated_at` wins (idêntico à extensão)

### 5.3 — Login / Auth

- Tela de login no WebView (adaptar do popup da extensão)
- Usar Supabase Auth (email + senha) — mesma conta da extensão
- Armazenar tokens em SQLite (`settings` table):
  - `auth_access_token`
  - `auth_refresh_token`
  - `auth_user_id`
- Auto-refresh token antes de expirar
- Se não logado, dashboard funciona em modo offline (apenas templates locais)

---

## Sprint 6 — Quick Access (janela flutuante)

### 6.1 — Janela de consulta rápida

- Segunda janela Tauri (sem borda ou com borda fina, tipo popup)
- Atalho global `Ctrl+Shift+K` abre a janela (igual extensão)
- Conteúdo: barra de busca + lista de templates + preview formatado
- Ao selecionar um template:
  - Copia HTML para clipboard
  - Fecha a janela
  - Simula Ctrl+V no app que estava em foco antes de abrir a janela
- Adaptar `quick-access/` da extensão para Tauri WebView

### 6.2 — Gerenciamento de foco

- Ao abrir Quick Access: salvar qual janela/app estava em foco (`GetForegroundWindow`)
- Ao fechar: restaurar foco para o app anterior antes de simular Ctrl+V
- Janela sempre no topo (`always_on_top: true` no Tauri)
- Fechar ao pressionar Escape ou clicar fora

---

## Sprint 7 — Polimento e distribuição

### 7.1 — Auto-start com Windows

- Registrar no registry via Tauri (`tauri-plugin-autostart`)
  - `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- Toggle no dashboard: "Iniciar com o Windows"
- Estado persistido em SQLite

### 7.2 — Atualização automática

- Configurar `tauri-plugin-updater`
- Endpoint de update: hospedar JSON de versão + assinatura em CDN ou Supabase Storage
- Verificar ao iniciar e a cada 24h
- Download em background, instalar ao reiniciar

### 7.3 — Build e empacotamento

- `cargo tauri build` gera:
  - `.msi` (instalador Windows Installer)
  - `.exe` via NSIS (instalador com desinstalador)
  - Ou executável portátil (single-file)
- Ícone do app (`.ico`) a partir do `icon128.png` da extensão
- Versionamento sincronizado com `package.json` da extensão (ler versão de um arquivo compartilhado)
- Testar instalação em Windows 11 limpo (sem Rust, sem Node)

### 7.4 — Testes manuais finais

- [ ] Expansão funciona no Word 365
- [ ] Expansão funciona no Word 2021
- [ ] Expansão funciona no Outlook desktop
- [ ] Expansão funciona no LibreOffice Writer
- [ ] Expansão funciona no Bloco de Notas (texto puro)
- [ ] Expansão funciona em campos de texto de outros apps (WhatsApp Desktop, Telegram, etc.)
- [ ] Dashboard CRUD completo funciona
- [ ] CSV import/export funciona
- [ ] Supabase sync bidirecional funciona (mesmo usuário na extensão e no desktop)
- [ ] Quick Access (Ctrl+Shift+K) funciona
- [ ] System tray funciona
- [ ] Auto-start funciona
- [ ] Login/Logout funciona
- [ ] App funciona sem internet (modo offline)
- [ ] Atualização automática funciona
- [ ] Desinstalação limpa arquivos

---

## Dependências entre sprints

```
Sprint 1 (fundação)
  ├── Sprint 2 (SQLite) → Sprint 3 (hook) → Sprint 4 (expansão)
  └── Sprint 5 (sync) ──────── depende de Sprint 2
Sprint 6 (Quick Access) → depende de Sprint 4
Sprint 7 (polimento) → depende de todos
```

## Stack final

| Componente | Tecnologia |
|---|---|
| Runtime | Tauri 2.x |
| Backend | Rust (Win32 API, SQLite) |
| Frontend | HTML/CSS/JS puro (mesmo da extensão) |
| Editor rich-text | Quill.js (bundled) |
| Banco local | SQLite (via `rusqlite` bundled) |
| Sync remoto | Supabase (mesma instância da extensão) |
| Keyboard hook | Win32 `SetWindowsHookEx` (via crate `windows`) |
| Clipboard | Win32 Clipboard API (`CF_HTML`, `CF_UNICODETEXT`) |
| Paste simulado | Win32 `SendInput` |
| System tray | `tauri-plugin-tray` |
| Auto-start | `tauri-plugin-autostart` |
| Updater | `tauri-plugin-updater` |
| Instalador | NSIS ou MSI |
