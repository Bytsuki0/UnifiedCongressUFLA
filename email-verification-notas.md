# Verificação de e-mail — notas de execução (Etapas 0 e 1)

> Projeto Supabase `awkkkxelfhlpxktzzhzk` (**produção**). Leituras e migrations via
> Management API com `SUPABASE_ACCESS_TOKEN`; o `service_role` nunca é usado.
>
> Companheiros: `@email-verification-prompt.md` (o roteiro) e
> `@email-verification-blueprint.md` (o contexto arquitetural).
>
> **Regra deste arquivo:** ele guarda só o que as etapas seguintes precisam consultar.
> Contrato cumprido vira uma linha de resultado — inventário detalhado não se acumula aqui.

---

## 1. Etapa 0 — reconhecimento (2026-08-06) ✅

Levantamento somente leitura que virou o contrato da Etapa 1. Achados que **ainda valem**:

| Fato | Consequência permanente |
|---|---|
| `mailer_autoconfirm = true`; SMTP do GoTrue vazio | Postura "login permitido, uso bloqueado" está válida. **Não mexer** nessa chave. |
| `jwt_exp = 3600` (1 h) | `email_confirmado()` lê **do banco**, não de claim do JWT → confirmação vale na hora, sem esperar refresh. |
| pgcrypto vive em `extensions`, **não** em `public`; todas as funções `SECURITY DEFINER` fixam `SET search_path = public` | Sempre qualificar: `extensions.gen_random_bytes`, `extensions.digest`. Alargar o search_path enfraqueceria o hardening de `20260709120000`. |
| `authenticated` tem `SELECT/INSERT/UPDATE/DELETE` em **tudo** no `public`; `anon` só lê `minicourses` e `schedule` | A barreira é **100% RLS**. Nenhuma proteção vem de grant de tabela. |
| `handle_new_user` deriva o papel do **domínio do e-mail**, sem prova de posse da caixa | Era o buraco que a feature fecha: `qualquer@ufla.br` virava `professor` no ato e `professor` lia **todos** os PDFs via `pdfs owner read`. **Fechado na Etapa 1.** |

Decisões A e B aprovadas nesta etapa (gate parcial em `profiles`/`user_roles`; gate estendido
a `storage.objects` e às RPCs `SECURITY DEFINER`) foram implementadas — ver §2.

---

## 2. Etapa 1 — fundação em SQL ✅ **APLICADA EM PRODUÇÃO** (2026-08-06)

`supabase/migrations/20260806140000_verificacao_email.sql` — 17ª migration.

### 2.1 Contrato que as Etapas 2–4 consomem

```sql
public.criar_token_email(p_user_id uuid, p_proposito text DEFAULT 'verificacao_email')
  RETURNS text            -- token CRU, 64 hex chars. GRANT: service_role APENAS.
  -- Erros por SQLSTATE (a Edge Function separa pelo campo `code`, não pela mensagem):
  --   PT429 throttle 60 s · PT409 já confirmado · PT404 usuário inexistente
  --   PT400 propósito não suportado ('redefinir_senha' recusado de propósito)

public.confirmar_email(p_token text)
  RETURNS text            -- 'confirmado' | 'ja_confirmado' | 'expirado' | 'invalido'
                          -- GRANT: anon, authenticated. Idempotente, nunca lança.

public.email_confirmado()  RETURNS boolean   -- GRANT: authenticated. Usada nas policies E pelo cliente.
```

`public.tokens_email` — `token_hash` (PK, sha256 hex), `user_id` (FK CASCADE), `proposito`,
`email`, `expires_at` (24 h), `used_at`, `created_at`, **`message_id`** (a Etapa 2 grava aqui
o id devolvido pelo Brevo). RLS ligado, **0 policies**, `REVOKE ALL` de anon/authenticated.
O token cru **não é persistido em lugar nenhum** — verificado.

`public.exigir_email_confirmado()` — guarda usada no topo das RPCs. **Levanta `PT403`, mas
deixa passar quando `auth.uid()` é NULL.** Sem essa ressalva toda escrita de servidor
quebraria (trigger de `pareceres` → `aplicar_decisao`, seeds, migrations) — é a mesma
convenção que `protect_trabalhos_fields` já adota. Não abre brecha: as 9 RPCs gateadas já
recusam chamada sem sessão por conta própria.

### 2.2 Onde o gate ficou (estado verificado no banco)

| Schema | Com gate | Sem gate | Total |
|---|---|---|---|
| `public` | 55 | 2 | 57 |
| `storage` | 12 | 4 | 16 |

**Isentas por motivo estrutural** (`anon` já lê e `email_confirmado()` é falso para `anon`
→ gatear quebraria a página pública): `minicourses select` e `schedule select`. A escrita
das duas tabelas **está** gateada, e a inscrição em minicurso mora em
`minicourse_registrations`, integralmente gateada.

**Gate parcial** — o ramo próprio fica aberto (é o que mantém `/verifique-email` utilizável),
o ramo de staff é gateado:

```
public.profiles / profiles select
  ((id = auth.uid()) OR (is_event_staff() AND email_confirmado()))
public.user_roles / user_roles select
  ((user_id = auth.uid()) OR (is_event_staff() AND email_confirmado()))
storage.objects / pdfs owner read
  bucket_id='Pdfs' AND ( foldername[1]=auth.uid()::text
                         OR (is_event_staff()      AND email_confirmado())
                         OR (has_role(…,'professor') AND email_confirmado()) )
```

**Storage sem gate (4)**: `pdfs owner insert`, `avatars owner write/update/delete` — são
exclusivamente "pasta do próprio usuário", sem ramo de papel, então o gate parcial é no-op.

**RPCs**: 9 plpgsql receberam `PERFORM public.exigir_email_confirmado()`;
`minicourse_occupancy` (LANGUAGE sql) recebeu `AND (auth.uid() IS NULL OR email_confirmado())`
no corpo, preservando o catálogo público. Cinco funções internas — `_pool_revisores`,
`_conflitos_por_trabalho`, `conflitos_do_trabalho`, `decisao_consolidada`, `aplicar_decisao` —
tiveram o `GRANT` **revogado** de `anon, authenticated`: nenhuma é usada pelo frontend, e
revogar é mais forte que gatear. Até então eram chamáveis direto pelo PostgREST, contornando
os wrappers autorizados.

Nunca gatear `is_event_staff()`, `is_app_admin()`, `has_role()` — as policies as chamam
(recursão). Nem `get_my_roles()` (a UI precisa do papel para rotear), `verify_certificate`
(`anon` por desenho), `consume_rate_limit`, nem os triggers.

