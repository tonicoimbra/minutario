# Minutário Multi-Device — Design Spec

**Data:** 2025-01-30
**Escopo:** Sincronização cross-device, dashboard web para tribunal, evolução Chrome Extension
**Público-alvo:** Assessores de tribunais (50 iniciais, escala para 5000)

---

## 1. Resumo Executivo

O Minutário é uma solução de expansão de templates de texto para assessores jurídicos. A versão atual é uma Chrome Extension que funciona em Word Online, Gmail, ProJudi e outros sites. Este design document especifica a evolução para uma arquitetura multi-device com sincronização por escritório via Supabase, incluindo um dashboard web "Modo Tribunal" para uso em ambientes corporativos onde não é permitida a instalação de software.

**Principais mudanças:**
- Backend Supabase com autenticação, RLS e realtime
- Templates compartilhados por escritório (organização)
- Dashboard web "Quick Copy" para tribunal (Word desktop, sem instalação)
- Chrome Extension evoluída com sync offline-first
- Cache local (IndexedDB) para funcionamento offline

---

## 2. Arquitetura Geral

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENTES                                      │
├─────────────────────────────┬───────────────────────────────────────┤
│  Chrome Extension           │  Dashboard Web (Modo Tribunal)        │
│  (Word Online, Gmail,       │  (Word Desktop, ProJudi desktop,      │
│   ProJudi, Google Docs)     │   qualquer navegador)                 │
│                             │                                       │
│  • Expansão automática      │  • Busca rápida de templates          │
│  • keydown listener         │  • Ctrl+1-9 para copiar               │
│  • contenteditable/textarea │  • Ctrl+V para colar                  │
│                             │                                       │
│  ┌──────────────┐           │  ┌──────────────┐                     │
│  │ content.js   │           │  │ dashboard.js │                     │
│  │ background.js│           │  │ (login, busca│                     │
│  │ popup.js     │           │  │  quick-copy) │                     │
│  └──────┬───────┘           │  └──────┬───────┘                     │
│         │                   │         │                             │
│  ┌──────▼───────┐           │  ┌──────▼───────┐                     │
│  │ IndexedDB    │◄─────────►│  │ IndexedDB    │                     │
│  │ (cache local)│  sync     │  │ (cache local)│                     │
│  └──────┬───────┘           │  └──────┬───────┘                     │
│         │                   │         │                             │
└─────────┼───────────────────┼─────────┼─────────────────────────────┘
          │                   │         │
          │   ┌───────────────▼─────────▼─────────┐
          │   │         SUPABASE                  │
          │   │  ┌─────────┐  ┌─────────┐         │
          └──►│  │  Auth   │  │Realtime │         │
              │  │(JWT/RLS)│  │ (WebSock│         │
              │  └────┬────┘  └────┬────┘         │
              │       │            │              │
              │  ┌────▼────────────▼────┐         │
              │  │     PostgreSQL        │         │
              │  │  organizations        │         │
              │  │  users                │         │
              │  │  templates            │         │
              │  │  folders              │         │
              │  └──────────────────────┘         │
              └───────────────────────────────────┘
```

**Componentes:**

| Componente | Tecnologia | Responsabilidade |
|-----------|------------|-----------------|
| Chrome Extension | Manifest V3, vanilla JS | Expansão automática, sync background |
| Dashboard Web | HTML/CSS/JS vanilla, PWA | Quick copy, busca, login |
| Supabase | PostgreSQL, Auth, Realtime | Banco de dados, auth, sync em tempo real |
| IndexedDB (cliente) | Browser API | Cache offline-first |

---

## 3. Modelo de Dados (Supabase)

### 3.1 Tabela: `organizations`

Escritórios/tribunais. Cada organização tem seus próprios templates.

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,  -- ex: "tribunal-sp", "escritorio-silva"
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 Tabela: `users`

Assessores. Vinculados a uma organização. Role define permissões.

```sql
CREATE TYPE user_role AS ENUM ('admin', 'assessor', 'guest');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role user_role DEFAULT 'assessor',
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.3 Tabela: `folders`

Pastas para organizar templates dentro de um escritório.

```sql
CREATE TABLE folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_idx INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.4 Tabela: `templates`

Modelos de texto. HTML rico (formatado) + texto plano.

```sql
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  shortcut TEXT NOT NULL,  -- ex: "caso01", "contestacao"
  content TEXT NOT NULL,   -- HTML formatado
  plain_text TEXT,         -- versão texto plano (cache)
  is_personal BOOLEAN DEFAULT false,  -- true = só o autor vê
  created_by UUID REFERENCES users(id),
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_templates_org_shortcut ON templates(org_id, shortcut);
CREATE INDEX idx_templates_org_folder ON templates(org_id, folder_id);
```

**Restrição de unicidade:** `(org_id, shortcut)` deve ser único, exceto quando `is_personal = true`.

### 3.5 Row Level Security (RLS)

```sql
-- Habilitar RLS em todas as tabelas
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Política: usuário só vê templates da sua organização
CREATE POLICY "templates_org_isolation" ON templates
  FOR ALL
  USING (org_id = auth.jwt() ->> 'org_id');

-- Política: usuário só vê templates pessoais se for o autor
CREATE POLICY "templates_personal" ON templates
  FOR SELECT
  USING (
    is_personal = false OR 
    created_by = auth.uid()
  );

-- Política: apenas admin pode deletar templates do grupo
CREATE POLICY "templates_delete" ON templates
  FOR DELETE
  USING (
    created_by = auth.uid() OR 
    auth.jwt() ->> 'role' = 'admin'
  );

-- Políticas similares para folders e users...
```

---

## 4. Fluxo de Sincronização (Offline-First)

### 4.1 Estratégia

O cliente sempre lê do **IndexedDB local**. O Supabase é a fonte da verdade, mas não bloqueia a UI.

**Fluxo:**
1. Cliente inicia → carrega templates do IndexedDB (instantâneo)
2. Em background, busca templates do Supabase
3. Compara timestamps (`updated_at`)
4. Atualiza IndexedDB com mudanças
5. Emite evento para UI recarregar

### 4.2 Estados de Sync

```javascript
const SyncState = {
  IDLE: 'idle',           // nada acontecendo
  SYNCING: 'syncing',     // buscando do servidor
  UPDATED: 'updated',     // novos templates recebidos
  OFFLINE: 'offline',     // sem conexão, usando cache
  ERROR: 'error'          // erro no sync
};
```

### 4.3 Realtime (Atualizações em Tempo Real)

Quando um assessor edita um template:

```javascript
// Cliente A edita template
await supabase.from('templates').update({ content: '...' }).eq('id', '...');

// Todos os clientes B, C, D... recebem:
supabase.channel('templates')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'templates',
    filter: `org_id=eq.${currentOrgId}`
  }, payload => {
    // Atualiza IndexedDB e notifica UI
    updateLocalCache(payload.new);
    notifyUI('templates_updated');
  })
  .subscribe();
