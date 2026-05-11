# Inventário de Compatibilidade Firefox

## Decisão

Arquitetura escolhida: duplicação simples em `firefox/`.

Motivo: a versão Chrome é carregada sem build e está funcional. Uma árvore Firefox isolada permite adaptar manifest, background e namespace sem tocar nos arquivos Chrome.

## Inventário

| Arquivo ou grupo | Status | Adaptação Firefox |
|---|---|---|
| `manifest.json` | Adaptação necessária | Criado Manifest V2 com `background.scripts`, `browser_action`, permissões em `permissions`, `web_accessible_resources` MV2 e `browser_specific_settings.gecko.id`. |
| `background.js` | Incompatível parcialmente | Removido `importScripts`; dependências são carregadas pelo manifest. Removido `chrome.debugger`/CDP. Namespace alterado para `browser.*`. |
| `content.js` | Adaptação necessária | Namespace alterado para `browser.*`. Word Online usa buffer pré-commit com inserção nativa Firefox, sem CDP. |
| `shared/config.js` | Compatível | Copiado como está para manter as mesmas configurações. |
| `shared/config.example.js` | Compatível | Copiado como template de configuração. |
| `shared/db.js` | Compatível | IndexedDB é suportado no Firefox. |
| `shared/api.js` | Compatível | Supabase bundled e `fetch` funcionam no Firefox. |
| `shared/sync.js` | Compatível | Usa módulos compartilhados e Promises. |
| `popup/popup.html` | Compatível | Sem mudanças estruturais. |
| `popup/popup.css` | Compatível | CSS compatível. |
| `popup/popup.js` | Adaptação necessária | Namespace alterado para `browser.*`. |
| `quick-access/quick-access.html` | Compatível | Sem mudanças estruturais. |
| `quick-access/quick-access.css` | Compatível | CSS compatível. |
| `quick-access/quick-access.js` | Adaptação necessária | Namespace alterado para `browser.*`. |
| `dashboard/dashboard.html` | Compatível | Scripts locais continuam na mesma ordem. |
| `dashboard/dashboard.css` | Compatível | CSS usa seletores modernos; Firefox 109+ suporta `:has`. |
| `dashboard/dashboard.js` | Adaptação necessária | Namespace alterado para `browser.*`; CSV usa Blob/File API compatíveis. |
| `dashboard/sync/csv.js` | Compatível | Parser/exportador usa JS padrão, PapaParse local e Blob na UI. |
| `dashboard/sync/index.js` | Compatível | Não usa APIs específicas do Chrome. |
| `dashboard/sync/supabase.js` | Compatível | Usa Supabase e APIs web padrão. |
| `dashboard/manifest.json` | Compatível | Manifest PWA interno, não é o manifest da extensão. |
| `dashboard/index.html` | Compatível | Página PWA auxiliar copiada. |
| `dashboard/sw.js` | Compatível com ressalva | Service worker PWA é opcional; falhas de registro são capturadas. |
| `lib/*` | Compatível | Bibliotecas locais, sem CDN. |
| `icons/*` | Compatível | Ícones PNG. |
| `build.ps1` | Novo | Empacota a pasta Firefox em ZIP para teste/assinatura. |
| `README.md` | Novo | Instruções específicas Firefox. |

## Incompatibilidades Mapeadas

- Firefox não suporta `background.service_worker` como o Chrome MV3. Solução: Manifest V2 com `background.scripts`.
- Firefox usa `browser.*` com Promises. Solução: todos os arquivos Firefox usam `browser.*`.
- `chrome.debugger`/CDP é específico do Chromium. Solução: Word Online Firefox usa buffer pré-commit + comandos nativos de edição.
- `host_permissions` MV3 não é usado no MV2. Solução: hosts foram movidos para `permissions`.
- `web_accessible_resources` MV3 difere do MV2. Solução: lista simples de recursos.
- `action` MV3 difere de MV2. Solução: `browser_action`.
- `match_origin_as_fallback` não é usado no Manifest V2 Firefox. Solução: removido, mantendo `all_frames` e `match_about_blank`.
