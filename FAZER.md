# FAZER.md

## Status real do projeto

### 1) Já foi feito por mim no código
- [x] Fluxo de login/cadastro/esqueci senha com validações de domínio `@tjpr.jus.br`
- [x] Toggle de senha e validação de força de senha
- [x] Mensagem de e-mail não confirmado com opção de reenvio
- [x] Cooldown de 60s para reenvio de confirmação
- [x] Tratamento de link expirado na confirmação
- [x] Paridade aplicada em Chrome, Firefox e Desktop (arquivos espelhados)
- [x] Ajuste de armazenamento de sessão para `storage.session` nas extensões
- [x] `npm run check` e `npm test` passando

### 2) Eu consigo fazer agora (sem sua ação)
- [ ] Rodar build local de extensão e desktop
- [ ] Revisar/reforçar mensagens de erro de auth no frontend
- [ ] Aplicar melhorias extras de UX/A11y que não dependam de serviços externos
- [ ] Gerar SQL final de RLS pronto para colar (se você quiser versão consolidada)

## O que depende de você (manual/externo)

### Prioridade alta (bloqueia produção)

#### A) Configurar Supabase Auth no painel
- [ ] Adicionar Redirect URLs finais:
  - `chrome-extension://[EXTENSION_ID]/shared/confirmed.html`
  - `chrome-extension://[EXTENSION_ID]/password-reset/password-reset.html`
  - `moz-extension://*/shared/confirmed.html`
  - `moz-extension://*/password-reset/password-reset.html`
  - `tauri://localhost/confirmed`
  - `tauri://localhost/password-reset`
- [ ] Observação importante Firefox: UUID da extensão muda por instalação/perfil; não usar UUID fixo no Supabase (usar wildcard `*`)
- [ ] Habilitar confirmação de e-mail no cadastro
- [ ] Confirmar recuperação de senha ativa
- [ ] Configurar limites de tentativa (rate limit) de login e envio de e-mails

#### B) Informar IDs reais das extensões
- [ ] Obter `EXTENSION_ID` real do Chrome
- [ ] (Opcional para debug local) Obter UUID/ID real da extensão Firefox
- [ ] Substituir placeholders apenas do Chrome nos Redirect URLs do Supabase

#### C) Configuração sensível local (não versionada)
- [ ] Validar `shared/config.js` local com URL/anon key corretas do Supabase
- [ ] Validar configs equivalentes em Firefox/Desktop, se seu ambiente separar credenciais

### Prioridade média (go-live seguro)

#### D) Validação manual ponta a ponta (3 plataformas)
- [ ] Testar cadastro com e-mail `@tjpr.jus.br`
- [ ] Testar bloqueio de cadastro sem aceite LGPD
- [ ] Testar login sem confirmar e-mail (mensagem + reenvio)
- [ ] Testar recuperação e redefinição de senha
- [ ] Repetir em Chrome, Firefox e Desktop

#### E) Jurídico/LGPD
- [ ] Aprovar texto final de `terms.html`
- [ ] Aprovar texto final de `privacy.html`

### Prioridade baixa (publicação)

#### F) Distribuição
- [ ] Publicar/atualizar extensão Chrome
- [ ] Assinar/publicar Firefox (AMO) com suas credenciais
- [ ] Distribuir instalador desktop

## Resumo objetivo: o que você realmente precisa fazer

Se quiser só o mínimo indispensável, faça nesta ordem:
1. Configurar Redirect URLs e Auth no Supabase.
2. Colocar ID real do Chrome nos redirects (Firefox usa wildcard `moz-extension://*/...`).
3. Validar `config.js` local com credenciais corretas.
4. Rodar teste manual rápido de cadastro/confirmar/reset nas 3 plataformas.
5. Aprovar textos jurídicos finais.

## O que não precisa você fazer manualmente
- Não precisa editar manualmente os fluxos de UI/auth no código.
- Não precisa ajustar lógica de cooldown/reenvio/validações.
- Não precisa sincronizar manualmente Chrome/Firefox/Desktop no repositório.
- Não precisa rodar validação técnica básica (eu já rodei check + testes).
