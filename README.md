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
- **Backup Google Drive** — sincronize seus templates com o Google Drive
- **Sincronização Supabase** — sincronização em tempo real na nuvem com merge inteligente
- **Busca rápida** por nome ou atalho

---

## Instalação

1. Abra `chrome://extensions` no Chrome
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta deste projeto

A extensão aparecerá na barra de ferramentas. Clique no ícone para abrir o popup, e depois em **Dashboard** para gerenciar seus templates.

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

## Google Drive Sync

### O que faz

- **Backup Drive**: salva todos os templates em um arquivo JSON no seu Google Drive
- **Restaurar Drive**: substitui os templates locais pelo backup do Drive

### Configuração (obrigatória antes de usar)

1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto (ou use um existente)
3. Vá em **APIs e Serviços → Credenciais → Criar credenciais → ID do cliente OAuth**
4. Selecione **Aplicativo Chrome** como tipo
5. Em **ID do aplicativo**, insira o ID da sua extensão Chrome (você pode encontrá-lo em `chrome://extensions` após carregar a extensão)
6. Copie o **ID do cliente** (Client ID)
7. No arquivo `manifest.json`, substitua o placeholder:
   ```json
   "oauth2": {
     "client_id": "SEU_CLIENT_ID.apps.googleusercontent.com",
     "scopes": [
       "https://www.googleapis.com/auth/drive.file"
     ]
   }
   ```
8. Recarregue a extensão em `chrome://extensions`

### Usar

1. No Dashboard, clique em **☁️ Backup Drive** para salvar
2. Clique em **📥 Restaurar Drive** para recuperar

**Nota:** A primeira vez que usar, o Chrome pedirá permissão para acessar o Google Drive.

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
4. No arquivo `dashboard/sync/supabase.js`, substitua:
   ```js
   var SUPABASE_URL = "https://sua-url-do-projeto.supabase.co";
   var SUPABASE_ANON_KEY = "sua-anon-key";
   ```
5. Recarregue a extensão em `chrome://extensions`

### Usar

1. No Dashboard, clique em **🔄 Sync Supabase**
2. Na primeira vez, insira seu **email** e **senha** do Supabase Auth
3. Clique em **Entrar**
4. A sincronização bidirecional ocorre automaticamente

**Dica:** Você pode criar usuários diretamente no painel do Supabase (Authentication → Users → Add user) ou usar a API.

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
| `dashboard/` | Dashboard completo — CRUD de templates, pastas, importação e sync |
| `dashboard/sync/csv.js` | Parser e importador de CSV |
| `dashboard/sync/drive.js` | Integração com Google Drive (OAuth2) |
| `dashboard/sync/supabase.js` | Integração com Supabase (auth + sync) |
| `dashboard/sync/index.js` | Facade que orquestra os backends de sync |
| `lib/` | Bibliotecas bundladas (Quill, PapaParse, Supabase) — funcionam offline |

---

## Tecnologias

- Chrome Extension Manifest V3
- Vanilla JavaScript (ES5/ES2017, sem build step)
- Quill.js (editor rich-text)
- PapaParse (parser CSV)
- Supabase JS Client (sync em nuvem)
- Google Identity API (OAuth2 para Drive)
- jsdom + node:test (testes)

---

## Licença

Projeto desenvolvido por Elvertoni Coimbra.
