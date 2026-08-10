# Prompt de implementação — Verificação de e-mail (sistema próprio)

> **Como usar:** este arquivo é o prompt de uma sessão de implementação do Claude Code.
> Cole-o (ou referencie com `@email-verification-prompt.md`) e peça **uma etapa por vez**
> ("execute a Etapa 1"). Comece cada etapa em *plan mode*; só saia do plano quando o
> escopo estiver claro. Ao final de cada etapa, rode as verificações listadas e **cole a
> saída dos comandos como evidência** — não afirme sucesso sem mostrar. Se uma
> verificação falhar, corrija antes de avançar. Entre etapas, prefira `/clear` e uma
> sessão nova.
>
> O contexto arquitetural genérico está em `@email-verification-blueprint.md`. Este
> prompt já resolve todas as decisões `[DECIDE]` do blueprint para este projeto — não as
> reabra. **A confirmação nativa do Supabase Auth NÃO será usada**: o sistema de tokens
> é próprio, vive em SQL, e o envio de e-mail sai por uma Edge Function.

---

## Contexto do projeto (leia antes de qualquer etapa)

- SPA Vite + React 18 + TS. **Não há backend próprio**: a camada confiável é o Supabase
  (Postgres com RLS + RPCs). O CLAUDE.md já autoriza Edge Functions
  (`supabase/functions/`) **somente** como ponte para integrações externas — o envio de
  e-mail desta feature é o primeiro caso.
- Cadastro: [src/pages/Cadastro.tsx](src/pages/Cadastro.tsx) (`supabase.auth.signUp` +
  trigger `handle_new_user` da migration `20260710120000` cria perfil/papel).
  Login: [src/pages/Login.tsx](src/pages/Login.tsx) — contém o mapeamento papel→portal.
  Sessão/papéis: [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) e
  [src/components/ProtectedRoute.tsx](src/components/ProtectedRoute.tsx).
- Scripts administrativos usam a **Management API** com `SUPABASE_ACCESS_TOKEN`
  (padrão em [scripts/migrate.js](scripts/migrate.js),
  [scripts/seed-admin.js](scripts/seed-admin.js),
  [scripts/purge-contas.js](scripts/purge-contas.js)). Não há Supabase CLI no fluxo do
  projeto — **deploy de function e secrets também devem sair por script de Management
  API**, não por CLI. O banco é o de **produção**.

### Decisões já tomadas (não reabrir)

1. **Postura: login permitido, uso bloqueado.** O autoconfirm do Supabase fica LIGADO
   (GoTrue não envia nada e entrega sessão no signup). Conta não confirmada loga, mas
   **RLS recusa os dados protegidos** — a fronteira de confiança é o SQL, nunca a UI.
2. **Camada de tokens própria e compartilhável.** Tabela própria com coluna
   `proposito` (`'verificacao_email'` agora; `'redefinir_senha'` previsto no CHECK mas
   **não implementado**). Token de 32 bytes aleatórios (pgcrypto), banco guarda **só o
   hash sha256**, expiração de 24h, uso único registrado em `used_at` (timestamp, não
   deleção — preserva "já usado" ≠ "nunca existiu").
3. **Cunhagem e consumo em SQL, envio na Edge Function.** A RPC de cunhagem é
   executável **apenas pelo service_role** (a function é sua única chamadora); a RPC de
   consumo é executável por `anon` (o link abre em navegador sem sessão — celular).
   Cada RPC é uma função Postgres = uma transação: consumo marca `used_at` e confirma o
   usuário atomicamente (§4 do blueprint).
4. **Reenvio NÃO invalida tokens anteriores.** Vários tokens em aberto são legítimos;
   qualquer um confirma; após confirmado, os demais caem em "já confirmado". (Decisão
   §4/§8.6 — evita o ticket "cliquei no e-mail antigo".)
