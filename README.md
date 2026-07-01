# Nexus Corp — Plataforma de Submissão Científica (UFLA)

Academic paper submission and peer-review platform built for UFLA (Universidade Federal de Lavras). Researchers submit works, professors review them, and evaluators manage the full assessment cycle.

---

## Table of Contents

- [Nexus Corp — Plataforma de Submissão Científica (UFLA)](#nexus-corp--plataforma-de-submissão-científica-ufla)
  - [Table of Contents](#table-of-contents)
  - [Tech Stack](#tech-stack)
  - [Architecture Overview](#architecture-overview)
  - [Role-Based Access Control](#role-based-access-control)
    - [What each role can access](#what-each-role-can-access)
    - [Promoting a professor to avaliador](#promoting-a-professor-to-avaliador)
  - [Pages \& Routes](#pages--routes)
  - [Database Schema](#database-schema)
  - [Running Locally](#running-locally)
    - [Prerequisites](#prerequisites)
    - [1. Clone and install dependencies](#1-clone-and-install-dependencies)
    - [2. Configure environment variables](#2-configure-environment-variables)
    - [3. Apply database migrations](#3-apply-database-migrations)
    - [4. Start the development server](#4-start-the-development-server)
    - [5. Create your first admin account](#5-create-your-first-admin-account)
  - [Environment Variables \& Secrets](#environment-variables--secrets)
  - [Database Migrations](#database-migrations)
  - [Recent Implementation Progress](#recent-implementation-progress)
    - [RBAC — Role-Based Access Control](#rbac--role-based-access-control)
    - [Automatic Database Migrations](#automatic-database-migrations)
  - [Available Scripts](#available-scripts)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| UI Components | shadcn/ui + Radix UI + Tailwind CSS |
| Routing | React Router v6 |
| Backend / DB | Supabase (PostgreSQL + Auth + PostgREST) |
| Forms | React Hook Form + Zod |
| Notifications | Sonner (toast) |
| Runtime | Node.js 20 / npm 10 |

---

## Architecture Overview

```
src/
├── components/
│   ├── ui/                # shadcn/ui primitives (Button, Table, Dialog, …)
│   ├── Layout.tsx          # Sidebar shell for the avaliador/admin dashboard
│   ├── PortaisNav.tsx      # Role-aware portal links shown in every sidebar
│   └── ProtectedRoute.tsx  # Route guard — redirects unauthorised users by role
├── contexts/
│   └── AuthContext.tsx     # Global auth state: session + resolved role
├── integrations/
│   └── supabase/
│       ├── client.ts       # Supabase JS client (anon key)
│       └── types.ts        # Auto-generated DB types
├── pages/                  # One file per route (see table below)
├── services/
│   └── avaliacaoService.ts
├── hooks/                  # Custom React hooks
└── App.tsx                 # Route definitions + AuthProvider wrapper

supabase/
└── migrations/             # Ordered SQL files applied by `npm run migrate`

scripts/
└── migrate.js              # Migration runner (Supabase Management API)
```

---

## Role-Based Access Control

Every user is assigned exactly one role, resolved automatically at login by querying Supabase tables in this priority order:

| Check | Role assigned |
|---|---|
| Email matches `ADMIN_EMAIL` constant | `admin` |
| Email found in `avaliadores` table | `avaliador` |
| Email found in `professores` table | `professor` |
| Otherwise (estudantes table / `@ufla.br` domain) | `estudante` |

### What each role can access

| Role | Accessible pages |
|---|---|
| **estudante** | `/estudante` |
| **professor** | `/estudante`, `/revisor` |
| **avaliador** | `/dashboard`, `/avaliadores`, `/trabalhos`, `/categorias`, `/atribuicoes`, `/estudante`, `/revisor` |
| **admin** | Everything above + `/admin` |

Unauthenticated users are redirected to `/login`. Authenticated users who try to access a page above their role are silently redirected to the correct page for their role.

### Promoting a professor to avaliador

An admin or avaliador opens **Avaliadores → Novo Avaliador**. The form shows all registered professors not yet in the `avaliadores` table. Clicking **Promover** grants the role. The trash icon on the Avaliadores list revokes it.

---

## Pages & Routes

| Path | Page | Access |
|---|---|---|
| `/` | Landing | Public |
| `/login` | Login | Public |
| `/cadastro` | Cadastro (student sign-up) | Public |
| `/pre-cadastro` | PreCadastro | Public |
| `/professor-cadastro` | ProfessorCadastro | Public |
| `/estudante` | Portal Estudante | Any authenticated |
| `/revisor` | Portal Revisor | professor, avaliador, admin |
| `/admin` | Portal Admin | admin |
| `/dashboard` | Dashboard | avaliador, admin |
| `/avaliadores` | Lista de Avaliadores | avaliador, admin |
| `/avaliadores/novo` | Promover Professor | avaliador, admin |
| `/trabalhos` | Lista de Trabalhos | avaliador, admin |
| `/trabalhos/novo` | Submeter Trabalho | avaliador, admin |
| `/trabalhos/:id` | Detalhe do Trabalho | avaliador, admin |
| `/trabalhos/:id/editar` | Editar Trabalho | avaliador, admin |
| `/categorias` | Categorias | avaliador, admin |
| `/atribuicoes` | Atribuições | avaliador, admin |

---

## Database Schema

All tables live in the `public` schema on Supabase with Row Level Security enabled (permissive public-access policies used in this sprint).

```
estudantes   (id, user_id, nome, email, matricula, periodo, curso, created_at)
professores  (id, user_id, nome, email, departamento, created_at)
avaliadores  (id, nome, email, instituicao, created_at)
categorias   (id, nome, created_at)
trabalhos    (id, titulo, resumo, autores, categoria_id, data_submissao, created_at)
avaliacoes   (id, avaliador_id, trabalho_id, status, notas, created_at)
_migrations  (id, filename, applied_at)   ← migration tracking table
```

---

## Running Locally

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- A Supabase project (free tier works)

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd nexus-corp
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SUPABASE_ACCESS_TOKEN=<your-personal-access-token>
SUPABASE_DB_PASSWORD=<your-database-password>
```

Where to find each value:

| Variable | Location in Supabase dashboard |
|---|---|
| `VITE_SUPABASE_URL` | Settings → API → Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Settings → API → `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` secret key |
| `SUPABASE_ACCESS_TOKEN` | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → Generate new token |
| `SUPABASE_DB_PASSWORD` | Settings → Database → Connection string (the password portion) |

### 3. Apply database migrations

```bash
npm run migrate
```

This creates all required tables in your Supabase project and reloads the schema cache. It is safe to run multiple times — already-applied migrations are skipped.

### 4. Start the development server

```bash
npm run dev
```

App is available at `http://localhost:5173`.

### 5. Create your first admin account

1. Go to `http://localhost:5173/cadastro` and register using the admin email address
2. The admin email is defined by the `ADMIN_EMAIL` constant in `src/contexts/AuthContext.tsx`
3. After logging in you are automatically redirected to `/admin`

> **Tip:** On Supabase free tier, email confirmation is enabled by default. To skip it during local development go to **Supabase → Authentication → Settings** and disable **"Enable email confirmations"**.

---

## Environment Variables & Secrets

When running on **Replit**, secrets are stored in the Replit Secrets panel — not in `.env` files. The following are configured on this project:

| Secret | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (shared env var) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key for client-side queries (shared env var) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — used by the migration runner |
| `SUPABASE_ACCESS_TOKEN` | Personal access token — required by Management API to run raw SQL |
| `SUPABASE_DB_PASSWORD` | Database password — available for direct Postgres connections |

---

## Database Migrations

Migrations are plain SQL files in `supabase/migrations/`, named with a UTC timestamp prefix so they always run in chronological order.

```
supabase/migrations/
├── 20260429142626_...sql   # Initial schema: categorias, avaliadores, trabalhos, avaliacoes
├── 20260429143820_...sql   # RLS policies
├── 20260429150407_...sql   # Indexes and constraints
├── 20260601184705_...sql   # Relax RLS to public-access policies
└── 20260610120000_create_estudantes_professores.sql
```

**Apply migrations:**

```bash
npm run migrate
```

**Add a new migration:**

1. Create a new `.sql` file with a timestamp prefix:
   ```
   supabase/migrations/20260615000000_add_status_to_trabalhos.sql
   ```
2. Write your SQL (prefer `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` for safety)
3. Run `npm run migrate` — only the new file will be applied

The runner (`scripts/migrate.js`) uses the Supabase Management API with your personal access token to execute SQL, records each applied file in `public._migrations`, and automatically reloads PostgREST's schema cache so new tables are immediately queryable.

---

## Recent Implementation Progress

### RBAC — Role-Based Access Control

**`AuthContext` (`src/contexts/AuthContext.tsx`)**
- Wraps the entire app in a React context that exposes the active session and resolved role
- Role is resolved asynchronously at login by querying `avaliadores` → `professores` → `estudantes` in priority order
- Role persists for the duration of the session; re-resolved on page refresh

**`ProtectedRoute` (`src/components/ProtectedRoute.tsx`)**
- Wraps every non-public route in `App.tsx`
- Redirects unauthenticated users to `/login`
- Redirects users who lack the required role to their own portal (no blank screens or error pages)
- Uses React Router's `<Outlet>` pattern — individual page components need no changes

**`PortaisNav` (`src/components/PortaisNav.tsx`)**
- Renders role-filtered portal navigation links in the sidebar of every page
- `currentPage` prop omits the link to the page already open
- `pushToBottom` prop pins the nav to the bottom of the sidebar using `marginTop: auto`
- Replaces the previously hardcoded portal link sections in `Estudante`, `Revisor`, and `AdminPortal`

**`AvaliadorForm` (rewritten)**
- "Novo Avaliador" shows a live table of all professors not yet in `avaliadores`
- One-click **Promover** button inserts the professor row into `avaliadores`
- Edit button removed from the `Avaliadores` list — the role is managed exclusively via promotion/deletion

**Login redirect**
- After login, users are sent directly to the right portal based on role:
  - `admin` → `/admin`
  - `avaliador` → `/dashboard`
  - `professor` → `/revisor`
  - `estudante` → `/estudante`

### Automatic Database Migrations

**`scripts/migrate.js`**
- Connects to Supabase via the Management API using a personal access token
- Applies pending `.sql` files from `supabase/migrations/` in order
- Tracks applied files in `public._migrations` (created automatically on first run)
- Idempotent — already-applied migrations are skipped; "already exists" errors are handled gracefully
- Reloads the PostgREST schema cache after each run so new tables are immediately available via REST

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server on port 5173 |
| `npm run build` | Production build output to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run migrate` | Apply pending SQL migrations to Supabase |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest unit tests |
