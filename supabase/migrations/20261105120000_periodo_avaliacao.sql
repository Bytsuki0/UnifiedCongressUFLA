-- ============================================================
-- Período da avaliação ao vivo + o PDF do trabalho na tela de nota
-- ------------------------------------------------------------
-- Pedido de 2026-11-05. Duas coisas no portal /avaliacao:
--
--   1. JANELA. `trabalhos_para_avaliacao()` devolve título e AUTORES de
--      todo trabalho aprovado a qualquer professor. Fora do congresso
--      isso quebra o às cegas de /revisor: um professor revisor busca o
--      título que está revisando e lê quem o escreveu. Agora o portal só
--      enxerga alguma coisa dentro de `configuracoes.avaliacao_abertura`
--      .. `avaliacao_encerramento`, editadas em /admin/configuracoes.
--      ⚠ O portão mora NA FRESTA, não na tela: a tela vazia é cortesia,
--      quem recusa é o servidor. E como `avaliar_trabalho_evento`
--      pergunta à fresta, fora da janela também não se dá nota.
--      Mesmo desenho da janela dos pôsteres (20261102120000): DATE
--      inclusivo em America/Sao_Paulo, e VAZIO = FECHADO — aqui por
--      sigilo, não por esquecimento. Vale para todos, staff inclusive.
--
--   2. O PDF. `anexos_para_avaliacao(trabalho)` devolve os PDFs da
--      SUBMISSÃO (nunca o pôster) de um trabalho que está na fresta.
--      "O mais recente" sai de graça: `trabalho_anexos` guarda UMA linha
--      por exigência, e `enviar_correcao`/`reenviar_trabalho` sobrescrevem
--      o `valor` dela (`aplicar_anexos`). Não existe versão antiga para
--      escolher errado. O professor não lê `trabalho_anexos` pelo RLS (só
--      revisor associado), daí a RPC; assinar a URL ele já assina — a
--      policy `pdfs owner read` do Storage dá leitura a professor e staff.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. As duas datas, na linha única de configurações
-- ------------------------------------------------------------
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS avaliacao_abertura DATE,
  ADD COLUMN IF NOT EXISTS avaliacao_encerramento DATE;

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_janela_avaliacao;
ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_janela_avaliacao
  CHECK ((avaliacao_abertura IS NULL) = (avaliacao_encerramento IS NULL)
         AND (avaliacao_abertura IS NULL OR avaliacao_abertura <= avaliacao_encerramento));

COMMENT ON COLUMN public.configuracoes.avaliacao_abertura IS
  'Primeiro dia da avaliação ao vivo (inclusivo, horário de Brasília). NULL junto com o encerramento = portal /avaliacao fechado.';
COMMENT ON COLUMN public.configuracoes.avaliacao_encerramento IS
  'Último dia da avaliação ao vivo (inclusivo, horário de Brasília). NULL junto com a abertura = portal /avaliacao fechado.';

-- ------------------------------------------------------------
-- 2. "A avaliação está aberta?" — uma definição só
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.avaliacao_aberta()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT public.data_local() BETWEEN c.avaliacao_abertura AND c.avaliacao_encerramento
       FROM public.configuracoes c WHERE c.id),
    false);
$$;
REVOKE ALL ON FUNCTION public.avaliacao_aberta() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avaliacao_aberta() FROM anon;
GRANT EXECUTE ON FUNCTION public.avaliacao_aberta() TO authenticated;