5. **Reenvio exige sessão.** Como login é permitido, a tela "verifique seu e-mail" é
   autenticada e o reenvio é sempre "para mim mesmo" — elimina enumeração de contas e
   spam por design. Throttle de 60s **imposto na RPC de cunhagem** (SQL), espelhado na
   UI.
6. **Envio: Brevo free (300/dia).** Dia 1 estimado: 180 cadastros + ~30% reenvios ≈
   234 e-mails — cabe com folga de ~25%. Seguro de pico: um mês de plano pago do Brevo
   se a janela de inscrição concentrar mais que isso. Remetente, chave da API e URL
   base vêm de **secrets da function** — nunca do header `Host`/`Origin`, nunca no
   repositório.
7. **Contas existentes são confirmadas em bloco** na migration (antecedem a regra;
   ninguém é trancado para fora retroativamente).
8. **Pós-confirmação:** se o navegador tem sessão → redireciona por papel (reutilizar o
   mapeamento de `Login.tsx`, extraído para função compartilhada); sem sessão →
   `/login` com mensagem de sucesso. Não há auto-sessão (a RPC não cunha sessão GoTrue).
9. **Enumeração no signup:** o GoTrue com autoconfirm já responde "User already
   registered" hoje; comportamento atual aceito, fora do escopo mudar.

### Regras (valem para todas as etapas)

- Texto de marca só via `src/lib/brand.ts`; UI, comentários e e-mails em pt-BR.
- Rota nova = `App.tsx` + `src/lib/pageTitles.ts` (a ORDEM importa; teste em
  `src/test/pageTitles.test.ts`) + `Disallow` em `public/robots.txt` +
  `X-Robots-Tag: noindex` nos 4 configs de deploy (`vercel.json`, `public/_headers`,
  `deploy/nginx.conf.example`, `deploy/apache.htaccess.example`) — as duas rotas novas
  carregam token/fluxo sensível.
- Nunca editar migration já aplicada; mudanças de servidor = migration nova
  `AAAAMMDDHHMMSS_descricao.sql`.
- O **token cru nunca é persistido nem logado** — existe só no retorno da RPC de
  cunhagem, no corpo do e-mail e na URL clicada. A Edge Function não pode logá-lo.
- A Edge Function deriva o usuário **do JWT** (`auth.getUser()`); o corpo da requisição
  não aceita `email` nem `user_id`.
- Falha de rede **nunca** é apresentada como "link inválido" — estados distintos.
- Gate só no cliente é cosmético: toda restrição nova precisa existir como policy/RPC.
- `npm run migrate`, deploy de function, gravação de secrets e `purge:contas` tocam
  **produção**: só executar com pedido explícito do usuário.
- Ao terminar cada etapa: `npm run lint && npm run test`, e colar a saída.

### Fora do escopo (não implementar)

- Reset de senha e troca de e-mail (o schema já os comporta via `proposito`; nada de UI
  ou RPC deles agora).
- Fila/outbox, retries automáticos de envio, SPF/DKIM/DMARC (configuração no Brevo,
  fora do repo — registrar como pendência, não resolver).
- Mudanças no `handle_new_user` ou no fluxo de papéis.

---

## Etapa 0 — Reconhecimento (somente leitura)

**Estado final:** um relatório na conversa (nenhum arquivo editado) que estabelece:

- Config atual do Auth via Management API (`GET /v1/projects/{ref}/config/auth`):
  valor de `mailer_autoconfirm` (precisa estar/ficar ligado) e o que mais for relevante.
- Quantos usuários existem em `auth.users` (escopo do backfill da decisão 7) — consulta
  somente leitura via Management API.
- `pgcrypto` disponível? (`gen_random_bytes` é pré-requisito da cunhagem.)
- **Inventário do gate:** a lista completa de policies `TO authenticated` do schema
  `public` (via `pg_policies`), classificada em duas colunas: *recebe o gate de
  confirmação* vs. *lista de exceções* (mínimo indispensável a um usuário não
  confirmado: ler o próprio `profiles`, ler os próprios `user_roles`, e as RPCs
  `get_my_roles`/`email_confirmado`). Tabelas de submissão, avaliação, inscrição,
  minicursos e certificados ficam do lado do gate. Este inventário é o contrato da
  Etapa 1 — imprimi-lo por completo.