```

### 4.4 Resolução de Conflitos

Estratégia: **Last-Write-Wins com detecção**

```javascript
function resolveConflict(localTemplate, remoteTemplate) {
  const localTime = new Date(localTemplate.updated_at).getTime();
  const remoteTime = new Date(remoteTemplate.updated_at).getTime();
  
  if (remoteTime > localTime) {
    return remoteTemplate;  // servidor é mais recente
  }
  
  if (localTime > remoteTime) {
    // Cliente local é mais recente — precisa subir
    queueForUpload(localTemplate);
    return localTemplate;
  }
  
  return remoteTemplate;  // iguais, não importa
}
```

---

## 5. Dashboard Web "Modo Tribunal" (Quick Copy)

### 5.1 Propósito

Interface minimalista para assessores em ambientes corporativos onde:
- Não é permitido instalar extensões Chrome
- Usam Word desktop (não online)
- Precisam acessar templates compartilhados do escritório

### 5.2 Interface

```
┌──────────────────────────────────────────┐
│  🔍 Buscar templates...                  │
├──────────────────────────────────────────┤
│  ┌────────────────────────────────────┐  │
│  │ 1. Caso 01 - Contestação          │  │
│  │    /caso01 • Último uso: hoje     │  │
│  ├────────────────────────────────────┤  │
│  │ 2. Caso 02 - Recurso Ordinário    │  │
│  │    /caso02 • Último uso: ontem    │  │
│  ├────────────────────────────────────┤  │
│  │ 3. Contestação Trabalhista        │  │
│  │    /conttrab • Criado por: João   │  │
│  └────────────────────────────────────┘  │
├──────────────────────────────────────────┤
│  💡 Ctrl+1 a Ctrl+9: copiar rápido       │
│  💡 Enter: copiar primeiro resultado     │
│  💡 Esc: limpar busca                    │
└──────────────────────────────────────────┘
```

### 5.3 Interações

| Ação | Resultado |
|------|-----------|
| Digitar no campo de busca | Filtra templates em tempo real (busca em nome, shortcut, conteúdo) |
| Enter | Copia primeiro template da lista para clipboard |
| Ctrl+1 a Ctrl+9 | Copia template da posição N para clipboard |
| Click no template | Copia para clipboard + mostra "Copiado!" |
| Escape | Limpa busca, mostra todos os templates |
| F5 / Ctrl+R | Força sincronização com Supabase |

### 5.4 Clipboard

```javascript
async function copyToClipboard(template) {
  const html = template.content;
  const plain = template.plain_text || stripHtml(html);
  
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })
    ]);
    showToast('Template copiado! Cole com Ctrl+V');
  } catch (err) {
    // Fallback: text-only
    await navigator.clipboard.writeText(plain);
    showToast('Copiado (texto plano). Formatação pode não ser preservada.');
  }
}
```

### 5.5 PWA (Progressive Web App)

O dashboard pode ser instalado como "app" no Windows:
- Arquivo `manifest.json` com ícones, nome, tema
- Service worker para cache offline
- Atalho na área de trabalho / menu Iniciar
- Janela sem barra de endereço (standalone)

---

## 6. Evolução Chrome Extension

### 6.1 Mudanças na Arquitetura

```
ANTES (atual):
chrome.storage.sync  ←──  templates (única fonte)