-- O que a tela precisa para dizer "começa dia X" (espelho de
-- `prazo_posteres()`). `aberto` vem DAQUI, nunca do relógio do navegador.
CREATE OR REPLACE FUNCTION public.periodo_avaliacao()
RETURNS TABLE(abertura date, encerramento date, aberto boolean, hoje date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.avaliacao_abertura, c.avaliacao_encerramento, public.avaliacao_aberta(), public.data_local()
  FROM public.configuracoes c WHERE c.id;
$$;
REVOKE ALL ON FUNCTION public.periodo_avaliacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.periodo_avaliacao() FROM anon;
GRANT EXECUTE ON FUNCTION public.periodo_avaliacao() TO authenticated;

-- ------------------------------------------------------------
-- 3. A fresta passa a olhar a janela
-- ------------------------------------------------------------
-- A da 20261103120000 com UMA linha a mais: `AND public.avaliacao_aberta()`.
CREATE OR REPLACE FUNCTION public.trabalhos_para_avaliacao()
RETURNS TABLE(id uuid, titulo text, autores text, categoria_id uuid, em_conflito boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.titulo, t.autores, t.categoria_id,
         EXISTS (SELECT 1 FROM public.conflitos_do_trabalho(t.id) c
                  WHERE c.email = lower(auth.email()))
    FROM public.trabalhos t
   WHERE t.status IN ('aprovado', 'aprovado_correcoes')
     AND (public.is_event_staff() OR public.has_role(auth.uid(), 'professor'))
     AND public.email_confirmado()
     AND public.avaliacao_aberta()
   ORDER BY t.titulo, t.id;
$$;
REVOKE ALL ON FUNCTION public.trabalhos_para_avaliacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trabalhos_para_avaliacao() FROM anon;
GRANT EXECUTE ON FUNCTION public.trabalhos_para_avaliacao() TO authenticated;

-- ------------------------------------------------------------
-- 4. Os PDFs da submissão de um trabalho da fresta
-- ------------------------------------------------------------
-- Mesmas colunas de `COLUNAS_ANEXO` (src/services/anexosService.ts), para
-- a tela reusar as abas e o visor do revisor. Trabalho fora da fresta
-- (janela fechada, não aprovado, quem chama não avalia) volta vazio.
CREATE OR REPLACE FUNCTION public.anexos_para_avaliacao(_trabalho_id uuid)
RETURNS TABLE(id uuid, anexo_id uuid, tipo text, titulo text, ordem integer, valor text, poster boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ta.id, ta.anexo_id, ta.tipo, ta.titulo, ta.ordem, ta.valor, ta.poster
    FROM public.trabalho_anexos ta
   WHERE ta.trabalho_id = _trabalho_id
     AND ta.tipo = 'pdf'
     AND NOT ta.poster
     AND EXISTS (SELECT 1 FROM public.trabalhos_para_avaliacao() p WHERE p.id = _trabalho_id)
   ORDER BY ta.ordem, ta.criado_em;
$$;
REVOKE ALL ON FUNCTION public.anexos_para_avaliacao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anexos_para_avaliacao(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.anexos_para_avaliacao(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 5. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.trabalhos_para_avaliacao()'::regprocedure;
  IF position('avaliacao_aberta()' IN v_src) = 0 THEN
    RAISE EXCEPTION 'trabalhos_para_avaliacao() não confere a janela — o portal vazaria autores fora do evento.';
  END IF;
  -- O recorte da 20261103120000 continua de pé.
  IF v_src NOT LIKE '%t.status IN (''aprovado'', ''aprovado_correcoes'')%'
     OR v_src NOT LIKE '%email_confirmado()%'
     OR v_src NOT LIKE '%conflitos_do_trabalho%' THEN
    RAISE EXCEPTION 'trabalhos_para_avaliacao() mudou de recorte — confira status, gate e conflito.';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.anexos_para_avaliacao(uuid)'::regprocedure;
  IF position('trabalhos_para_avaliacao()' IN v_src) = 0 OR position('NOT ta.poster' IN v_src) = 0 THEN
    RAISE EXCEPTION 'anexos_para_avaliacao() pulou a fresta ou passou a devolver pôster.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'configuracoes_janela_avaliacao'
                    AND conrelid = 'public.configuracoes'::regclass) THEN
    RAISE EXCEPTION 'Falta o CHECK da janela da avaliação.';
  END IF;

  IF has_function_privilege('anon', 'public.avaliacao_aberta()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.periodo_avaliacao()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.anexos_para_avaliacao(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.trabalhos_para_avaliacao()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa uma função da avaliação ao vivo — o REVOKE explícito não pegou.';
  END IF;

  RAISE NOTICE 'OK: avaliação ao vivo só dentro da janela, fechada quando vazia; PDF só pela fresta.';
END $$;