### 2.3 Detalhe de implementação que vale saber

As 53 policies de gate integral **não foram reescritas à mão**. Um bloco `DO` lê o
`qual`/`with_check` atual de cada uma em `pg_policies` e reemite
`ALTER POLICY … USING ((<atual>) AND public.email_confirmado())`. Os 53 nomes estão listados
explicitamente e a migration **aborta** se algum não existir. O predicado de autorização de
cada tabela não pode divergir do que está em produção.

### 2.4 Evidência colhida após aplicar

- anon: `confirmar_email("lixo")` ⇒ `"invalido"` (HTTP 200) · `criar_token_email` ⇒ 401 `42501`
  permission denied · `GET /rest/v1/tokens_email` ⇒ 401 `42501`.
- `pg_policies` sem `email_confirmado`: exatamente `minicourses select` + `schedule select`.
- `profiles`: 4 perfis, 4 confirmados, 0 não confirmados (backfill).
- Ciclo completo exercitado contra o banco real dentro de um `DO` revertido por `RAISE`:
  expirado ⇒ `expirado` · cunhagem ⇒ 64 hex, token cru ausente do banco · 2ª cunhagem ⇒ `PT429` ·
  `redefinir_senha` ⇒ `PT400` · 1º clique ⇒ `confirmado` · 2º ⇒ `ja_confirmado` · link antigo ⇒
  `ja_confirmado` · inexistente ⇒ `invalido` · cunhar p/ confirmado ⇒ `PT409`.
  Estado após rollback: 0 tokens, nada persistido.

### 2.5 Resíduo conhecido — decisão consciente

Conta não confirmada **ainda grava na própria pasta do bucket `Pdfs`** (`pdfs owner insert`
segue sem gate, conforme a Decisão B de manter o ramo próprio aberto). O arquivo fica órfão —
`trabalhos insert` está gateado — mas é consumo de storage por conta não verificada.
Fechar é uma linha: `AND public.email_confirmado()` no `WITH CHECK` da policy.

### 2.6 Contas NÃO confirmadas — ⚠ SEÇÃO OBSOLETA, ver §6.1 (purga de 2026-08-08)

> As três contas descritas abaixo **não existem mais**: a purga de 2026-08-08 deixou
> apenas `gustavo.silva47@estudante.ufla.br`. O texto fica como registro do raciocínio —
> o estado atual do banco está em §6.1.

<details>
<summary>Texto original (2026-08-08, antes da purga)</summary>

Criadas **depois** de a migration entrar em produção, então ficaram com
`email_confirmado_em = NULL` — de propósito, é exatamente o que o gate faz:

```
NULL  2026-08-08  ciufla0@gmail.com                 ← real, antes de existir envio
NULL  2026-08-08  gustavo.vitor.silva47@gmail.com   ← real, antes de existir envio
NULL  2026-08-08  ciufla0+teste@gmail.com           ← teste da Etapa 2 (§3.5)
```

Consequências para não virar dor de cabeça:

- **Toda auditoria a partir de agora mostra 3 NULLs** em `profiles.email_confirmado_em`
  (a verificação 6 da Etapa 1 — "count = 0" — valia só para o backfill). Elas logam, mas
  o RLS bloqueia os dados gateados. Estado em 2026-08-08: **7 perfis, 4 confirmados, 3 não**.
- **O caminho de autodesbloqueio existe desde a Etapa 2**, mas ainda sem tela: dá para
  chamar a function `enviar-email` com o JWT da conta e abrir o link. A tela
  `/verifique-email` é a Etapa 3, e confirmar uma dessas contas pelo e-mail real é o
  teste fim a fim natural. Para destravar sem e-mail, é UPDATE manual em `profiles`
  via Management API.
- ⚠️ **Etapa 4 — `purge:contas --nao-confirmadas <dias>` apagaria as três** se ainda
  estiverem com NULL ao rodar. Duas são contas do próprio dono do projeto — confirmar
  antes de qualquer purge; só `ciufla0+teste@gmail.com` é descartável.

</details>

---

## 3. Etapa 2 — Edge Function `enviar-email` ✅ **PUBLICADA EM PRODUÇÃO** (2026-08-08)

`supabase/functions/enviar-email/index.ts` — primeira Edge Function do projeto.
Versão 1, `ACTIVE`, em `https://awkkkxelfhlpxktzzhzk.supabase.co/functions/v1/enviar-email`.

### 3.1 Contrato que a Etapa 3 consome

`POST {SUPABASE_URL}/functions/v1/enviar-email`, corpo `{"proposito":"verificacao_email"}`.
Pelo cliente: `supabase.functions.invoke("enviar-email", { body: { proposito: "verificacao_email" } })`
— o supabase-js já anexa o JWT da sessão.

| HTTP | corpo | o que a UI faz |
|---|---|---|
| 200 | `{ ok: true, message_id }` | "e-mail enviado, confira a caixa (e o spam)" |
| 429 | `{ ok:false, erro:"aguarde", segundos:N }` | **usar `segundos` como cooldown do botão** |
| 409 | `{ ok:false, erro:"ja_confirmado" }` | já confirmou — mandar para o portal |
| 401 | `{ ok:false, erro:"sem_sessao" }` | sessão morta → `/login` |
| 400 | `{ ok:false, erro:"proposito_invalido"｜"corpo_invalido" }` | erro de programação, não do usuário |
| 404 | `{ ok:false, erro:"usuario_invalido" }` | idem |
| 502 | `{ ok:false, erro:"falha_envio" }` | "não conseguimos enviar agora, tente de novo" |
| 500 | `{ ok:false, erro:"config_ausente"｜"falha_token" }` | falha de servidor — botão de tentar de novo |

⚠ **Armadilha do `functions.invoke`**: para qualquer status fora de 2xx o supabase-js
**não** devolve o corpo em `data` — devolve `error` (um `FunctionsHttpError`) e o JSON
tem de ser lido de `await error.context.json()`. Sem isso, o 429 vira "erro genérico" e o
cooldown de 60 s da Etapa 3 nasce cego.

⚠ **Sem Authorization nenhum quem responde é o gateway da plataforma**, não a function:
401 `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}`, com `Access-Control-Allow-Origin: *`. Só isso
não passa pelo nosso código.