DEPOIS (evoluído):
chrome.storage.sync  ←──  settings, prefs
     │
IndexedDB  ←──  templates (cache local, primary)
     │
Supabase   ←──  templates (source of truth, background sync)
```

### 6.2 Novos Arquivos

```
extensao_macro/
├── content.js              # (existente) expansão automática
├── background.js           # (evoluído) sync background
├── popup/                  # (evoluído) login + status sync
│   ├── popup.html
│   └── popup.js
├── dashboard/              # (novo) dashboard web
│   ├── index.html
│   ├── dashboard.js
│   └── dashboard.css
├── lib/
│   ├── supabase.min.js     # (novo) cliente Supabase
│   └── ...
├── shared/                 # (novo) código compartilhado
│   ├── db.js               # IndexedDB wrapper
│   ├── sync.js             # lógica de sync
│   └── auth.js             # autenticação
└── manifest.json           # (evoluído) host_permissions para Supabase
```

### 6.3 Background Sync

```javascript
// background.js
chrome.alarms.create('sync-templates', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sync-templates') {
    await syncTemplates();
  }
});

async function syncTemplates() {
  const lastSync = await getLastSyncTime();
  const { data: remoteTemplates, error } = await supabase
    .from('templates')
    .select('*')
    .gt('updated_at', lastSync)
    .eq('org_id', currentOrgId);
  
  if (error) {
    setSyncState('error', error.message);
    return;
  }
  
  await mergeToIndexedDB(remoteTemplates);
  await setLastSyncTime(new Date().toISOString());
  setSyncState('updated');
  
  // Notifica content scripts abertos
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'TEMPLATES_UPDATED' })
        .catch(() => {});  // tab pode não ter content script
    });
  });
}
```

### 6.4 Content Script (Mudanças Mínimas)

O `content.js` continua funcionando igual, mas carrega templates do IndexedDB em vez de `chrome.storage.sync`:

```javascript
// Substituir loadTemplates()
async function loadTemplates() {
  templateCache = await db.getAllTemplates();
}