**Verificação:** o relatório cita valores concretos (ou marca o que não pôde ser lido e
por quê); `git status` limpo.

---

## Etapa 1 — Fundação em SQL (migration única)

**Estado final:** uma migration nova cria o núcleo confiável inteiro:

- Tabela `public.tokens_email`: `token_hash text PK`, `user_id uuid` FK
  `ON DELETE CASCADE`, `proposito text CHECK IN ('verificacao_email','redefinir_senha')`,
  `email text`, `expires_at`, `used_at NULL`, `created_at`, `message_id text NULL`
  (id do Brevo — forense §6). RLS ligado, **nenhuma policy** para `anon`/`authenticated`
  (só as RPCs tocam a tabela).
- Coluna `profiles.email_confirmado_em timestamptz NULL` + **backfill**: todos os
  usuários existentes no momento da migration ficam confirmados.
- `public.email_confirmado() returns boolean` — SECURITY DEFINER STABLE, `true` se o
  `auth.uid()` atual tem `email_confirmado_em`. Concedida a `authenticated`. É **a
  mesma função** usada nas policies e chamada pelo cliente (uma fonte de verdade).
- RPC de cunhagem (`criar_token_email(p_user_id, p_proposito) returns text`):
  gera 32 bytes via pgcrypto, grava o hash, devolve o token cru. Recusa: usuário já
  confirmado (para `verificacao_email`), throttle < 60s desde o último token do mesmo
  usuário+propósito. `REVOKE ... FROM PUBLIC, anon, authenticated`; `GRANT` só a
  `service_role`.
- RPC de consumo (`confirmar_email(p_token text) returns text`), executável por `anon`
  e `authenticated`, devolvendo exatamente um de:
  `'confirmado'` (marcou `used_at` + confirmou o usuário, mesma transação) ·
  `'ja_confirmado'` (token já usado OU usuário já confirmado — desfecho com cara de
  sucesso) · `'expirado'` · `'invalido'` (hash desconhecido). Segunda chamada com o
  mesmo token não é erro destrutivo (§4, idempotência).
- **Gate aplicado**: toda policy do inventário da Etapa 0 classificada como "recebe o
  gate" passa a exigir `public.email_confirmado()` (via `CREATE OR REPLACE`/drop-create
  das policies **em migration nova** — nunca editando migrations antigas).

**Verificação (as três primeiras rodam antes de aplicar; o resto só após o usuário
autorizar `npm run migrate`):**

1. `npm run lint && npm run test` — nada do frontend quebrou (a migration é aditiva).
2. O SQL da migration referencia todas as tabelas do inventário "recebe o gate" — listar
   o diff inventário × migration.
3. `git status`: apenas a migration nova.
4. Pós-aplicação, via curl com a anon key:
   `POST /rest/v1/rpc/confirmar_email` com `{"p_token":"lixo"}` ⇒ `"invalido"`;
   `POST /rest/v1/rpc/criar_token_email` ⇒ **permission denied**.
5. Pós-aplicação, via Management API (somente leitura): a consulta em `pg_policies`
   filtrando policies `authenticated` cujo texto **não** contém `email_confirmado`
   devolve exatamente a lista de exceções da Etapa 0 — colar o resultado.
6. Nenhum usuário pré-existente ficou não confirmado:
   `SELECT count(*) FROM profiles WHERE email_confirmado_em IS NULL` ⇒ 0.

---

## Etapa 2 — Edge Function `enviar-email` + scripts de deploy/secrets + CLAUDE.md

**Estado final:**

