-- ============================================================
-- Decisão consolidada dos 3 pareceres + rodada de correções
-- ------------------------------------------------------------
-- Cada trabalho recebe até 3 revisores e cada revisor emite um
-- parecer: aprovado | aprovado_correcoes | nao_aprovado.
--
-- A decisão do trabalho é a MODA dos pareceres:
--   · 2 (ou 3) votos iguais  -> vence esse resultado;
--   · empate (1/1/1)         -> aprovado com correções.
--
-- Ou seja, nos quatro cenários possíveis com 3 pareceres:
--   1. 2x aprovado           -> aprovado           (nada a fazer)
--   2. 2x aprovado_correcoes -> aprovado_correcoes (o autor corrige)
--   3. 2x nao_aprovado       -> reprovado          (nada a fazer)
--   4. 1x de cada            -> aprovado_correcoes (mesmo fluxo do 2)
--
-- No caso "aprovado com correções" o autor pode reenviar o PDF e
-- ajustar título e resumo — nunca orientador, coautores ou categoria,
-- que definiram os conflitos de interesse e os critérios usados na
-- avaliação. Isso é feito pela RPC `enviar_correcao`, e não por UPDATE
-- direto na tabela (a política de RLS continua permitindo escrita do
-- autor apenas enquanto o trabalho está 'pendente').
-- ============================================================

-- ------------------------------------------------------------
-- 1. Novo status + marca da rodada de correção
-- ------------------------------------------------------------
-- trabalhos.status passa a aceitar 'aprovado_correcoes':
--   pendente | em_avaliacao | aprovado_correcoes | aprovado | reprovado
ALTER TABLE public.trabalhos
  ADD COLUMN IF NOT EXISTS correcoes_enviadas_em TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 2. Regra de consolidação