**CORS**: a allowlist (`http://localhost:5000`, `http://127.0.0.1:5000`,
`https://ciuflaictin.com.br`, `https://www.ciuflaictin.com.br`) está no fonte da function —
origem nova exige editar `index.ts` e `npm run deploy:functions` de novo. Origem fora da
lista recebe 204 **sem** o cabeçalho `Access-Control-Allow-Origin`, e o navegador barra.

### 3.2 Comandos novos (ambos tocam produção)

- `npm run deploy:functions` — multipart em `/v1/projects/{ref}/functions/deploy?slug=…`,
  campo `metadata` (JSON) + um campo `file` por arquivo. `entrypoint_path` e o nome de cada
  parte são **relativos à raiz do repo, com barras normais** (`supabase/functions/…`) — é
  assim que o CLI oficial monta, e o servidor casa um com o outro. Sem CLI, sem Docker.
  `verify_jwt: true` no metadata: o gateway barra quem não manda JWT.
- `npm run config:secrets` — grava `BREVO_API_KEY`, `EMAIL_REMETENTE`, `SITE_URL`.
  Os três são capturados **antes** do `loadDotEnv()`: nem um `.env` local consegue supri-los.
  `-- --listar` mostra só os nomes.

### 3.3 Evidência colhida ao vivo (2026-08-08)

| Verificação | Resultado |
|---|---|
| `POST` sem JWT | 401 `UNAUTHORIZED_NO_AUTH_HEADER` (gateway) |
| `POST` com a chave pública crua como Bearer | 401 `{"erro":"sem_sessao"}` — passa pelo gateway e **morre no `getUser()`** |
| `OPTIONS` de `http://localhost:5000` | 204 + `Access-Control-Allow-Origin: http://localhost:5000` |
| `OPTIONS` de origem estranha | 204 **sem** `Access-Control-Allow-Origin` |
| corpo não-JSON | 400 `corpo_invalido` (sem crash) |
| `{"proposito":"redefinir_senha"}` | 400 `proposito_invalido` — barrado **antes** da RPC |
| 1º envio com JWT válido | 200, `message_id <202608081712.46922909477@smtp-relay.mailin.fr>` |
| 2º envio imediato | 429 `{"erro":"aguarde","segundos":58}` |
| linha em `tokens_email` | `token_hash` = 64 hex (`^[0-9a-f]{64}$`), `message_id` preenchido, `used_at` NULL, expira em 24 h |
| corpo com `email:"outro@x.com"` + `user_id` falso | 200 — e o token novo continua com `email = ciufla0+teste@gmail.com`. **Campos injetados ignorados** |
| entrega real (API de eventos do Brevo) | os dois e-mails `delivered`. O `opened` do primeiro é o pixel do proxy do Gmail, não um clique humano |
| assunto no Brevo | `"Confirme seu e-mail — Congresso Unificado ICTIN"` com `U+2014` correto (o `â` que aparece no console do PowerShell é artefato de exibição, não do e-mail) |

### 3.4 Remetente e DNS — VERIFICADOS, não são mais pendência

`EMAIL_REMETENTE = "Congresso Unificado ICTIN <mail@ciuflaictin.com.br>"`.
O que está publicado (conferido com `Resolve-DnsName -Server 1.1.1.1`):

```
ciuflaictin.com.br            TXT   v=spf1 -all          ← apex não autoriza ninguém
                              TXT   brevo-code:71443972…
mail.ciuflaictin.com.br       TXT   v=spf1 include:spf.brevo.com -all
brevo1._domainkey…            CNAME b1.…dkim.brevo.com → chave RSA publicada
brevo2._domainkey…            CNAME b2.…dkim.brevo.com → chave RSA publicada
_dmarc.ciuflaictin.com.br     TXT   v=DMARC1; p=reject;
```

O `v=spf1 -all` no apex **assusta mas está certo**: o DMARC passa por alinhamento de
**DKIM** (assinatura `d=ciuflaictin.com.br`, mesma do `From:`) e o Return-Path sai por
`mail.ciuflaictin.com.br`, que inclui o Brevo. Endereço novo nesse domínio herda tudo;
trocar para **outro** domínio exigiria repetir SPF+DKIM lá. Não mexer no apex.

### 3.5 Resíduos desta etapa

- **Conta de teste real criada em produção**: `ciufla0+teste@gmail.com`
  (`ef7cf840-96e2-44be-bea3-353c3e8c5c0e`), não confirmada, papel `externo`.
  ⇒ agora são **3** contas não confirmadas (§2.6 já atualizado). Remover na Etapa 4
  via `purge:contas` — é a única das três que é descartável.
- **2 tokens em aberto** para essa conta (o reenvio não invalida o anterior — decisão 4).
  Qualquer um dos dois confirma; o outro passa a devolver `ja_confirmado`.
- **Orçamento do dia**: 2 de 300 e-mails consumidos em 2026-08-08.

---

## 4. Etapa 3 — rotas SPA ✅ **PUBLICADA E VERIFICADA FIM A FIM** (2026-08-08)

Nenhuma migration: a Etapa 3 é só frontend. Publicada e conferida em produção — ver
§4.5 (deploy + trilha do banco) e §4.6 (a prova de que o gate abre ao confirmar).
O que subiu para o repo:

| Arquivo | Papel |
|---|---|
| `src/lib/verificacaoEmail.ts` | lógica **pura** — traduz resultado da RPC e resposta da function em estado de tela |
| `src/lib/portais.ts` | papel → rota inicial + saudação (era duplicado em `Login.tsx` e `ProtectedRoute.tsx`) |
| `src/services/verificacaoEmailService.ts` | as 3 chamadas de servidor da feature |
| `src/pages/ConfirmarEmail.tsx` | `/confirmar-email` (pública) |
| `src/pages/VerifiqueEmail.tsx` | `/verifique-email` (autenticada) |
| 4 arquivos em `src/test/` | 49 testes novos (total do projeto: **70**) |

Editados: `App.tsx`, `pageTitles.ts` (+ teste), `AuthContext.tsx`, `ProtectedRoute.tsx`,
`Login.tsx`, `Cadastro.tsx`, `robots.txt`, `_headers`, `vercel.json`, `nginx.conf.example`,
`apache.htaccess.example`.

### 4.1 Decisões que as Etapas 4+ precisam conhecer

- **`AuthContext` ganhou `emailConfirmado: boolean | null` e `revalidarEmailConfirmado()`.**
  `null` significa **"não sei"** (sem sessão ou RPC fora do ar) e **não bloqueia** —
  tratar `null` como "não confirmado" trancaria o usuário para fora da interface por
  causa de um erro de rede. Só `false` desvia. Quem tranca de verdade continua sendo o RLS.
