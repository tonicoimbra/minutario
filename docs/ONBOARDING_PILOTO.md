# Onboarding Piloto Manual (até 20 usuários)

## Objetivo

Garantir instalação e login sem sair da extensão, com o menor atrito possível para usuários leigos.

## Pré-requisitos do administrador

1. Criar o usuário no Supabase:
   - `Authentication` → `Users` → `Add user`
2. Confirmar que `shared/config.js` da extensão contém:
   - `SUPABASE_URL` do projeto
   - `SUPABASE_ANON_KEY` (chave pública)
3. Confirmar que RLS está ativa nas tabelas `templates` e `folders`.

## Entrega para usuário final

1. Enviar instruções simples de instalação (Chrome ou Firefox).
2. Enviar email e senha provisórios.
3. Informar que o cadastro é feito pelo administrador e que ele só precisa entrar.

## Instalação no Chrome

1. Abrir `chrome://extensions`.
2. Ativar `Modo do desenvolvedor`.
3. Clicar em `Carregar sem compactação`.
4. Selecionar a pasta da extensão.
5. Clicar no ícone da extensão e fazer login.

## Instalação no Firefox

1. Entregar ao usuário um `.xpi` assinado.
2. Usuário abre o arquivo `.xpi` no Firefox.
3. Confirma a instalação.
4. Clica no ícone da extensão e faz login.

## Checklist de validação por usuário

1. Login realizado sem erro.
2. Dashboard abre normalmente.
3. `Sincronizar` conclui sem erro.
4. Um template criado aparece após reabrir popup.

## Atualização de versão no piloto manual

Geração recomendada de release:

```bash
npm run release:pilot:full:patch
```

Alternativa para incremento minor:

```bash
npm run release:pilot:full:minor
```

1. Remover versão anterior.
2. Instalar a versão nova.
3. Validar login e sync.
