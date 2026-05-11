# Minutário para Firefox

Esta pasta contém a versão Firefox independente da extensão Minutário. A versão Chrome na raiz do projeto não é usada por este pacote e não precisa ser alterada.

## Arquitetura

- `manifest.json`: Manifest V2 para Firefox, com `browser_specific_settings.gecko.id`.
- `background.js`: background script Firefox carregado por `background.scripts`.
- `content.js`: content script com namespace `browser.*` e caminho Word Online sem CDP.
- `shared/`: IndexedDB, Supabase e sincronização, iguais ao pacote Chrome.
- `popup/`, `quick-access/`, `dashboard/`: interfaces adaptadas para `browser.*`.
- `lib/`: bibliotecas empacotadas localmente. Nenhum CDN é usado.

## Diferenças em Relação ao Chrome

Firefox não expõe o mesmo caminho `chrome.debugger` + Chrome DevTools Protocol usado pelo Chrome para Word Online. Por isso, o pacote Firefox mantém a mesma estratégia de buffer pré-commit, mas insere a expansão com comandos de edição nativos do Gecko:

1. o gatilho não é enviado ao documento do Word;
2. um overlay visual mostra `/atalho` enquanto o usuário digita;
3. ao expandir, o overlay some;
4. a extensão tenta inserir HTML via `document.execCommand("insertHTML")`;
5. se necessário, tenta `insertText`, clipboard/paste e inserção DOM como fallback.

## Instalação Temporária para Teste

1. Abra o Firefox.
2. Acesse `about:debugging`.
3. Clique em `This Firefox`.
4. Clique em `Load Temporary Add-on`.
5. Selecione `firefox/manifest.json`.

Instalações temporárias somem ao reiniciar o Firefox.

## Empacotamento

No PowerShell, na raiz do projeto:

```powershell
.\firefox\build.ps1
```

O pacote será criado em `dist-firefox/minutario-firefox-YYYYMMDD-HHMMSS.zip`.

Para distribuir fora do modo temporário, envie o ZIP para assinatura no Mozilla Add-ons. Firefox exige add-ons assinados para instalação permanente.

## CSV

O formato CSV é igual ao Chrome:

```csv
trigger,expansion,name,folder,id,folder_id,plain_text,created_at,updated_at
```

Também são aceitos aliases de importação:

- `trigger`, `shortcut`, `atalho`, `gatilho`
- `expansion`, `content`, `conteudo`, `expansao`, `texto`

O CSV exportado usa UTF-8 com BOM e escape RFC 4180, então pode ser importado tanto no Chrome quanto no Firefox.

## Checklist Manual

- Carregar a extensão em `about:debugging`.
- Abrir o dashboard e criar um template.
- Exportar CSV e verificar download.
- Importar o CSV exportado e conferir merge por gatilho.
- Testar `/atalho` em input, textarea e contenteditable.
- Testar `/atalho` no Word Online.
- Abrir o popup e copiar o diagnóstico Word Online.
- Abrir consulta rápida com `Ctrl+Shift+K`.