- `supabase/functions/enviar-email/index.ts` (Deno, pt-BR nos textos):
  - Exige JWT válido; identidade **só** do `auth.getUser()`; corpo aceita apenas
    `{ "proposito": "verificacao_email" }`. Trata preflight CORS.
  - Com client service_role: chama `criar_token_email`, monta o e-mail (marca conforme
    `brand.ts` — duplicar as constantes aqui é aceitável, com comentário apontando a
    fonte), envia via `POST https://api.brevo.com/v3/smtp/email`, grava o
    `message_id` devolvido na linha do token.
  - Link do e-mail: `${SITE_URL}/confirmar-email?token=...` com `SITE_URL` vindo de
    secret — nunca de `Host`/`Origin`.
  - Erro do Brevo/throttle da RPC viram respostas estruturadas distintas (o cliente
    mostra "aguarde e tente de novo" para throttle); o token cru não aparece em log.
- Scripts no padrão dos existentes (Management API + `SUPABASE_ACCESS_TOKEN` +
  `scripts/load-dotenv.js`), expostos em `package.json`:
  - `npm run deploy:functions` — publica a function via endpoint de functions da
    Management API (sem Supabase CLI, sem Docker).
  - `npm run config:secrets` — grava `BREVO_API_KEY`, `EMAIL_REMETENTE`, `SITE_URL`
    lendo **do ambiente** na hora (nunca de arquivo commitado).
- **CLAUDE.md atualizado** (a regra de Edge Functions já existe; completá-la): entrada
  dos dois comandos novos na seção Comandos, com a mesma ressalva de produção, e a
  convenção `supabase/functions/` na seção de arquitetura.
- Cabeçalho da function documenta as pendências externas: domínio/remetente verificado
  no Brevo, SPF/DKIM, limite free de 300/dia vs. estimativa do dia 1.

**Verificação:**

1. `npm run lint && npm run test` + `git status` com apenas os arquivos previstos.
2. Dry-run dos scripts sem token/secrets definidos ⇒ erro claro em pt-BR instruindo o
   ambiente, sem stack trace (mesmo comportamento dos scripts atuais).
3. **Após o usuário autorizar deploy + secrets:**
   - `curl -X POST {SUPABASE_URL}/functions/v1/enviar-email` **sem** JWT ⇒ 401.
   - Com JWT de um usuário de teste não confirmado ⇒ `{ ok: true }`, e-mail real chega
     (imprimir o `message_id`); a linha em `tokens_email` tem `message_id` preenchido
     (consulta via Management API — colar).
   - Segunda chamada imediata ⇒ resposta de throttle, não erro genérico.
   - Corpo com `{"email":"outro@x.com"}` ⇒ campo ignorado/recusado — o e-mail vai para
     o dono do JWT.

---

## Etapa 3 — Rotas SPA e costura do fluxo

**Estado final:**

- **`/confirmar-email`** (pública — o link abre sem sessão): lê `token` da query,
  limpa a URL via `history.replaceState` assim que lê, e só consome no clique do botão
  "Confirmar e-mail" (nunca no mount — scanners §4). Chama a RPC `confirmar_email` e
  rende um estado por desfecho: `confirmado` → com sessão, redireciona por papel (função
  compartilhada extraída de `Login.tsx`); sem sessão, `/login` com sucesso ·
  `ja_confirmado` → tom de sucesso + link `/login` · `expirado` → orienta a entrar e
  reenviar (`/login` → cai na tela de reenvio) · `invalido` → orienta cadastro/suporte ·
  `rede` → botão tentar de novo. O mapeamento resultado/erro→estado é **função pura
  exportada**, separada do componente.
- **`/verifique-email`** (autenticada, qualquer papel): mostra o e-mail da sessão,
  botão de reenvio chamando a Edge Function com cooldown de 60s (espelho do throttle),
  mensagem neutra de resultado, aviso de spam. Usuário já confirmado que abrir a rota é
  redirecionado ao seu portal.
