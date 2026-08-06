# Congresso Unificado ICTIN — UFLA

Plataforma de submissão, avaliação e certificação do congresso do ICTIN
(Universidade Federal de Lavras). Autores submetem trabalhos, revisores emitem
pareceres, co-chairs gerenciam o ciclo de avaliação e a área do congresso cuida
de inscrições, minicursos e certificados.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui + Radix UI + Tailwind CSS |
| Rotas | React Router v6 |
| Backend / Banco | Supabase (PostgreSQL + RLS + Auth + Storage) |
| Formulários | React Hook Form + Zod |
| Testes | Vitest + Testing Library |

**Não há backend próprio.** Toda a lógica de servidor vive no Postgres do
Supabase — políticas de RLS e funções RPC, versionadas em
`supabase/migrations/`. O frontend fala direto com o Supabase pelo client
anônimo.

---

## Estrutura

```
src/
├── components/          # espelha a divisão por portal + ui/ (shadcn)
├── contexts/
│   └── AuthContext.tsx  # sessão do Supabase + papel do usuário
├── integrations/
│   └── supabase/        # client.ts (anon key) + types.ts gerado
├── lib/                 # brand.ts, pageTitles.ts, pdfStorage.ts, …
├── pages/               # co-chairs/, estudante/, event/, revisor/ + públicas
├── services/            # queries e RPCs (avaliação, correção, revisores)
└── App.tsx              # mapa de rotas + providers

supabase/migrations/     # SQL aplicado em ordem por `npm run migrate`
scripts/                 # migrate.js, seed-admin.js, purge-contas.js
deploy/                  # exemplos de nginx/apache (ver deploy/README.md)
```

Páginas não chamam RPC direto — passam por `src/services/`.

---

## Portais e papéis

Os papéis ficam na tabela `user_roles` (um usuário pode ter mais de um).
`<ProtectedRoute>` é apenas a barreira de UI; **a barreira real de dados é o RLS**.

| Rota | Portal | Papéis |
|---|---|---|
| `/`, `/login`, `/cadastro` | Público — cadastro unificado (inclui participantes externos) | — |
| `/estudante` | Autor: submete, acompanha e corrige trabalhos | todos, menos `externo` |
| `/revisor` | Pareceres e avaliações | `professor`, `avaliador`, `admin` |
| `/admin` | Papéis, conflitos de interesse, auditoria | `admin` |
| `/co-chairs` | Trabalhos, categorias, atribuições, rankings | `avaliador`, `admin` |
| `/congresso` | Inscrição, minicursos, certificados, programação | todos (inclui `externo`) |
| `/congresso/admin` | Administração do evento | `avaliador`, `admin` |

As URLs antigas de co-chairs na raiz (`/dashboard`, `/trabalhos`, …) redirecionam
para `/co-chairs/...`.

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

> **Segredos nunca entram no `.env`.** `SUPABASE_ACCESS_TOKEN`, a chave
> `service_role` e a senha do banco são usados só por scripts de linha de
> comando, exportados como variável de ambiente na hora do uso:
>
> ```powershell
> $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; npm run migrate
> ```

Os buckets de Storage são privados — PDFs são servidos por URL assinada.

---

## Migrations

Arquivos SQL em `supabase/migrations/`, nomeados com timestamp UTC
(`AAAAMMDDHHMMSS_descricao.sql`) para rodarem sempre em ordem cronológica.

```bash
npm run migrate
```

O runner (`scripts/migrate.js`) executa os pendentes via Management API,
registra cada um em `public._migrations` e recarrega o cache de schema do
PostgREST. É idempotente — já aplicados são pulados.

**Regras:**

- Nunca editar uma migration já aplicada — criar um arquivo novo.
- Mudança de regra de negócio no servidor é migration (RPC/policy), não lógica
  no cliente.
- `npm run migrate` toca o banco **de produção**. Rode com intenção.

---

## Convenções

- **Marca**: todo texto de nome do sistema sai de `src/lib/brand.ts`
  (`APP_NAME`, `APP_SHORT`, `APP_MARK`). Não hardcodar.
- **Rota nova** exige: registro em `App.tsx`, entrada em `src/lib/pageTitles.ts`
  (a ordem importa — padrões fixos antes dos com `:id`) e, se for autenticada,
  `public/robots.txt` + os configs de deploy.
- Idioma da UI e dos comentários: pt-BR.
- Build de produção é `npm run build` (nunca `build:dev`).

---

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (porta 5173) |
| `npm run build` | Build de produção em `dist/` |
| `npm run preview` | Serve o build localmente |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run migrate` | Aplica migrations pendentes no Supabase |
| `npm run seed:admin` | Cria a primeira conta admin |
| `npm run purge:contas` | Remoção administrativa de contas |

Instruções de hospedagem (Vercel, Netlify, nginx, Apache) em
[`deploy/README.md`](deploy/README.md).