- **`revalidarEmailConfirmado()` é obrigatório após confirmar.** Quem confirma com a aba
  aberta carrega o `false` antigo em memória; sem reler, o `ProtectedRoute` devolveria a
  pessoa recém-confirmada para `/verifique-email`. A `/verifique-email` também relê no
  `visibilitychange` (confirmar no celular e voltar para o desktop).
- **`ProtectedRoute` ganhou `exigeEmailConfirmado` (padrão `true`).** Só a própria
  `/verifique-email` passa `false` — do contrário desviaria para si mesma em laço.
- **O token sai da URL** (`history.replaceState`) assim que é lido, e a confirmação só
  acontece **no clique**, nunca no mount: o pré-carregador de links do Gmail e antivírus
  abrem a URL sozinhos e queimariam o token antes de a pessoa ver a tela.
- **`/verifique-email` recebe `state: { enviado }`** do cadastro: o e-mail já saiu, então
  o botão nasce em contagem em vez de gastar um clique para receber 429.
- **Login de não confirmado vai para `/verifique-email`** (o `signIn` continua funcionando —
  postura "login permitido, uso bloqueado").

### 4.2 Armadilha nova, do TypeScript (custou o primeiro `tsc` da etapa)

`tsconfig.app.json` tem **`"strict": false`**. Sem `strictNullChecks`, o TypeScript
**não estreita união por discriminante booleano**: com `type R = {ok:true;…} | {ok:false;…}`,
depois de `if (r.ok) return;` o `r.erro` continua inacessível (`TS2339`). `if (r.ok === true)`
funciona; a forma idiomática, não. Por isso `RespostaEnvio` discrimina pela **string**
`estado: "enviado" | "falha"`. Vale para qualquer união nova neste projeto.

### 4.3 Evidência colhida (2026-08-08)

| Verificação | Resultado |
|---|---|
| `npm run lint` | **0 erros**, 9 warnings `react-refresh` (baseline intacto) |
| `npm run test` | **70/70** em 6 arquivos |
| `npx tsc --noEmit -p tsconfig.app.json` | limpo |
| `npm run build` | ok (`dist/` gerado) |
| `npm run check:consolidacao` | OK — `supabase.auth.signOut()` na tela nova é legítimo (`auth` é sessão, não consulta) |
| `npm run check:seguranca` | 5/5 passam limpas **e** detectam o canário |
| RPC ao vivo, chave pública: `confirmar_email("lixo")` e `("")` | HTTP 200 `"invalido"` — o caminho que a tela renderiza |
| RPC ao vivo: `email_confirmado()` como `anon` | 401 `42501` permission denied ⇒ o service devolve `null` ⇒ não bloqueia ninguém |
| dev server (porta 5000) | `/confirmar-email?token=abc` e `/verifique-email` ⇒ 200; os 4 módulos novos transformam sem erro; console sem erros |

Testes que travam as regras que só se percebe quebrando: token some da URL no mount ·
RPC **não** é chamada até o clique · erro de rede vira "tentar de novo", nunca "link
inválido" · o `segundos` do 429 sai de `error.context.json()` e vira a contagem do botão ·
corpo não-JSON no erro cai no status · `emailEstaConfirmado()` devolve `null` (não `false`)
quando a RPC falha.

### 4.4 Nota de implementação

`supabase-js` **não** tem corrida entre `signUp` e `functions.invoke`: nesta versão o
`invoke` resolve o JWT por requisição (`fetchWithAuth` → `auth.getSession()`), então o
e-mail do cadastro sai com a sessão recém-criada. Verificado no fonte de `node_modules`.

### 4.5 ✅ PUBLICADA E VERIFICADA FIM A FIM (2026-08-08)

`npm run deploy` — build-id `2026-08-08T20-27-24-240Z`, worker `ciufla` versão
`4c076f28-4b4e-4828-b610-2876163e7c3a`. As 5 travas do bundle, a de consolidação e as 9
verificações da URL publicada passaram. Conferido em produção depois:

| rota | resultado |
|---|---|
| `/confirmar-email?token=…` | 200, serve o index da SPA, `X-Robots-Tag: noindex, nofollow` |
| `/verifique-email` | 200, idem |
| `/login` (controle) | 200 **sem** noindex — o cabeçalho é por rota, não geral |
| `robots.txt` | as duas linhas `Disallow` no ar |

**O fluxo real foi exercitado pelo usuário, com e-mail de verdade**, e a trilha no banco
fecha (auditoria por Management API):

```
gustavo.silva39@estudante.ufla.br   conta criada 20:05:25
  token cunhado  20:05:26   (1 s depois — o envio automático do /cadastro)
  token usado    20:05:51   (26 s depois — o clique no link)
  email_confirmado_em = 20:05:51.065781   ← MESMO timestamp do used_at
```

O `used_at` e a confirmação carimbam **o mesmo instante**: é a transação única da RPC
(marcar usado + confirmar o usuário), exatamente o desenho da §4 do blueprint. Hash de 64
hex, validade de 24 h, `message_id` do Brevo gravado, e nenhuma coluna de texto na
`tokens_email` que pudesse guardar o token cru.

### 4.6 A prova que faltava: o gate abre depois de confirmar

Era o item nunca verificado em etapa nenhuma — "o gate funciona" vs. "o gate trancou todo
mundo para sempre". Feito **com a SPA fora do caminho**: JWT real de cada usuário (via
`admin.generateLink` + `verifyOtp`, não a service_role, que ignoraria o RLS) direto no
PostgREST.

Alvos escolhidos a dedo: `categorias`, `criterios` e `allowed_email_domains` têm policy
`(true AND email_confirmado())` — quem confirmou vê TUDO, quem não confirmou vê ZERO. Sem
a ambiguidade de "lista vazia porque não tenho linhas minhas".

| conta | próprio profile (ramo sem gate) | categorias | criterios | allowed_email_domains |
|---|---|---|---|---|
| `…silva39@estudante.ufla.br` (confirmada) | 1 | **4** | **20** | **4** |
| `gustavo.silva39@gmail.com` (NÃO confirmada) | 1 | **0** | **0** | **0** |

A linha de controle é o que dá valor ao resto: a conta não confirmada **continua lendo o
próprio profile** (o ramo não gateado da policy), então o JWT é válido e autenticado — os
zeros são o gate disparando, não um token quebrado. Nenhuma confirmação mudou por causa do
teste.

