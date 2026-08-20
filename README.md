# Congresso Unificado ICTIN — UFLA

Plataforma de submissão e avaliação de trabalhos do congresso do ICTIN
(Universidade Federal de Lavras). Autores — da UFLA ou de fora — submetem
trabalhos, revisores emitem pareceres, os co-chairs gerenciam categorias,
atribuições e rankings, e o admin cuida de papéis, prazos e auditoria.

Produção: **<https://ciuflaictin.com.br>** (Cloudflare Workers).

> A área do evento (`/congresso`: inscrição, minicursos, certificados,
> programação) está **congelada** — fora do escopo atual, visível só para o
> admin. Ver [Área congelada](#área-congelada).

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite 7 |
| UI | shadcn/ui + Radix UI + Tailwind CSS |
| Rotas | React Router v6 |
| Estado remoto | TanStack Query |
| Backend / Banco | Supabase (PostgreSQL + RLS + Auth + Storage) |
| Integrações externas | Supabase Edge Functions (Deno) + Brevo (e-mail) |
| Formulários | React Hook Form + Zod |
| PDF | react-pdf (leitura) + pdf-lib (certificados) |
| Testes | Vitest + Testing Library |
| Hospedagem | Cloudflare Workers (static assets) via Wrangler |

**Não há backend próprio.** Toda a regra de negócio e a autorização vivem no
Postgres do Supabase — políticas de RLS e funções RPC, versionadas em
`supabase/migrations/`. O frontend fala direto com o Supabase pela chave
anônima.

**Edge Functions são exceção, não camada de negócio.** Existem só como ponte
para serviços externos que o banco não alcança (envio de e-mail pela Brevo).
Nunca para autorização ou acesso a dado que o RLS já cobre.

---

## O ciclo de um trabalho

```
  autor submete          co-chair recomenda,          3 revisores
  (PDF + vídeo +    →    REVISA e confirma a     →    emitem parecer
   palavras-chave)       distribuição, barrando       por critérios
                         conflito de interesse        da categoria
                                     ↓
      rankings dos           decisão consolidada:
      co-chairs        ←     a MODA dos 3 pareceres
                                     ↓
                     aprovado · aprovado com correções · reprovado
                                     ↓
                         rodada de correção do autor
                     (única escrita que sobrevive ao prazo)
```

- **Submissão** (`/estudante/nova-submissao`): título, autores/orientador,
  categoria, palavras-chave, tipo de resumo (simples ou estendido), link do
  vídeo no YouTube e o PDF. O PDF vai para um bucket **privado**; a leitura é
  sempre por URL assinada.
- **Distribuição de revisores** **não acontece sozinha**. Um co-chair (ou admin)
  clica em "Recomendar distribuição" em `/co-chairs/atribuicoes`;
  `recomendar_distribuicao` devolve uma proposta **sem gravar nada**, a pessoa
  altera o que quiser trabalho a trabalho, e só o "Confirmar" grava — por
  `confirmar_distribuicao`, numa transação em que um par recusado aborta o lote
  inteiro. O pool sai de `user_roles`, excluindo autor, orientador e coautores,
  que é como conflito de interesse é barrado (por trigger, não só na tela).
  A carga é equilibrada com **meta de 4 trabalhos por revisor** — meta, não
  teto: o pool esgotado faz o número passar de 4 em vez de deixar trabalho com
  menos de 3 revisores. Por isso **editar um trabalho não reabre autoria nem
  categoria**, mesmo dentro do prazo: a distribuição pode já ter sido
  confirmada, e mudá-las a invalidaria em silêncio.
- **Decisão consolidada**: cada trabalho recebe até 3 pareceres
  (`aprovado` | `aprovado_correcoes` | `nao_aprovado`) e o status sai da moda
  dos votos; empate 1/1/1 vira "aprovado com correções".
- **Correção**: no desfecho "aprovado com correções" o autor reenvia pela RPC
  `enviar_correcao`, que atravessa o prazo de propósito — é a única escrita do
  autor que continua valendo depois do fim das submissões.
- **Notas e comentários** aparecem em `/estudante/trabalho/:id` em **qualquer**
  desfecho, sem identificação do revisor e só depois da decisão consolidada
  (`pareceres_do_meu_trabalho`).

---

## Portais e papéis

Os papéis ficam na tabela `user_roles` (um usuário pode ter mais de um).
`<ProtectedRoute>` é apenas a barreira de UI; **a barreira real de dados é o
RLS**. A rota inicial de cada papel sai de `src/lib/portais.ts`, nunca de um
`if` local.

| Rota | Portal | Papéis |
|---|---|---|
| `/`, `/login`, `/cadastro` | Público — cadastro unificado (inclui participantes externos) | — |
| `/confirmar-email`, `/esqueci-senha`, `/redefinir-senha` | Fluxos de conta abertos por link de e-mail, sem sessão | — |
| `/verifique-email` | Sala de espera de quem ainda não confirmou o e-mail | todos |
| `/estudante` | Autor: submete, edita no prazo, acompanha notas e corrige | **todos**, inclusive `externo` |
| `/revisor` | Pareceres e avaliações | `professor`, `avaliador`, `admin` |
| `/admin` | Auditoria, conflitos, papéis, usuários, configurações, notificações | `admin` |
| `/co-chairs` | Trabalhos, categorias, atribuições, rankings | `avaliador`, `admin` |
| `/congresso` | Área do evento — **congelada** | `admin` |

**`externo` tem a mesma alçada de autor que `estudante`**: quem é de fora da
UFLA também submete trabalho e cai em `/estudante` no login. Isso não exigiu
migration — o Portal do Estudante é gateado por **dono**
(`owner_id = auth.uid()`, pasta `auth.uid()/` no bucket), nunca por papel.

O Portal Admin tem uma URL por seção (`/admin/papeis`, `/admin/conflitos`,
`/admin/usuarios`, `/admin/configuracoes`, `/admin/notificacoes`); a raiz
`/admin` é a auditoria. As URLs antigas de co-chairs (`/dashboard`,
`/trabalhos`, …) redirecionam para `/co-chairs/...`.

### Área congelada

`/congresso` (inscrição, minicursos, certificados, programação e o
`/congresso/admin`) saiu do escopo e não é desenvolvida até segunda ordem.
Todo o prefixo está atrás de `allowedRoles={["admin"]}` — inclusive o que era
público — e `portalDoPapel` não devolve `/congresso` para papel nenhum. O
código **não é apagado**: ainda há telas que podem migrar para outros portais
(duas já migraram: papéis e usuários, hoje em `/admin`).

---

## Conta e e-mail

- **Verificação de e-mail**: sistema de token próprio (`tokens_email`), com o
  e-mail enviado pela Edge Function `enviar-email` via Brevo. O gate real é
  RLS (`email_confirmado()`), não a UI: `emailConfirmado === null` significa
  "não sei" e **não bloqueia** ninguém.
- **Esqueci minha senha**: fluxo anônimo pela Edge Function `redefinir-senha`,
  com token de uso único.
- Um e-mail só fica ocupado depois de confirmado — conta não confirmada é
  liberável (`liberar_email_nao_confirmado`), senão qualquer um trancaria o
  e-mail alheio para sempre.
- Sinal precoce de envio quebrado:
  `SELECT count(*) FROM tokens_email WHERE message_id IS NULL`.

---

## Prazo de submissão e configurações

Editados em `/admin/configuracoes`, gravados na tabela `configuracoes`
(**linha única**).

- A trava do prazo mora no **trigger `protect_trabalhos_fields`**, não numa
  policy: policy recusada devolve uma mensagem ilegível ao autor; o trigger
  devolve a frase certa. Os dois são servidor — o cliente não escapa.
- **Data vazia = sem prazo.** Fechar por omissão derrubaria todo o envio no
  instante em que a migration subisse.
- O prazo é comparado em **`America/Sao_Paulo`**, com as duas pontas
  inclusivas — em UTC, "até dia 31" fecharia às 21h do dia 30.
- `aberto` vem do servidor, nunca recalculado no cliente a partir das datas
  (relógio de navegador adiantado reabriria o prazo na tela). Falha de rede
  devolve `aberto: true`.
- ⚠ Só o **prazo** tem regra de servidor. `max_coautores`,
  `parecer_min_caracteres` e `alerta_horas` são gravados para o botão SALVAR
  não mentir, mas não travam nada — usar um deles exige escrever a trava em
  SQL junto.

Na mesma tela ficam os **links de download** (modelos de artigo, normas,
edital, manual do revisor…). Eles saem por uma RPC que devolve só as colunas
de link, porque a landing e o `/login` são páginas públicas, sem sessão.

---

## Estrutura

```
src/
├── components/          # espelha a divisão por portal + ui/ (shadcn)
├── contexts/
│   └── AuthContext.tsx  # sessão do Supabase + papel do usuário
├── integrations/
│   └── supabase/        # client.ts (anon key) + types.ts GERADO
├── lib/                 # brand.ts, portais.ts, pageTitles.ts, pdfStorage.ts, …
├── pages/               # co-chairs/, estudante/, event/, revisor/ + públicas
├── services/            # queries e RPCs (avaliação, correção, revisores, …)
├── test/                # Vitest — 17 arquivos, 187 testes
└── App.tsx              # mapa de rotas + providers

supabase/
├── migrations/          # SQL aplicado em ordem por `npm run migrate`
├── functions/           # Edge Functions (Deno): enviar-email, redefinir-senha
└── backups/             # snapshots do `npm run backup` (gitignored — tem PII)

scripts/                 # migrate, deploy, backup, checks de segurança, …
deploy/                  # exemplos de nginx/apache (ver deploy/README.md)
sql/rls-audit.sql        # consulta de auditoria das policies
```

**Página não fala com o Supabase direto** — passa por `src/services/`. Essa
regra é verificada por `npm run check:consolidacao`.

---

## Rodando localmente

Requisitos: Node.js ≥ 18, npm ≥ 9 e um projeto Supabase.

```bash
npm install
cp .env.example .env    # preencher com os valores do seu projeto
npm run dev             # http://localhost:5173
```

O `.env` contém **apenas valores públicos** (`VITE_*`), que vão embutidos no
bundle:

| Variável | Onde encontrar |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Settings → API → chave `anon`/publishable |
| `VITE_SUPABASE_PDF_BUCKET` | nome do bucket dos PDFs (padrão: `Pdfs`) |

> **Segredos nunca entram no `.env`** — nem no de desenvolvimento.
> `SUPABASE_ACCESS_TOKEN`, a chave `service_role`, a senha do banco e
> `BREVO_API_KEY` são usados só por scripts de linha de comando, exportados
> como variável de ambiente na hora do uso:
>
> ```powershell
> $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; npm run migrate
> ```

Os buckets de Storage são privados — PDFs saem por URL assinada
(`src/lib/pdfStorage.ts`) e são exibidos em canvas por `react-pdf`
(`src/components/PdfViewer.tsx`). Iframe com URL assinada dispara download;
não usar.

---

## Migrations e tipos

Arquivos SQL em `supabase/migrations/`, nomeados com timestamp UTC
(`AAAAMMDDHHMMSS_descricao.sql`) para rodarem sempre em ordem cronológica.

```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npm run migrate      # aplica os pendentes
npm run gen:types    # regenera src/integrations/supabase/types.ts
```

O runner (`scripts/migrate.js`) executa os pendentes via Management API
(o `service_role` **não** é usado), registra cada um em `public._migrations` e
recarrega o cache de schema do PostgREST. É idempotente — já aplicados são
pulados.

**Regras:**

- Nunca editar uma migration já aplicada — criar um arquivo novo.
- Mudança de regra de negócio no servidor é migration (RPC/policy), não lógica
  no cliente.
- Depois de **toda** migration aplicada, rodar `npm run gen:types`. Tipo
  congelado é o que faz o código voltar a precisar de `as any`.
- `npm run migrate` toca o banco **de produção**. Rode com intenção.

---

## Verificação antes de publicar

Rodar **nesta ordem**. Cada uma já pegou coisa que as outras não pegam.

```bash
npm run lint                          # baseline: 0 erros, 9 warnings react-refresh
npm run test                          # Vitest
npx tsc --noEmit -p tsconfig.app.json # ⚠ o -p é obrigatório
npm run build
npm run check:consolidacao            # Supabase só via src/services/
npm run check:seguranca               # as 5 travas, limpas E com canário plantado
npm run rls:probe                     # ataca o banco com a chave pública
```

- ⚠ **`tsc` sem `-p tsconfig.app.json` não checa nada** — o `tsconfig.json` da
  raiz tem `files: []`. Um `npx tsc --noEmit` "limpo" é falso sossego.
- ⚠ **`tsconfig.app.json` tem `strict: false`**: sem `strictNullChecks` o
  TypeScript não estreita união por discriminante booleano. Union nova
  discrimina por **string** (`estado: "enviado" | "falha"`), nunca por
  `ok: boolean`.
- `check:seguranca` roda cada verificação **duas vezes**: com a árvore limpa
  (tem de passar) e com uma vulnerabilidade plantada (tem de falhar). Trava que
  nunca disparou não é trava conhecida — essa suíte já pegou três cegas neste
  projeto.

---

## Publicação

```bash
npm run deploy                # build + travas + wrangler deploy + verificação
npm run deploy -- --dry-run   # só as travas
npm run deploy -- --preview   # publica e verifica a URL workers.dev
```

`npm run deploy` é a **única forma suportada** de publicar (`deploy:raw` pula
as travas). O alvo é Cloudflare Workers com static assets (Worker `ciufla`,
`wrangler.jsonc`); o fallback de SPA vem de `assets.not_found_handling` —
`public/_redirects` **não existe mais**, a regra catch-all é rejeitada pela API
da Cloudflare.

As Edge Functions são publicadas à parte:

```bash
npm run deploy:functions              # todas
npm run deploy:functions -- <slug>    # só uma
npm run config:secrets                # BREVO_API_KEY, EMAIL_REMETENTE, SITE_URL
```

`config:secrets` lê **do ambiente** (nunca de arquivo) e confere a chave contra
a API do Brevo antes de gravar: chave morta gravada em silêncio derruba todo o
envio de e-mail.

Alternativas de hospedagem (Vercel, nginx, Apache) em
[`deploy/README.md`](deploy/README.md).

---

## Backup e restauração

```bash
npm run backup                       # banco (Management API) + Storage
npm run backup:conferir -- <pasta>   # confere o backup
```

Vai para `supabase/backups/` — **gitignored, contém PII e todos os PDFs**.
Exige `SUPABASE_ACCESS_TOKEN` e `SUPABASE_SERVICE_ROLE_KEY`.

- O `restaurar.sql` gerado dá `TRUNCATE` antes de repovoar: as migrations
  semeiam `categorias`/`criterios` sem id explícito, e um restore por merge
  duplicava linha.
- **`auth.users` fica fora do dump** (mora fora do schema `public`): restaurar
  num projeto novo traz os dados, mas **não as contas** — e os donos ficam
  órfãos.
- `backup:conferir` com Docker ligado **restaura de verdade** num Postgres
  descartável e confere as chaves estrangeiras. Sem Docker faz só a conferência
  estrutural, que não prova restauração — contagem de linha certa já passou com
  dado quebrado.

---

## Convenções

- **Marca**: todo texto de nome do sistema sai de `src/lib/brand.ts`
  (`APP_NAME`, `APP_SHORT`, `APP_MARK`, `SUPPORT_EMAIL`). Não hardcodar.
  Não renomear as chaves `nexus_*` do localStorage nem as variáveis CSS
  `--nexus-*` — apagaria dados de usuários existentes.
- **Rota nova exige 3 edições**: `App.tsx`, entrada em `src/lib/pageTitles.ts`
  (a ordem importa — padrões fixos como `trabalhos/novo` antes de
  `trabalhos/:id`; há teste) e, se autenticada, `public/robots.txt` + os
  configs de deploy (`vercel.json`, `public/_headers`, `deploy/*.example`).
- Acesso ao Supabase **só** por `src/services/`.
- Idioma da UI e dos comentários: pt-BR.
- Build de produção é `npm run build` (nunca `build:dev`).
- `vite_project/` é um scaffold antigo, fora do git — ignorar.

---

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (porta 5173) |
| `npm run build` | Build de produção em `dist/` |
| `npm run preview` | Build + `wrangler dev` (serve como em produção) |
| `npm run lint` | ESLint |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run deploy` | Build + travas + deploy Cloudflare + verificação da URL |
| `npm run deploy:functions` | Publica as Edge Functions |
| `npm run config:secrets` | Grava os secrets do projeto Supabase (lidos do ambiente) |
| `npm run migrate` | Aplica migrations pendentes (produção) |
| `npm run gen:types` | Regenera os tipos do Supabase a partir do schema vivo |
| `npm run check:seguranca` | As 5 travas de segurança, limpas e com canário |
| `npm run check:consolidacao` | Verifica que o Supabase só é acessado via services |
| `npm run check:dns` | Confere a zona/DNS do domínio |
| `npm run rls:probe` | Ataca o banco com a chave pública, como um visitante |
| `npm run verify:deploy` | Verifica uma URL já publicada |
| `npm run backup` / `backup:conferir` | Snapshot do banco + Storage / conferência |
| `npm run seed:admin` | Cria a primeira conta admin |
| `npm run purge:contas` | Remoção administrativa de contas (simulação por padrão) |

Os que tocam produção (`migrate`, `deploy*`, `config:secrets`, `seed:admin`,
`purge:contas`, `backup`) só devem ser rodados com intenção explícita.
`purge:contas` é destrutivo e irreversível: apaga contas, dados derivados e os
PDFs no Storage — `--apply` é o que executa; o padrão é simulação.
