# Minutário

**Extensão Chrome para expansão de texto em qualquer página do navegador.**

Desenvolvido por **Elvertoni Coimbra**.

---

## O que é

O Minutário permite criar atalhos de texto que se expandem em conteúdo HTML rico. Por exemplo, digite `/contrato` seguido de **Espaço** em qualquer campo de texto, textarea ou editor rich-text, e o atalho é automaticamente substituído pelo modelo correspondente.

Funciona em qualquer site: Word Online, Google Docs, e-mails, formulários, etc.

---

## Funcionalidades

- **Expansão de texto em qualquer página** (`<all_urls>`)
- **Editor rich-text** (Quill.js) para criar modelos com formatação
- **Organização por pastas**
- **Importação/Exportação CSV** — carregue ou baixe todos os templates em massa
- **Sincronização Supabase** — sincronização em tempo real na nuvem com merge inteligente
- **Consulta rápida em janela própria** — busque, visualize e copie minutas com formatação rica
- **Busca rápida** por nome ou atalho

---

## Instalação

1. Abra `chrome://extensions` no Chrome
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta deste projeto

A extensão aparecerá na barra de ferramentas. Clique no ícone para abrir o popup, e depois em **Consulta Rápida** ou **Abrir Dashboard** conforme o fluxo desejado.

---

## Como usar

### Criar um template

1. Abra o **Dashboard** (clique no ícone da extensão → Dashboard)
2. Clique em **+ Novo Template**
3. Preencha:
   - **Nome**: nome descritivo do template
   - **Atalho**: texto curto sem espaços (ex: `contrato`, `despacho`). Será usado como `/contrato`
   - **Pasta**: opcional, para organizar
   - **Conteúdo**: use o editor rich-text para formatar
4. Clique em **Salvar**

### Usar um template

Em qualquer campo de texto, textarea ou editor contenteditable:
1. Digite `/` seguido do atalho (ex: `/contrato`)
2. Pressione **Espaço**
3. O texto será substituído pelo conteúdo do template

### Consulta rápida

1. Clique no ícone da extensão
2. Clique em **Consulta Rápida**
3. Pesquise por nome, atalho ou `/comando`
4. Confira o preview do conteúdo
5. Clique em **📋 Copiar** ou pressione **Enter**
6. Volte ao aplicativo original e cole com `Ctrl+V`

**Atalho da extensão:** `Ctrl+Shift+K` (`Command+Shift+K` no macOS) com o Chrome em foco abre a janela de consulta rápida.

---

## Importação e Exportação CSV

### Formato do CSV

Arquivo `.csv` com as colunas (case-insensitivo):

```csv
name,shortcut,folder,content
"Contrato de Prestação","contrato","Documentos","<p>Contrato de prestação de serviços...</p>"
"Despacho Padrão","despacho","Processos","<p>Vistos em autos...</p>"
```

| Coluna | Obrigatória | Descrição |
|---|---|---|
| `name` | Sim | Nome do template |
| `shortcut` | Sim | Atalho (sem o `/`) |
| `folder` | Não | Nome da pasta (será mapeada para pasta existente) |
| `content` | Sim | Conteúdo HTML do template |

### Importar

1. No Dashboard, clique em **📁 Importar CSV**
2. Selecione o arquivo `.csv`
3. Se houver conflitos de atalho, uma confirmação será exibida
4. Os templates serão importados e salvos automaticamente

### Exportar

1. No Dashboard, clique em **💾 Exportar CSV**
2. O arquivo `minutario-templates.csv` será baixado automaticamente

---

## Supabase Sync

### O que faz

Sincronização bidirecional em tempo real:
- Envia seus templates locais para a nuvem (push)
- Baixa templates da nuvem (pull)
- Merge inteligente: mantém a versão mais recente por `updatedAt`
- Acesse seus templates de qualquer dispositivo

### Configuração (obrigatória antes de usar)