**Resíduo:** `gustavo.silva39@gmail.com` (papel `externo`, criada 20:04) ficou **não
confirmada, com 1 token em aberto** — é a conta que serviu de controle negativo. Útil
como fixture; some no `purge:contas --nao-confirmadas` da Etapa 4.

Uma leitura que assusta e não é bug: a auditoria acusa "1 confirmação sem token usado" —
é a conta admin, confirmada pelo **backfill** da migration da Etapa 1, que antecede o
fluxo de token. E as 4 policies de `storage` sem o gate (`pdfs owner insert`, `avatars
owner write/update/delete`) são as documentadas na §2.2: só têm ramo "pasta do próprio
usuário", onde o gate parcial seria no-op.

---

## 5. Local → hospedado (assunto das Etapas 2 e 3)

O banco **já é produção**; só o frontend é local. Isso se concentra em um ponto: o secret
`SITE_URL` da Edge Function.

- **Domínio de produção definido (2026-08-08): `ciuflaictin.com.br`.**
  ⇒ `SITE_URL = https://ciuflaictin.com.br` (fixo desde o início, sem vaivém de secret) e
  é o domínio do remetente a verificar no Brevo (SPF/DKIM). Para testar local, copiar o
  `?token=...` do e-mail e colar em `http://localhost:5000/confirmar-email?token=...` —
  o token vive no mesmo banco, a RPC é a mesma, confirma igual.
- `site_url`/`uri_allow_list` do GoTrue são **inertes hoje** — não usamos `ConfirmationURL`
  do GoTrue. Prova: o Vite roda na porta **5000** (`vite.config.ts:8`) e nada quebra.
  Deixam de ser inertes no dia do reset de senha (`email-verification-futuro.md`).

  ⚠ **A nota antiga daqui, que dizia `http://localhost:3000`, estava VELHA** — a config viva
  já tinha sido corrigida durante o trabalho de Cloudflare. Confiar nela custou caro em
  2026-08-08: um script "de higiene" sobrescreveu `uri_allow_list` com **um** origin e
  derrubou `https://ciufla.ictin-ufla.workers.dev/**`, que é a URL verificada por
  `npm run deploy -- --preview`. Reposto como superconjunto dos três origins que servem a
  SPA (apex, `www.`, workers.dev). **Regra: essa lista só cresce.**
  Lição maior: **ler a config viva antes de "corrigir"** o que uma nota afirma, e nunca
  encadear simulação e `--aplicar` no mesmo bloco — a simulação existe para ser lida.

  ⚠ `mailer_autoconfirm` **não** pode ser tocado: sem ele o GoTrue passa a exigir
  confirmação própria, que não existe (SMTP vazio), e ninguém mais entra.
- Deep link SPA **já resolvido e VERIFICADO ao vivo (2026-08-08)** — o site está hospedado
  em Cloudflare Workers (não mais tunnel local): `wrangler.jsonc` tem
  `assets.not_found_handling = "single-page-application"` e
  `https://ciuflaictin.com.br/confirmar-email` já responde **200** (a SPA carrega na rota
  antes mesmo de ela existir). `public/_redirects` não existe mais. Rotas novas herdam de graça.
- **Único conflito real de dois ambientes:** o CORS da Edge Function precisa aceitar
  `http://localhost:5000` **e** `https://ciuflaictin.com.br`. ✅ Resolvido na Etapa 2
  (allowlist no fonte da function — ver §3.1).

---

## 6. Purga de contas — EXECUTADA EM PRODUÇÃO (2026-08-08)

### 6.1 Estado do banco depois da purga

A pedido do usuário, **sobrou uma única conta**: `gustavo.silva47@estudante.ufla.br`
(`34df44eb-1e77-4be1-8fa0-74a53a0b6571`, confirmada, papéis `admin, avaliador, estudante,
professor`). Foram removidas 6: `gustavo.silva39@estudante.ufla.br`, `azazelares9@gmail.com`,
`bytsuki066@gmail.com`, `gustavo.vitor.silva47@gmail.com`, `ciufla0@gmail.com` e
`ciufla0+teste@gmail.com` — ou seja, **as três não confirmadas do §2.6/§3.5 já não existem**.

Contagens conferidas depois, por consulta independente do script:

```
1 auth.users · 1 profiles · 4 user_roles · 0 tokens_email · 4 trabalhos
0 pareceres · 0 trabalho_revisores · 0 estudantes/professores/avaliadores
0 congress_registrations · 0 minicourse_registrations · 0 certificates
6 storage.objects (4 PDFs do sobrevivente + 2 modelos de certificado)
```

Zero resíduo: nenhum `profiles`/`user_roles`/`trabalhos`/`tokens_email` apontando para conta
inexistente, nenhum objeto no `Pdfs` fora da pasta do sobrevivente, e nenhum `trabalhos.pdf_url`
apontando para arquivo que não existe mais.

**Efeitos colaterais esperados, não são bug:** as tabelas legadas `avaliadores`, `estudantes`
e `professores` ficaram **vazias** (as fichas eram das contas removidas) — a lista de
avaliadores do portal de co-chairs aparece vazia. E os 4 trabalhos do sobrevivente ficaram
**sem pareceres e sem revisores atribuídos**; um deles ("Teste 1") continua com status
`aprovado` sem parecer nenhum sustentando. É dado de teste, mas confunde numa auditoria.

### 6.2 O `purge-contas.js` ganhou remoção de arquivos

Antes ele **não apagava arquivo nenhum** — só listava os PDFs órfãos e mandava usar o painel.
Agora:

- remove os objetos das contas apagadas em **todos os buckets** (a pasta de cada usuário é o
  `auth.uid()` dele: `<bucket>/<user_id>/...`), via API de Storage com a `service_role` — o
  blob **não** é alcançável por SQL, `storage.objects` é só o índice;
- **baixa cada arquivo para `supabase/backups/…-arquivos/` ANTES de qualquer DELETE**, e
  aborta a purga inteira se um download falhar (backup que só guarda o caminho de um arquivo
  já apagado não é backup);
- `--orfaos` inclui os objetos soltos na **raiz do `Pdfs`**, anteriores ao padrão
  `<user_id>/arquivo` — sem dono, nenhuma remoção de conta os alcança. A varredura de órfãos
  é restrita ao `Pdfs` **de propósito**: em `certificate-templates` o primeiro segmento é a
  categoria do modelo (`minicourse`, `schedule`), e varrer lá apagaria os modelos do evento.