// Escutar atualizações em tempo real
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TEMPLATES_UPDATED') {
    loadTemplates();
  }
});
```

---

## 7. Autenticação e Fluxo de Onboarding

### 7.1 Primeiro Acesso (Admin)

1. Admin recebe convite por e-mail para criar organização
2. Cria conta no dashboard (`/register`)
3. Define nome do escritório e slug
4. Recebe link de convite para compartilhar com assessores

### 7.2 Assessor Entra no Escritório

1. Clica no link de convite
2. Cria conta com e-mail/senha ou Google OAuth
3. Automaticamente vinculado à organização do convite
4. Vê todos os templates públicos do escritório

### 7.3 Login no Chrome Extension

1. Clica no ícone da extensão
2. Popup mostra "Faça login"
3. Abre dashboard web em nova aba para autenticação
4. Após login, token JWT salvo no `chrome.storage.local`
5. Extensão começa a sincronizar templates

---

## 8. Segurança

### 8.1 Supabase RLS

Todas as tabelas têm RLS habilitado. Nenhum usuário pode ver dados de outra organização.

### 8.2 JWT Tokens

- Tokens JWT válidos por 1 hora
- Refresh automático pelo cliente Supabase
- Token contém `org_id` e `role` no payload

### 8.3 Content Security Policy (CSP)

```json
// manifest.json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://*.supabase.co"
}
```

### 8.4 Sanitização de HTML

Templates são salvos como HTML. Antes de inserir no DOM, passam por sanitização:

```javascript
function sanitizeHtml(html) {
  const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li'];
  const allowedAttrs = {
    'a': ['href']
  };
  // Usar DOMPurify ou sanitização manual
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttrs
  });
}
```

---

## 9. Fases de Implementação

### Fase 1: Backend Supabase (2-3 dias)
- [ ] Criar projeto Supabase
- [ ] Configurar tabelas: organizations, users, folders, templates
- [ ] Configurar RLS policies
- [ ] Configurar Auth (e-mail/senha + Google OAuth)
- [ ] Configurar Realtime
- [ ] Função de busca full-text (pg_trgm ou PostgREST ilike)
- [ ] Seed data para testes

### Fase 2: Shared Libraries (1-2 dias)
- [ ] `shared/db.js` — wrapper IndexedDB
- [ ] `shared/sync.js` — lógica de sync offline-first
- [ ] `shared/auth.js` — autenticação JWT
- [ ] `shared/api.js` — cliente Supabase unificado

### Fase 3: Dashboard Web (3-4 dias)
- [ ] Tela de login/registro
- [ ] Interface Quick Copy (busca, lista, atalhos)
- [ ] Integração com IndexedDB
- [ ] Integração com Supabase (sync, realtime)
- [ ] PWA (manifest, service worker)
- [ ] Toast notifications

### Fase 4: Chrome Extension Evolution (3-4 dias)
- [ ] Refatorar `loadTemplates()` para usar IndexedDB
- [ ] Adicionar login no popup
- [ ] Background sync com alarms
- [ ] Realtime listener
- [ ] Update `manifest.json` (host_permissions, CSP)
- [ ] Testes de expansão automática com templates do Supabase

### Fase 5: Testes e Deploy (2-3 dias)
- [ ] Testes unitários (sync, auth, busca)
- [ ] Testes E2E (login, sync, expansão)
- [ ] Testes multi-device (2 abas, atualização em tempo real)
- [ ] Deploy dashboard (Vercel/Netlify)
- [ ] Configurar Supabase production
- [ ] Documentação para usuários finais

**Total estimado: 11-16 dias**

---

## 10. Testes

### 10.1 Cenários Críticos

| Cenário | Esperado |
|---------|----------|
| Assessor A cria template | Assessor B vê em < 2 segundos |
| Assessor edita template offline | Quando online, template é atualizado no servidor |
| Dois assessores editam mesmo template simultaneamente | Last-write-wins, sem crash |
| Assessor faz logout | IndexedDB é limpo, não vê templates |
| Token expira | Refresh automático, usuário não percebe |
| Assessor de org X tenta ver template de org Y | RLS bloqueia, 403 ou não aparece |

### 10.2 Performance

- **Primeiro load:** < 2 segundos (cache local)
- **Sync background:** < 1 segundo (delta sync)
- **Busca no dashboard:** < 100ms (1000 templates)
- **Expansão no Chrome:** < 200ms (memória local)

---

## 11. Decisões Arquiteturais

| Decisão | Justificativa |
|---------|--------------|
| **Supabase em vez de Firebase** | PostgreSQL relacional, RLS nativo, custo previsível, não vendor lock-in |
| **IndexedDB em vez de localStorage** | Capacidade maior (>5MB), estruturado, funciona com objetos |
| **Vanilla JS em vez de framework** | Chrome Extension tem restrições de CSP, bundle menor, mais fácil de revisar |
| **Dashboard separado em vez de popup** | Popup tem limitações de tamanho (800x600), aba é mais flexível |
| **PWA em vez de Electron** | Zero instalação, funciona em qualquer navegador, tribunal aceita |
| **RLS em vez de backend próprio** | Menor custo, menos código para manter, segurança no banco |
| **Realtime em vez de polling** | Menor latência, menor uso de banda, melhor UX |
| **Last-write-wins em vez de CRDT** | Simplicidade. Conflitos são raros (templates pouco editados) |

---

## 12. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Supabase tem downtime | Baixa | Alto | IndexedDB cache funciona offline indefinidamente |
| Assessores não aceitam aba separada | Média | Alto | Educar, mostrar economia de tempo; futuro: popup flutuante |
| Word desktop não aceita rich paste | Média | Médio | Fallback para texto plano, melhor que nada |
| Escalabilidade do Supabase (5000 users) | Baixa | Alto | Planos Pro/Enterprise, otimizar índices, cache CDN |
| Segurança: template malicioso com XSS | Média | Alto | Sanitização rigorosa de HTML no cliente |

---

## 13. Próximos Passos

1. **Revisar este spec** com stakeholder
2. **Criar projeto Supabase** e configurar schema
3. **Escrever plano de implementação** detalhado (skill: writing-plans)
4. **Implementar Fase 1** (backend)
5. **Iterar** com feedback de assessores piloto (5-10 usuários)

---

*Documento escrito em 2025-01-30 para o projeto Minutário.*
*Autor: OpenCode (especialista em software)*
*Stakeholder: Elvertoni Coimbra*