-- ------------------------------------------------------------
-- Retorna NULL enquanto não houver os 3 pareceres — o trabalho ainda
-- não tem decisão. Interna: quem chama já fez a própria autorização.
CREATE OR REPLACE FUNCTION public.decisao_consolidada(_trabalho_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH votos AS (
    SELECT p.resultado AS voto, count(DISTINCT lower(p.revisor_email)) AS n
    FROM public.pareceres p
    WHERE p.trabalho_id = _trabalho_id
      AND p.resultado IN ('aprovado', 'aprovado_correcoes', 'nao_aprovado')
    GROUP BY p.resultado
  ),
  topo AS (
    SELECT v.voto FROM votos v WHERE v.n = (SELECT max(v2.n) FROM votos v2)
  )
  SELECT CASE
    -- Ainda faltam pareceres: sem decisão.
    WHEN (SELECT coalesce(sum(v.n), 0) FROM votos v) < 3 THEN NULL
    -- Maioria clara (2 ou 3 votos iguais).
    WHEN (SELECT count(*) FROM topo) = 1 THEN (SELECT t.voto FROM topo t)
    -- Empate (1/1/1): o meio-termo é aprovar com correções.
    ELSE 'aprovado_correcoes'
  END;
$$;
REVOKE ALL ON FUNCTION public.decisao_consolidada(uuid) FROM PUBLIC;

-- Aplica a decisão em trabalhos.status. Devolve o status gravado, ou
-- NULL quando não havia nada a decidir (nenhum parecer ainda).
CREATE OR REPLACE FUNCTION public.aplicar_decisao(_trabalho_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_decisao   text;
  v_pareceres integer;
  v_status    text;
BEGIN
  SELECT count(DISTINCT lower(p.revisor_email)) INTO v_pareceres
  FROM public.pareceres p
  WHERE p.trabalho_id = _trabalho_id;

  v_decisao := public.decisao_consolidada(_trabalho_id);

  v_status := CASE
    WHEN v_decisao = 'aprovado'           THEN 'aprovado'
    WHEN v_decisao = 'aprovado_correcoes' THEN 'aprovado_correcoes'
    WHEN v_decisao = 'nao_aprovado'       THEN 'reprovado'
    -- Avaliação em curso: já tem parecer, mas ainda não os 3.
    WHEN v_pareceres > 0                  THEN 'em_avaliacao'
    -- Sem nenhum parecer: não mexe no status (pode ter sido definido
    -- manualmente pela organização).
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RETURN NULL;
  END IF;

  -- A escrita vem do próprio banco, não de uma pessoa: libera o
  -- trigger de proteção só para esta instrução.
  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos t
     SET status = v_status
   WHERE t.id = _trabalho_id
     AND t.status IS DISTINCT FROM v_status;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  RETURN v_status;
END; $$;
REVOKE ALL ON FUNCTION public.aplicar_decisao(uuid) FROM PUBLIC;

-- Recalcula sempre que um parecer entra, muda ou sai.
CREATE OR REPLACE FUNCTION public.pareceres_consolida_decisao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.aplicar_decisao(OLD.trabalho_id);
    RETURN OLD;
  END IF;

  -- Parecer movido de trabalho: os dois lados mudam.
  IF TG_OP = 'UPDATE' AND NEW.trabalho_id IS DISTINCT FROM OLD.trabalho_id THEN
    PERFORM public.aplicar_decisao(OLD.trabalho_id);
  END IF;

  PERFORM public.aplicar_decisao(NEW.trabalho_id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_pareceres_decisao ON public.pareceres;
CREATE TRIGGER trg_pareceres_decisao
  AFTER INSERT OR UPDATE OR DELETE ON public.pareceres
  FOR EACH ROW EXECUTE FUNCTION public.pareceres_consolida_decisao();

-- ------------------------------------------------------------
-- 3. Proteção dos campos do trabalho (reescrita)
-- ------------------------------------------------------------
-- Igual à versão anterior, mais a exceção para as escritas feitas
-- pelo próprio banco (consolidação da decisão e envio de correção),
-- sinalizadas por um GUC local à transação. `set_config` não é
-- exposto pelo PostgREST, então o cliente não consegue ligá-lo.
CREATE OR REPLACE FUNCTION public.protect_trabalhos_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Contexto de servidor (service_role/migrações) — não interfere.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Escrita automática do banco (aplicar_decisao / enviar_correcao).
  IF coalesce(current_setting('app.decisao_automatica', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_event_staff() THEN
      NEW.owner_id := auth.uid();
      NEW.status   := 'pendente';
    ELSIF NEW.owner_id IS NULL THEN
      NEW.owner_id := auth.uid();
    END IF;
  ELSE
    IF NOT public.is_event_staff() THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Somente a organização pode alterar o status do trabalho.';
      END IF;
      NEW.owner_id := OLD.owner_id;
      -- Autoria e categoria são imutáveis para o autor: definem os
      -- conflitos de interesse e os critérios já aplicados.
      NEW.orientador_email := OLD.orientador_email;
      NEW.coautores        := OLD.coautores;
      NEW.autores          := OLD.autores;
      NEW.categoria_id     := OLD.categoria_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_trabalhos ON public.trabalhos;
CREATE TRIGGER trg_protect_trabalhos
  BEFORE INSERT OR UPDATE ON public.trabalhos
  FOR EACH ROW EXECUTE FUNCTION public.protect_trabalhos_fields();

-- ------------------------------------------------------------
-- 4. Envio da versão corrigida pelo autor
-- ------------------------------------------------------------
-- Único caminho de escrita do autor em um trabalho já avaliado.
-- Altera apenas título, resumo e PDF; devolve o caminho do PDF
-- antigo para que o cliente apague o arquivo do Storage.
CREATE OR REPLACE FUNCTION public.enviar_correcao(
  _trabalho_id uuid,
  _titulo      text,
  _resumo      text,
  _pdf_url     text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t          public.trabalhos%ROWTYPE;
  v_pdf_novo text := nullif(trim(coalesce(_pdf_url, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;
  IF t.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o autor pode enviar a versão corrigida.';
  END IF;
  IF t.status <> 'aprovado_correcoes' THEN
    RAISE EXCEPTION 'Este trabalho não está aguardando correções.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' OR coalesce(trim(_resumo), '') = '' THEN
    RAISE EXCEPTION 'Título e resumo são obrigatórios.';
  END IF;
  -- O PDF novo tem que estar na pasta do próprio autor, a mesma regra
  -- que a política de Storage aplica no upload.
  IF v_pdf_novo IS NOT NULL AND split_part(v_pdf_novo, '/', 1) <> auth.uid()::text THEN
    RAISE EXCEPTION 'Caminho de PDF inválido.';
  END IF;

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET titulo                = trim(_titulo),
         resumo                = trim(_resumo),
         pdf_url               = coalesce(v_pdf_novo, pdf_url),
         status                = 'aprovado',
         correcoes_enviadas_em = now()
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  -- Caminho do arquivo substituído (NULL quando o PDF não mudou).
  RETURN CASE
    WHEN v_pdf_novo IS NOT NULL AND t.pdf_url IS DISTINCT FROM v_pdf_novo THEN t.pdf_url
    ELSE NULL
  END;
END; $$;
REVOKE ALL ON FUNCTION public.enviar_correcao(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enviar_correcao(uuid, text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 5. Pareceres visíveis para o autor (anônimos)
-- ------------------------------------------------------------
-- O autor não lê a tabela `pareceres` (RLS: só a organização e o
-- próprio revisor). Para corrigir o trabalho ele precisa saber o que
-- foi apontado — então recebe os pareceres SEM identificação do
-- revisor, e apenas depois de fechada a decisão.
CREATE OR REPLACE FUNCTION public.pareceres_do_meu_trabalho(_trabalho_id uuid)
RETURNS TABLE(ordem integer, resultado text, comentario_geral text, itens jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trabalhos t
    WHERE t.id = _trabalho_id
      AND (t.owner_id = auth.uid() OR public.is_event_staff())
  ) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Sem decisão fechada, nada é revelado (avaliação às cegas).
  IF public.decisao_consolidada(_trabalho_id) IS NULL AND NOT public.is_event_staff() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (row_number() OVER (ORDER BY p.created_at, p.id))::integer,
         p.resultado,
         p.comentario_geral,
         p.itens
  FROM public.pareceres p
  WHERE p.trabalho_id = _trabalho_id;
END; $$;
REVOKE ALL ON FUNCTION public.pareceres_do_meu_trabalho(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pareceres_do_meu_trabalho(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 6. Backfill: trabalhos que já tinham pareceres
-- ------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT p.trabalho_id FROM public.pareceres p LOOP
    PERFORM public.aplicar_decisao(r.trabalho_id);
  END LOOP;
END $$;