- Sem `SUPABASE_SERVICE_ROLE_KEY` o script continua rodando, mas avisa que os arquivos ficaram.

Comando usado (7 arquivos removidos: 2 das contas + 5 órfãos da raiz):

```powershell
$env:KEEP_EMAILS = "gustavo.silva47@estudante.ufla.br"
node scripts/purge-contas.js --apply --orfaos
```

⚠ **`DEFAULT_KEEP` no fonte ainda preserva DUAS contas** (`silva39` e `silva47`). Rodar o
script sem `KEEP_EMAILS` recriaria a exceção de `silva39`, que agora não existe mais.

Backup local (gitignored, contém PII e os PDFs):
`supabase/backups/purge-contas-2026-08-08.json` + `…-2026-08-08-arquivos/`.

---

## 6b. Sequestro de e-mail — FECHADO (2026-08-08, migration 18)

`supabase/migrations/20260808220000_liberar_email_nao_confirmado.sql` — **APLICADA**.

**O buraco:** qualquer pessoa digitava o e-mail alheio no `/cadastro` e nunca confirmava.
A conta pendente ficava lá e o GoTrue passava a responder "User already registered" para
o **dono** do endereço — trancado para fora, para sempre, sem nada que pudesse fazer
sozinho. Barato de executar e permanente. Contradiz a decisão 9 do prompt ("comportamento
atual aceito"), que o usuário revogou explicitamente — era decisão de escopo, não de risco.

**A regra nova:** um e-mail só fica ocupado quando a **posse da caixa é provada**. Enquanto
a conta não confirmou, o cadastro seguinte com o mesmo endereço a apaga e assume o lugar.

```sql
public.liberar_email_nao_confirmado(p_email text) RETURNS text
  -- liberado | confirmado | inexistente | tem_dados | muitas_tentativas | invalido
  -- GRANT: anon (o /cadastro não tem sessão) + authenticated. Nunca lança.
  -- Limites (migration 20260809000000): 5 chamadas / 10 min por IP
  --   E 5 REMOÇÕES / hora por e-mail alvo, consumido só quando há remoção.
```

**Os dois limites, e por que o segundo é o que importa** (migration `20260809000000`):
o limite por IP não protege de atacante decidido — IP se troca. O ataque que sobra com
dano real é escolher **uma** vítima e apagar a conta pendente dela repetidamente, para o
link morrer antes de ela clicar, deixando-a sem conseguir cadastrar nunca. Esse ataque é
definido pelo **e-mail alvo**, não pela origem, então é ali que o limite morde. Ele é
consumido **só no ponto em que há remoção**: consultar um e-mail confirmado não gasta cota
de ninguém (a resposta não muda nada), e um cadastro legítimo repetido gasta 1 por vez.

**Enumeração — decisão consciente, não esquecimento.** A RPC continua distinguindo
`inexistente` de `confirmado`. O GoTrue já responde "User already registered" no signup,
então a existência da conta nunca foi segredo; o que se acrescenta é o bit "confirmada ou
não". Uniformizar as respostas **não fecharia o canal** — o efeito destrutivo já separa os
estados — e custaria a mensagem certa para quem só esqueceu que já tem conta. O que ficou
fechado foi o ataque que o vazamento habilitava, acima.

Decisões que não devem ser revertidas sem pensar:

- **Apagar, não tomar posse.** Trocar a senha da conta pendente e reusá-la parece mais
  gentil e é uma porta de sequestro: o invasor define a senha, o **dono** clica no link
  que está na caixa dele, e a conta é confirmada já com a senha do invasor. Apagando, o
  id é outro e o token antigo morre no CASCADE.
- **`avaliadores` fica intocado.** Aquela linha é da organização, não do cadastro — se
  entrasse na limpeza, um sequestrador apagaria revisor cadastrado. Saem só `estudantes`
  e `professores`, recortados por `user_id` (o que ESTA conta criou), e o CASCADE de
  `auth.users` leva `profiles`, `user_roles` e `tokens_email`.
- **Recusa se houver trabalho** (`tem_dados`). Não deveria acontecer — `trabalhos insert`
  é gateado — mas ninguém apaga submissão por engano.
- **Conta sem `profiles`** conta como não confirmada: sem perfil o `handle_new_user`
  falhou, `email_confirmado()` é falso e ela já não alcança nada.
- **Resíduo §2.5 fechado junto**: `pdfs owner insert` ganhou `AND email_confirmado()`.
  Deixou de ser inofensivo — conta pendente que sobe arquivo e depois é liberada deixaria
  blob órfão em bucket privado, sem dono e sem linha em `trabalhos` que o alcance.

No cliente: `ehEmailJaCadastrado()` (gatilho, em `src/lib/verificacaoEmail.ts`) só dispara
para o erro certo do GoTrue — testado pelos **dois** lados, porque falso negativo só repete
a falha antiga e falso positivo manda apagar conta. `Cadastro.tsx` tenta o `signUp`, e
**só** se o erro for "já registrado" chama a RPC e repete **uma** vez.

Ensaio contra o banco real, dentro de um `DO` revertido por `RAISE` (o truque da Etapa 1 —
prova função destrutiva sem arriscar conta):

```
malformado=invalido | inexistente=inexistente | confirmada=confirmado
| nao_confirmada=liberado | contas 5->4
depois do rollback: contas 5, tokens 5   ← idêntico ao estado inicial
```

`anon_executa=true`, `security_definer=true`, `pdfs owner insert` com gate. `tsc` limpo
após `gen:types` (a RPC entrou nos tipos: +4 linhas, nenhum `as any`).

---

## 6c. Por que os e-mails pararam de chegar (2026-08-08)

**Causa raiz: chave SMTP do Brevo gravada no lugar da chave da API v3.** O painel do Brevo
mostra as duas lado a lado em *SMTP & API*; a SMTP não vale para a API REST. A `enviar-email`
cunhava o token (a conta e o token existiam no banco), chamava o Brevo, tomava
`401 {"message":"Key not found","code":"unauthorized"}` e devolvia 502 `falha_envio`.
Cadastro seguia funcionando — o envio está fora da transação, por desenho.

**O que deixava isso invisível:** `config:secrets` conferia só o prefixo `xkeysib-` e
gravava. `--listar` mostra o NOME do secret, nunca o valor. Chave morta entrava calada.

**Fechado:** `config:secrets` agora chama `GET /v3/account` com a chave **antes de gravar**
e **aborta sem gravar nada** se o Brevo recusar. Também procura o domínio do
`EMAIL_REMETENTE` entre os autenticados da conta e avisa alto se não achar — com
`_dmarc p=reject` publicado (§3.4), domínio sem DKIM é e-mail aceito pelo Brevo e
**descartado em silêncio** pelo destinatário, que é o modo de falha mais caro de depurar.

---

## 7. Etapa 4 — definição de pronto ✅ **FECHADA** (2026-08-08)

Todas as linhas da tabela do `email-verification-prompt.md` têm evidência. As três que
faltavam foram exercitadas **em produção, no navegador, pelo usuário**, depois do
`npm run deploy` que publicou o fix de sequestro (§6b).

| Linha da tabela da Etapa 4 | Evidência |
|---|---|
| Conta não confirmada não alcança dados protegidos | ✅ §4.6 — JWT real no PostgREST, SPA fora do caminho: confirmada lê 4/20/4 em `categorias`/`criterios`/`allowed_email_domains`, não confirmada lê 0/0/0, e **as duas leem o próprio profile** (controle que prova que o zero foi o gate, não um JWT quebrado) |
| Token funciona exatamente uma vez; repetir é desfecho calmo | ✅ fluxo real: 1º clique ⇒ `confirmado`, 2º clique **no mesmo link** ⇒ `ja_confirmado`. A trilha mostra `used_at = email_confirmado_em` ao microssegundo (`mesma_transacao: true`) — a transação única da RPC |
| Expirado/inválido têm caminho adiante | ✅ olho humano: token vencido via `expirar` ⇒ tela **expirado**; `?token=lixo` + clique ⇒ tela **inválido**. (Antes só havia teste de componente.) |
| Cadastro sobrevive ao provedor fora do ar | ✅ duas vezes: com a chave revogada de propósito, e **sem querer** — a semana toda com chave SMTP no lugar da API (§6c). A conta sempre foi criada e a tela de reenvio ficou utilizável |
| Link funciona em produção, celular, sem sessão | ✅ link aberto em **janela anônima**, sem sessão, no domínio de produção ⇒ confirma e cai em `/login` |
| Nada no banco forja link válido | ✅ 8 tokens, **8 com hash de 64 hex, 0 fora do formato**, e nenhuma coluna da tabela comporta o token cru (`token_hash`, `user_id`, `proposito`, `email`, `expires_at`, `used_at`, `created_at`, `message_id`) |
| Orçamento de envio fecha | ✅ 180 + ~30% ≈ 234 ≤ 300/dia (Brevo free), folga ~25% |

Prova de que o envio voltou (§6c), na mesma trilha:

```
azazelares9@gmail.com
  conta criada  23:12:39 · token cunhado 23:12:40 · usado 23:12:55
  email_confirmado_em 23:12:55.096099   ← mesma_transacao: true
  message_id <202608082312.39610918167@smtp-relay.mailin.fr>
```

⚠️ **Ao escolher a tabela para provar o gate, NÃO use `trabalhos`**, embora o prompt a
sugira: a policy dela depende de ser dono/revisor, então "lista vazia" pode ser o gate OU
"não tenho trabalhos" — não prova nada. Use as de policy `(true AND email_confirmado())`:
`categorias` (4 linhas), `criterios` (20), `allowed_email_domains` (4). E mantenha a
leitura do **próprio profile** como controle: ela funciona para não confirmado também
(ramo sem gate), e é o que prova que um zero foi o gate e não um JWT quebrado.

### 7.1 `--nao-confirmadas [dias]` — PRONTO (2026-08-08), não executado

`scripts/purge-contas.js` ganhou o modo **retenção**: remove só as contas que nunca
confirmaram e já passaram da carência (padrão 30 dias, contada do `created_at`), mais os
`tokens_email` vencidos há mais de 30 dias. Simulação continua sendo o padrão.

O que sustenta a segurança do modo novo, e não pode ser "simplificado" depois:

- **Os DELETEs derivados são recortados pelos ids/e-mails EXATOS das contas inventariadas**
  (arrays literais em SQL), nunca por "tudo fora da lista". Assim o que é apagado é
  exatamente o que entrou no backup, e nenhum passo depende de o passo anterior ainda não
  ter rodado — no modo padrão o recorte é subconsulta, e a ordem importa.
- O modo padrão ficou **byte a byte com a semântica antiga** (inclusive apagar linha de
  e-mail sem conta nenhuma nas tabelas legadas, que era o objetivo da faxina original).
- Backup com nome próprio (`purge-nao-confirmadas-<data>.json`): uma retenção não
  sobrescreve o backup da faxina do mesmo dia.
- Avisa quando um e-mail da lista de preservação **não existe no banco** — a lista
  envelhece, e e-mail que não existe não protege nada (era o footgun do §6.2).

### 7.2 Estado final do banco (2026-08-08, 23h20) e o que a retenção provou

Limpeza executada em produção. **Sobrou 1 conta**: `gustavo.silva47@estudante.ufla.br`
(`34df44eb-…`, confirmada 2026-08-05). Contagens conferidas depois:

```
1 conta · 1 confirmada · 0 não confirmadas · 0 tokens_email
Storage: 4 PDFs da conta sobrevivente + 2 modelos de certificado
```

**O que a retenção provou, e o que NÃO provou:**

- ✅ **O predicado está certo, contra dados reais.** A simulação `--nao-confirmadas 0`
  listou **exatamente** as 3 contas não confirmadas (`bytsuki066@`, `ciufla0@`,
  `gustavo.silva39@gmail`), com a idade em dias, e **nenhuma confirmada** — que era o
  risco a descartar. Com a carência padrão de 30 dias nenhuma delas apareceria: todas
  eram do mesmo dia.
- ❌ **Os DELETEs do modo retenção nunca rodaram em produção.** O `--apply` morreu com
  **502 Bad Gateway da `api.supabase.com`** (Cloudflare, transitório) durante a consulta
  de inventário de `profiles` — ou seja, **na fase de leitura, antes do backup e antes de
  qualquer DELETE**. A simulação seguinte reencontrou as 6 contas intactas, o que confirma
  que nada foi apagado pela metade. O desenho "backup antes de tudo, e aborta cedo"
  funcionou; a limpeza saiu toda pelo modo padrão logo depois.
- Diferença que continua sem exercício ao vivo: no modo retenção os DELETEs derivados usam
  `= ANY(ARRAY[…]::uuid[])` com literais, e no modo padrão usam subconsulta. A forma com
  array só rodou contra o harness local. Fechar isso custa um cadastro descartável não
  confirmado + `--nao-confirmadas 0 --apply`.

⚠️ **`purge-contas-2026-08-08.json` foi PERDIDO** nesta sessão: um harness de teste rodou
o script com `--apply` contra um `fetch` falsificado, e o backup grava com nome fixo por
data — sobrescreveu o dump real da purga das 16:56 com dados falsos. **Os 7 PDFs em
`…-2026-08-08-arquivos/` estão intactos** (é a parte insubstituível); o que se perdeu foi o
dump das linhas das 6 contas removidas, cujo resumo sobrevive no §6.1. Lição registrada no
harness: hoje ele bloqueia `writeFileSync`. Se for testar o script de novo, **não** use
`--apply` sem neutralizar a escrita em disco.

---

## 8. Pendências abertas

| Item | Etapa |
|---|---|
| Os DELETEs do modo retenção nunca rodaram em produção (502 transitório abortou o `--apply` na leitura — §7.2). Custa um cadastro descartável não confirmado para fechar | 4 |
| `DEFAULT_KEEP` do `purge-contas.js` ainda lista `gustavo.silva39@estudante.ufla.br`, que **não existe mais** depois da limpeza de 23h20. Rodar sem `KEEP_EMAILS` preserva um fantasma — o script agora AVISA, mas a lista embutida segue desatualizada | — |
| **ACEITO como está** (decisão do usuário, 2026-08-08): aparência das duas telas novas em navegador e o caminho "rede" com DevTools offline seguem cobertos só por teste, sem olho humano. Reutilizam `.cadastro-card`, sem CSS novo — o risco é cosmético | — |
| **ACEITO como está**: ninguém observa `message_id IS NULL` em `tokens_email` automaticamente. É o sinal precoce de envio quebrado — foi o que ficou invisível por dias em §6c. Olhar manualmente no dia da abertura: `SELECT count(*) FROM tokens_email WHERE message_id IS NULL` | — |
| **ACEITO como está**: orçamento de envio 180 + ~30% ≈ **234 ≤ 300/dia** (Brevo free), folga ~25%. Se a janela concentrar mais, um mês do plano pago | — |
| Reset de senha / troca de e-mail e fila/outbox: movidos para **`email-verification-futuro.md`**, com o que reaproveitam e as armadilhas de cada um | fora de escopo |

Resolvidas na Etapa 2: CORS da function · remetente/SPF/DKIM/DMARC no Brevo (§3.4) ·
`supabase/functions/**` nos `ignores` do `eslint.config.js`.
Resolvida na purga (§6): remoção de `ciufla0+teste@gmail.com` — junto com todas as outras.

🔑 **Rotação CONCLUÍDA em 2026-08-08** — as três chaves expostas no chat foram trocadas e a
revogação foi **verificada de fora**: a `service_role` vazada e o `SUPABASE_ACCESS_TOKEN`
vazado respondem **HTTP 401**. O site publicado **não** quebrou porque o projeto usa o
sistema novo de chaves (`sb_publishable_…`), independente do `service_role` — a impressão
digital da chave no bundle no ar bate com a do `.env`, então não houve necessidade de
redeploy. (Se um dia rotacionarem pelo **JWT secret legado**, a chave pública cai junto e aí
o `.env` + `npm run deploy` viram obrigatórios.)

⚠️ **A sessão da Etapa 4 precisa das chaves NOVAS no ambiente** — as antigas destas notas
estão mortas. Sem `SUPABASE_ACCESS_TOKEN` não há leitura do banco; sem
`SUPABASE_SERVICE_ROLE_KEY` não há remoção de arquivo no Storage nem cunhagem de JWT de
teste (`admin.generateLink`).

---

## 9. Dívida de lint — RESOLVIDA (2026-08-06, entre as Etapas 1 e 2)

Eram 79 erros pré-existentes (76 `no-explicit-any` + 2 `no-empty-object-type` + 1
`no-require-imports`); agora **`npm run lint` = 0 erros** (9 warnings `react-refresh`,
todos `warn` por config). **Baseline das Etapas 2–4: lint zerado** — erro novo é da etapa
que o introduziu.

O que foi feito:

- **`npm run gen:types`** (novo, `scripts/gen-types.js`): regenera
  `src/integrations/supabase/types.ts` do schema **vivo** via Management API
  (`GET /v1/projects/{ref}/types/typescript` — sem CLI, sem Docker, somente leitura).
  **Rodar após toda migration aplicada** — o congelamento desse arquivo era a causa raiz
  dos `as any`. A Etapa 3 já encontra `email_confirmado`/`confirmar_email` tipadas.
- Removidos `const sb = supabase as any` / `(supabase.rpc as any)` dos 22 arquivos e as
  anotações `: any` decorrentes; `catch (e: any)` → `instanceof Error`; interfaces vazias
  do shadcn viraram type alias; `require()` do tailwind virou import estático.
- Verificação: `npx tsc --noEmit -p tsconfig.app.json` limpo (atenção: o `tsconfig.json`
  raiz tem `files: []` — `tsc` sem `-p` não checa nada), testes 19/19, `npm run build` ok.

**Bug real de produção que o cast escondia** (achado e corrigido nesta limpeza): as páginas
admin do evento usavam o embed `profiles(...)` a partir de `congress_registrations`,
`certificates` e `minicourse_registrations` — mas **não existe FK dessas tabelas para
`profiles`**, e o PostgREST responde 400 `PGRST200` (confirmado ao vivo com a anon key).
Lista de inscrições, seletor de participantes e certificados emitidos renderizavam vazio.
Corrigido com **join no cliente** (2ª query em `profiles` + `Map`), o padrão que
`AdminVerificar` já usava. *Alternativa estrutural, se um dia quiser o embed:* migration
criando FKs `user_id → profiles(id)` nas 3 tabelas (viável — todo usuário tem profile via
`handle_new_user`) e `npm run gen:types` em seguida.

---

## 10. Como reproduzir as leituras

`POST https://api.supabase.com/v1/projects/{ref}/database/query` com
`Authorization: Bearer $SUPABASE_ACCESS_TOKEN` — o mesmo caminho de `scripts/migrate.js`.
Scripts de apoio ficam no scratchpad da sessão, fora do repo.

> **Segurança:** o `SUPABASE_ACCESS_TOKEN` nunca entra em arquivo versionado (`CLAUDE.md`
> inclusive) — segredo commitado permanece no histórico mesmo depois de apagado. Sempre por
> variável de ambiente: `$env:SUPABASE_ACCESS_TOKEN = "sbp_..."`.