- **Costura:**
  - `AuthContext` expõe `emailConfirmado` (RPC `email_confirmado()`), carregado junto
    do papel.
  - `ProtectedRoute` redireciona usuário não confirmado para `/verifique-email` em
    qualquer rota protegida (exceto ela própria) — cortesia de UI; o RLS continua sendo
    a barreira.
  - `Cadastro.tsx`: signup ok (sessão existe, autoconfirm) → chama `enviar-email` →
    navega para `/verifique-email`; se o envio falhar, navega mesmo assim (o botão de
    reenvio cura — §6, envio fora da transação de cadastro).
  - `Login.tsx`: pós-login de usuário não confirmado → `/verifique-email` (o caso
    "Email not confirmed" do GoTrue morre, pois autoconfirm está ligado).
- Ambas as rotas registradas conforme as Regras (App.tsx, pageTitles na ordem certa,
  robots, 4 configs de deploy).

**Verificação:**

1. Teste unitário (Vitest) do mapeamento: cada valor da RPC vira o estado certo; erro de
   fetch/rede ⇒ `rede`, nunca `invalido`.
2. `src/test/pageTitles.test.ts` verde com as rotas novas.
3. No `npm run dev`: `/confirmar-email` sem token ⇒ `invalido` sem crash; com
   `?token=lixo` + clique ⇒ `invalido` vindo da RPC; DevTools offline ⇒ `rede` com
   retry; conta nova ⇒ cai em `/verifique-email` e o cooldown segura o botão; tentativa
   de navegar para rota protegida sem confirmar ⇒ volta para `/verifique-email`.
   Relatar o observado.
4. `npm run lint && npm run test` — colar saída.

---

## Etapa 4 — Fim a fim, retenção e checklist final

**Estado final:**

- `scripts/purge-contas.js` ganha `--nao-confirmadas <dias>` (padrão 30): remove contas
  com `email_confirmado_em IS NULL` mais antigas que o corte (o CASCADE limpa os
  tokens), e a limpeza de `tokens_email` expirados há mais de 30 dias, com o padrão de
  confirmação já existente no script. Documentado no cabeçalho; **não executado** sem
  pedido.
- A definição de pronto (§9 do blueprint) verificada com evidência colada:

| Propriedade | Evidência exigida |
|---|---|
| Conta não confirmada, **com sessão válida e SPA fora do caminho**, não alcança dados protegidos | curl ao PostgREST (`/rest/v1/trabalhos?select=...` e mais 1–2 tabelas do gate) com o JWT do usuário de teste ⇒ vazio/negado; a mesma chamada após confirmar ⇒ dados |
| Token funciona exatamente uma vez; repetição é desfecho calmo | fluxo real: 1º clique ⇒ `confirmado`; 2º ⇒ `ja_confirmado` |
| Expirado/ inválido têm caminho adiante | telas da Etapa 3 apontando para o reenvio (relato do dev server) |
| Cadastro sobrevive ao provedor fora do ar | com secret do Brevo temporariamente inválida (ou simulando a falha), signup ainda cria a conta e a tela de reenvio fica utilizável; restaurar a secret depois |
| Link do e-mail funciona em produção, celular, sem sessão | abrir o deep link `/confirmar-email?...` recarregado no domínio de produção ⇒ SPA responde (rewrites de `vercel.json`); RPC `anon` confirma sem login |
| Nada no banco forja link válido | consulta mostrando que `tokens_email` só contém hashes (comprimento/formato), e afirmação de que o token cru não é persistido em lugar algum |
| Orçamento de envio fecha | conta explícita: 180 + ~30% ≈ 234 ≤ 300/dia (Brevo free); pendência anotada: mês pago se a janela concentrar mais |

**Verificação:** a tabela preenchida com saídas reais, `npm run lint && npm run test`
verdes, `git status` mostrando apenas os arquivos previstos pelas Etapas 1–4, e a conta
de teste removida via `purge:contas` (com aprovação).
