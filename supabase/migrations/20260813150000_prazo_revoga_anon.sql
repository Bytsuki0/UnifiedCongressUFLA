-- ============================================================
-- Correção da 20260813120000: fechar `anon` no prazo de submissão
-- ------------------------------------------------------------
-- A sonda (`npm run rls:probe`) acusou logo depois de aplicar a
-- migration anterior:
--
--   FALHA submissoes_abertas(): EXECUTOU como anon → true
--   FALHA prazo_submissoes():   EXECUTOU como anon → [{"abertura":...}]
--   FALHA data_local():         EXECUTOU como anon → "2026-08-13"
--   FRACO configuracoes: 0 linhas, mas sem erro
--
-- Causa: o projeto Supabase tem `ALTER DEFAULT PRIVILEGES IN SCHEMA
-- public GRANT ALL ON FUNCTIONS/TABLES TO anon, authenticated,
-- service_role`. Todo objeto novo em `public` já NASCE com EXECUTE (ou
-- SELECT) concedido a `anon` — um grant EXPLÍCITO ao papel.
--
-- `REVOKE ALL ... FROM PUBLIC`, que a migration anterior fazia, tira só
-- o grant do pseudo-papel PUBLIC. O grant explícito a `anon` sobrevive
-- intacto. Por isso todo o resto do projeto escreve as duas linhas
-- (ver `email_confirmado` em 20260806140000, e o
-- `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon` do hardening —
-- aquele foi uma varredura de uma vez só, e não alcança tabela criada
-- depois).
--
-- Nada vazou de fato: `configuracoes` devolveu 0 linhas (a RLS filtrou,
-- não há policy para `anon`) e `editar_submissao` recusa na primeira
-- linha do corpo (`auth.uid() IS NULL` -> P0001). O que existia era
-- superfície indevida — a janela de submissão e a data do servidor
-- legíveis sem sessão — e uma RPC de ESCRITA ao alcance de `anon`,
-- defendida só pelo corpo. Fechar é a regra da casa.
--
-- Lição para a próxima função em `public`: REVOKE de PUBLIC **e** de
-- `anon`. Só o segundo desfaz o default privilege.
-- ============================================================

-- Tabela: `anon` não tem o que ler aqui. Sem grant de tabela a recusa
-- passa a ser dura (42501), em vez de "0 linhas sem erro" — que a sonda
-- classifica como FRACO justamente por ser ambíguo entre "RLS filtrou" e
-- "tabela vazia".
REVOKE ALL ON public.configuracoes FROM anon;

-- Funções do prazo: só sessão autenticada.
REVOKE ALL ON FUNCTION public.data_local()        FROM anon;
REVOKE ALL ON FUNCTION public.submissoes_abertas() FROM anon;
REVOKE ALL ON FUNCTION public.prazo_submissoes()   FROM anon;

-- Escrita: o corpo já recusa sem sessão, mas uma RPC de escrita não deve
-- sequer ser executável por `anon`.
REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text, text) FROM anon;

-- Confere na própria migration: se algum grant a `anon` sobreviver, o
-- migrate falha aqui em vez de deixar a brecha passar em silêncio.
DO $$
DECLARE
  v_sobrou text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_sobrou
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('data_local', 'submissoes_abertas', 'prazo_submissoes', 'editar_submissao')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'anon ainda executa: %', v_sobrou;
  END IF;

  IF has_table_privilege('anon', 'public.configuracoes', 'SELECT') THEN
    RAISE EXCEPTION 'anon ainda lê public.configuracoes';
  END IF;
END $$;
