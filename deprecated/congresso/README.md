# Congresso — área aposentada

Código da antiga área do evento (`/congresso`): inscrição, minicursos,
programação, certificados (emissão em PDF + verificação por QR code),
notificações do evento e perfil do usuário. Saiu do escopo e foi movido para
cá em 2026-10-02.

**Não é mantido.** Fica fora do build (nada em `src/` importa daqui), do
`tsc` (`tsconfig.app.json` inclui só `src`), do ESLint (`deprecated/**` está
em `ignores`) e do Vitest. Os imports `@/...` daqui de dentro não resolvem
mais — é esperado.

## Layout

A árvore espelha `src/`, para que restaurar seja mover de volta:

```
src/pages/event/                  # 9 telas + admin/ (8 telas; AdminUsuarios já não tinha rota)
src/components/event/             # AppLayout, NotificationsBell, Logo, DecorativeBg, paths
src/services/                     # certificados, inscricoes, minicursos, perfil, programacao, notificacoes
src/services/usuariosService.congresso.ts   # listarPerfisPorIds + resumoDoEvento (ver abaixo)
src/lib/certificate-pdf.ts
```

## O que continua no projeto

- **Banco**: as tabelas (`congress_registrations`, `minicourses`,
  `minicourse_registrations`, `attendances`, `certificates`, `notifications`,
  `notification_reads`, `schedule`) e as RPCs (`verify_certificate`,
  `mark_attendance`, `close_event_and_issue_certificates`,
  `minicourse_occupancy`) seguem nas migrations já aplicadas e no
  `src/integrations/supabase/types.ts`. `scripts/rls-probe.js` e
  `sql/rls-audit.sql` ainda as testam.
- **CSS**: as classes do layout do evento continuam em `src/index.css`.
- **Rotas**: só `/congresso/admin/papeis` e `/congresso/admin/usuarios`, que
  redirecionam para `/admin/...`.

## Como restaurar

1. `git mv` cada pasta/arquivo de `deprecated/congresso/src/...` de volta
   para o mesmo caminho em `src/`.
2. Devolver `listarPerfisPorIds` e `resumoDoEvento` de
   `usuariosService.congresso.ts` para `src/services/usuariosService.ts`
   (as telas importam de lá) e apagar o arquivo `.congresso.ts`.
3. Reinstalar as dependências removidas junto com a área:
   `npm i pdf-lib qrcode qrcode.react html5-qrcode` e
   `npm i -D @types/qrcode`.
4. No `src/App.tsx`, reimportar as telas e recriar as rotas `/congresso/*`
   (estavam atrás de `<ProtectedRoute allowedRoles={["admin"]} />`).
5. Recolocar a entrada `congresso` em `src/components/PortaisNav.tsx`
   (`NAV_ITEMS`, `CurrentPage` e a lista do admin) e os títulos
   `/congresso/*` em `src/lib/pageTitles.ts`.

O commit que fez a mudança mostra cada um desses trechos no diff.