1. Crie uma conta em [Supabase](https://supabase.com/) e um novo projeto
2. No SQL Editor do Supabase, execute:
   ```sql
   create table templates (
     id uuid primary key,
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
     id uuid primary key,
     user_id uuid references auth.users not null,
     name text not null,
     order_idx int default 0
   );
   ```
3. No dashboard do Supabase, vá em **Project Settings → API** e copie:
   - **Project URL**
   - **anon/public** API key
4. No arquivo `shared/config.js`, substitua:
   ```js
   SUPABASE_URL: "https://sua-url-do-projeto.supabase.co",
   SUPABASE_ANON_KEY: "sua-anon-key",
   PASSWORD_RESET_REDIRECT_URL: ""
   ```
5. Recarregue a extensão em `chrome://extensions`

Para recuperação de senha, configure `PASSWORD_RESET_REDIRECT_URL` se quiser fixar uma URL de reset. Se deixar vazio, a extensão usa `password-reset/password-reset.html` via `chrome.runtime.getURL()`/`browser.runtime.getURL()`. A URL final precisa estar cadastrada em **Supabase → Authentication → URL Configuration → Redirect URLs**.

### Usar

1. No Dashboard, clique em **🔄 Sync Supabase**
2. Na primeira vez, insira seu **email** e **senha** fornecidos pelo administrador
3. Clique em **Entrar**
4. A sincronização bidirecional ocorre automaticamente

**Importante:** O cadastro público no popup está desativado para simplificar a experiência do usuário final. Crie usuários no Supabase em **Authentication → Users → Add user**.

---

## Distribuição Piloto (manual)

### 1. Geração de pacotes

```bash
npm install
npm run release:pilot
```

Release com bump automático de versão:

```bash
npm run release:pilot:full:patch   # 1.1.0 -> 1.1.1
npm run release:pilot:full:minor   # 1.1.0 -> 1.2.0
```

Artefatos gerados:
- `dist/chrome/minutario-chrome-vX.Y.Z.zip`
- `dist/firefox/minutario-firefox-vX.Y.Z.zip`
- `dist/firefox/minutario-firefox/` (pasta para teste temporário no Firefox)

### 2. Chrome (usuário final)

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação**
4. Selecione a pasta da extensão

### 3. Firefox (usuário final)

Para teste temporário, use `about:debugging` → **This Firefox** → **Load Temporary Add-on** → selecione `dist/firefox/minutario-firefox/manifest.json`.

Para Firefox estável, distribua **somente .xpi assinado**.

1. Defina variáveis de ambiente no PowerShell:
   ```powershell
   $env:AMO_JWT_ISSUER="seu_issuer"
   $env:AMO_JWT_SECRET="seu_secret"
   ```
2. Gere o pacote assinado:
   ```bash
   npm run sign:firefox
   ```
3. Entregue o `.xpi` gerado em `dist/firefox/` aos usuários.

### 4. Chaves Supabase

- Use na extensão apenas:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY` (chave pública/publishable)
- Nunca embuta `service_role`/secret na extensão.
- Segurança de dados deve ficar em `Auth + RLS` (políticas por `auth.uid()`).

---

## Testes

```bash
npm test
```

Roda todos os testes automatizados via `node:test` + jsdom.

---

## Arquitetura

| Arquivo | Função |
|---|---|
| `manifest.json` | Manifesto MV3 — permissões, content scripts |
| `background.js` | Service worker — roteador de mensagens |
| `content.js` | Script injetado em todas as páginas — listener de teclas e expansão |
| `popup/` | Popup da barra de ferramentas |
| `quick-access/` | Janela rápida — busca, preview e cópia de minutas |
| `dashboard/` | Dashboard completo — CRUD de templates, pastas, importação e sync |
| `dashboard/sync/csv.js` | Parser e importador de CSV |
| `dashboard/sync/supabase.js` | Integração com Supabase (auth + sync) |
| `dashboard/sync/index.js` | Facade de sincronização local/Supabase |
| `lib/` | Bibliotecas bundladas (Quill, PapaParse, Supabase) — funcionam offline |

---

## Tecnologias

- Chrome Extension Manifest V3
- Vanilla JavaScript (ES5/ES2017, sem build step)
- Quill.js (editor rich-text)
- PapaParse (parser CSV)
- Supabase JS Client (sync em nuvem)
- jsdom + node:test (testes)

---

## Licença

Projeto desenvolvido por Elvertoni Coimbra.
