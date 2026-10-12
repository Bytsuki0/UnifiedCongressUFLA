-- ============================================================
-- Revisores por trabalho — o "3" deixa de ser fixo
-- ------------------------------------------------------------
-- A organização escolhe, num controle deslizante em
-- /co-chairs/atribuicoes, quantos revisores cada trabalho recebe (1 a 3).
--
-- O número 3 estava escrito à mão em SEIS funções, e não só na
-- recomendação:
--
--   · `recomendar_distribuicao` / `distribuir_revisores` — até quantos
--     revisores preencher;
--   · `check_max_revisores` — o teto do INSERT em `trabalho_revisores`;
--   · `aplicar_decisao` — quantos pareceres ENCERRAM a revisão e mandam o
--     trabalho para 'aguardando_parecer_editorial';
--   · `registrar_parecer_editorial` — quantos pareceres o co-chair precisa
--     ter antes de decidir;
--   · `decisao_consolidada` — de quantos votos sai a sugestão.
--
-- ⚠ Mudar só a recomendação seria o bug silencioso: com o controle em 2
-- a recomendação proporia 2 revisores, os 2 pareceres chegariam, e o
-- trabalho ficaria em 'em_avaliacao' para sempre, porque o fechamento
-- continuaria esperando o 3º. As seis leem o MESMO número, de
-- `revisores_por_trabalho()`, e o bloco DO no fim desta migration quebra
-- se alguma delas voltar a ter número próprio.
--
-- O número mora em `configuracoes` (linha única), mas a escrita NÃO é a
-- policy de UPDATE da tabela: aquela é do admin e cobre a linha inteira —
-- inclusive o prazo de submissão. A tela mora em /co-chairs, então a
-- escrita é de `is_event_staff()` (a policy acompanha onde a tela mora,
-- mesmo critério da 20260909120000), por uma RPC que só toca esta coluna.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A coluna
-- ------------------------------------------------------------
-- DEFAULT 3: a linha que já existe nasce com o comportamento de hoje.
-- O teto de 3 continua sendo o máximo — o controle só desce a partir dele.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS revisores_por_trabalho INTEGER NOT NULL DEFAULT 3;

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_revisores_por_trabalho_check;
ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_revisores_por_trabalho_check
  CHECK (revisores_por_trabalho BETWEEN 1 AND 3);

-- A linha única é semeada na 20260813120000; repetir aqui só garante que
-- um banco restaurado sem ela não fique sem número nenhum.
INSERT INTO public.configuracoes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. A leitura única
-- ------------------------------------------------------------
-- Toda regra lê daqui, e a tela também (via RPC). Sem a linha, vale 3 —
-- o comportamento de antes desta migration, e não um fechamento por
-- omissão.
CREATE OR REPLACE FUNCTION public.revisores_por_trabalho()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT c.revisores_por_trabalho FROM public.configuracoes c WHERE c.id),
    3
  );
$$;
-- `REVOKE ... FROM PUBLIC` não tira o grant direto que o ALTER DEFAULT
-- PRIVILEGES do projeto dá a `anon` (20260806140000, 20260908120000).
REVOKE ALL ON FUNCTION public.revisores_por_trabalho() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revisores_por_trabalho() FROM anon;
GRANT EXECUTE ON FUNCTION public.revisores_por_trabalho() TO authenticated;

-- ------------------------------------------------------------
-- 3. A escrita, para a organização
-- ------------------------------------------------------------
-- Quem manda no intervalo é o CHECK da coluna; o teste daqui existe para
-- devolver a frase certa em vez da mensagem crua do Postgres.
CREATE OR REPLACE FUNCTION public.definir_revisores_por_trabalho(_n integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  IF _n IS NULL OR _n < 1 OR _n > 3 THEN
    RAISE EXCEPTION 'Escolha de 1 a 3 revisores por trabalho.';
  END IF;

  -- O recálculo da fila do parecer editorial é do trigger da seção 4, e
  -- não daqui: assim ele vale também para o UPDATE direto do admin.
  UPDATE public.configuracoes
     SET revisores_por_trabalho = _n
   WHERE id;

  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.definir_revisores_por_trabalho(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.definir_revisores_por_trabalho(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.definir_revisores_por_trabalho(integer) TO authenticated;

-- ------------------------------------------------------------
-- 4. Mudar o número reabre (ou fecha) revisões em curso
-- ------------------------------------------------------------
-- `aplicar_decisao` só roda quando um parecer é gravado. Sem este
-- trigger, baixar de 3 para 2 deixaria parado em 'em_avaliacao' o
-- trabalho que JÁ tem os 2 pareceres — ninguém mais vai emitir parecer
-- nele. E subir de 2 para 3 deixaria na fila do co-chair um trabalho que
-- `registrar_parecer_editorial` passa a recusar.
--
-- Trabalho com decisão editorial na rodada corrente não se move: a
-- própria `aplicar_decisao` devolve cedo nesse caso.
CREATE OR REPLACE FUNCTION public.reaplicar_fechamento_da_revisao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT t.id FROM public.trabalhos t
    WHERE t.status IN ('pendente', 'em_avaliacao', 'aguardando_parecer_editorial')
  LOOP
    PERFORM public.aplicar_decisao(r.id);
  END LOOP;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_revisores_por_trabalho ON public.configuracoes;
CREATE TRIGGER trg_revisores_por_trabalho
  AFTER UPDATE OF revisores_por_trabalho ON public.configuracoes
  FOR EACH ROW
  WHEN (OLD.revisores_por_trabalho IS DISTINCT FROM NEW.revisores_por_trabalho)
  EXECUTE FUNCTION public.reaplicar_fechamento_da_revisao();

-- ------------------------------------------------------------
-- 5. O teto do INSERT
-- ------------------------------------------------------------
-- Continua por RODADA (20260820140000). Baixar o número não remove
-- ninguém: um trabalho que já tinha 3 fica com 3, e só para de receber.
CREATE OR REPLACE FUNCTION public.check_max_revisores()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_max integer := public.revisores_por_trabalho();
BEGIN
  IF (SELECT count(*) FROM public.trabalho_revisores tr
      WHERE tr.trabalho_id = NEW.trabalho_id
        AND tr.rodada = NEW.rodada) >= v_max THEN
    RAISE EXCEPTION 'Um trabalho pode ter no máximo % revisor(es) associado(s).', v_max;
  END IF;
  RETURN NEW;
END; $$;

-- ------------------------------------------------------------
-- 6. A sugestão
-- ------------------------------------------------------------
-- Com 2 votos o empate é 1/1, e o desempate é o mesmo de antes: aprovar
-- com correções.
CREATE OR REPLACE FUNCTION public.decisao_consolidada(_trabalho_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH votos AS (
    SELECT p.resultado AS voto, count(DISTINCT lower(p.revisor_email)) AS n
    FROM public.pareceres p
    JOIN public.trabalhos t ON t.id = p.trabalho_id
    WHERE p.trabalho_id = _trabalho_id
      AND p.rodada = t.rodada
      AND p.resultado IN ('aprovado', 'aprovado_correcoes', 'nao_aprovado')
    GROUP BY p.resultado
  ),
  topo AS (
    SELECT v.voto FROM votos v WHERE v.n = (SELECT max(v2.n) FROM votos v2)
  )
  SELECT CASE
    WHEN (SELECT coalesce(sum(v.n), 0) FROM votos v) < public.revisores_por_trabalho() THEN NULL
    WHEN (SELECT count(*) FROM topo) = 1 THEN (SELECT t.voto FROM topo t)
    -- Empate: o meio-termo é aprovar com correções.
    ELSE 'aprovado_correcoes'
  END;
$$;
REVOKE ALL ON FUNCTION public.decisao_consolidada(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decisao_consolidada(uuid) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 7. O fechamento da revisão
-- ------------------------------------------------------------
-- Idêntica à da 20260820140000, menos o número. Continua sem escrever
-- desfecho — o canário da seção 10 repete o daquela migration.
CREATE OR REPLACE FUNCTION public.aplicar_decisao(_trabalho_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pareceres integer;
  v_minimo    integer;
  v_rodada    integer;
  v_status    text;
  v_atual     text;
BEGIN
  PERFORM public.exigir_email_confirmado();

  SELECT t.rodada, t.status INTO v_rodada, v_atual
  FROM public.trabalhos t WHERE t.id = _trabalho_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(DISTINCT lower(p.revisor_email)) INTO v_pareceres
  FROM public.pareceres p
  WHERE p.trabalho_id = _trabalho_id AND p.rodada = v_rodada;

  v_minimo := public.revisores_por_trabalho();

  v_status := CASE
    -- Revisão encerrada: a decisão agora é de uma pessoa.
    WHEN v_pareceres >= v_minimo THEN 'aguardando_parecer_editorial'
    -- Avaliação em curso: já tem parecer, mas ainda não todos.
    WHEN v_pareceres > 0 THEN 'em_avaliacao'
    -- Sem nenhum parecer: não mexe no status.
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RETURN NULL;
  END IF;

  -- Decisão editorial já registrada nesta rodada manda mais do que a
  -- contagem de pareceres (ver 20260820140000).
  IF EXISTS (
    SELECT 1 FROM public.decisoes_editoriais d
    WHERE d.trabalho_id = _trabalho_id AND d.rodada = v_rodada
  ) THEN
    RETURN v_atual;
  END IF;

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos t
     SET status = v_status
   WHERE t.id = _trabalho_id
     AND t.status IS DISTINCT FROM v_status;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  RETURN v_status;
END; $$;
REVOKE ALL ON FUNCTION public.aplicar_decisao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicar_decisao(uuid) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 8. A decisão do co-chair
-- ------------------------------------------------------------
-- Idêntica à da 20260820140000, menos o número.
CREATE OR REPLACE FUNCTION public.registrar_parecer_editorial(
  _trabalho_id uuid,
  _decisao     text,
  _comentario  text
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t           public.trabalhos%ROWTYPE;
  v_coment    text := nullif(btrim(coalesce(_comentario, '')), '');
  v_pareceres integer;
  v_minimo    integer;
  v_nome      text;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF _decisao NOT IN ('aprovado', 'aprovado_correcoes', 'reprovado', 'resubmeter') THEN
    RAISE EXCEPTION 'Decisão inválida: %', _decisao;
  END IF;
  IF v_coment IS NULL THEN
    RAISE EXCEPTION 'O comentário da decisão é obrigatório.';
  END IF;

  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;

  -- O autor já cumpriu a decisão anterior: não se muda mais. Antes da
  -- contagem de pareceres de propósito (ver 20260820140000).
  IF t.status = 'aprovado' AND t.correcoes_enviadas_em IS NOT NULL THEN
    RAISE EXCEPTION
      'O autor já enviou a correção — a decisão desta rodada não pode mais ser alterada.';
  END IF;
  IF t.status = 'pendente' AND t.reenviado_em IS NOT NULL THEN
    RAISE EXCEPTION
      'O autor já reenviou o trabalho — a decisão daquela rodada não pode mais ser alterada.';
  END IF;

  SELECT count(DISTINCT lower(p.revisor_email)) INTO v_pareceres
  FROM public.pareceres p
  WHERE p.trabalho_id = _trabalho_id AND p.rodada = t.rodada;

  v_minimo := public.revisores_por_trabalho();
  IF v_pareceres < v_minimo THEN
    RAISE EXCEPTION
      'Este trabalho ainda não recebeu todos os pareceres: tem % de %.', v_pareceres, v_minimo;
  END IF;

  SELECT coalesce(nullif(btrim(p.nome), ''), lower(u.email))
    INTO v_nome
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = auth.uid();

  INSERT INTO public.decisoes_editoriais
    (trabalho_id, rodada, decisao, comentario, decidido_por, decidido_nome)
  VALUES (_trabalho_id, t.rodada, _decisao, v_coment, auth.uid(), v_nome);

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET status = _decisao
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  RETURN _decisao;
END; $$;
REVOKE ALL ON FUNCTION public.registrar_parecer_editorial(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_parecer_editorial(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_parecer_editorial(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 9. A distribuição
-- ------------------------------------------------------------
-- As duas idênticas às da 20260820140000, menos o número. A recomendação
-- não recebe o número como argumento de propósito: ela lê o que está
-- gravado, que é o mesmo que o teto e o fechamento vão cobrar. Um
-- argumento deixaria propor 3 com o fechamento valendo 2.
CREATE OR REPLACE FUNCTION public.recomendar_distribuicao()
RETURNS TABLE(trabalho_id uuid, revisor_email text, revisor_nome text, tipo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_max_por_trabalho integer := public.revisores_por_trabalho();
  v_tid  uuid[] := '{}';
  v_mail text[] := '{}';
  v_nome text[] := '{}';
  v_tipo text[] := '{}';
  t RECORD;
  r RECORD;
  v_vagas integer;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  FOR t IN
    SELECT tr.id, tr.rodada,
           v_max_por_trabalho - (
             SELECT count(*) FROM public.trabalho_revisores x
             WHERE x.trabalho_id = tr.id AND x.rodada = tr.rodada
           ) AS vagas
    FROM public.trabalhos tr
    ORDER BY tr.titulo, tr.id
  LOOP
    -- Negativo quando o número baixou depois da distribuição: o WHILE
    -- simplesmente não entra.
    v_vagas := t.vagas;
    WHILE v_vagas > 0 LOOP
      SELECT pool.email, pool.nome, pool.tipo INTO r
      FROM public._pool_revisores() pool
      CROSS JOIN LATERAL (
        SELECT (
          SELECT count(*) FROM public.trabalho_revisores tr
          JOIN public.trabalhos tt ON tt.id = tr.trabalho_id
          WHERE lower(tr.revisor_email) = pool.email AND tr.rodada = tt.rodada
        ) + (
          SELECT count(*) FROM unnest(v_mail) AS m(mail) WHERE m.mail = pool.email
        ) AS carga
      ) c
      WHERE NOT EXISTS (
          SELECT 1 FROM public.trabalho_revisores tr2
          WHERE tr2.trabalho_id = t.id AND tr2.rodada = t.rodada
            AND lower(tr2.revisor_email) = pool.email
        )
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_tid, v_mail) AS p(tid, mail)
          WHERE p.tid = t.id AND p.mail = pool.email
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.conflitos_do_trabalho(t.id) cf
          WHERE cf.email = pool.email
        )
      ORDER BY c.carga ASC, pool.email
      LIMIT 1;

      EXIT WHEN NOT FOUND;

      v_tid  := v_tid  || t.id;
      v_mail := v_mail || r.email;
      v_nome := v_nome || r.nome;
      v_tipo := v_tipo || r.tipo;
      v_vagas := v_vagas - 1;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT * FROM unnest(v_tid, v_mail, v_nome, v_tipo);
END; $$;
REVOKE ALL ON FUNCTION public.recomendar_distribuicao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recomendar_distribuicao() FROM anon;
GRANT EXECUTE ON FUNCTION public.recomendar_distribuicao() TO authenticated;

CREATE OR REPLACE FUNCTION public.distribuir_revisores(_trabalho_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_criados          integer := 0;
  v_max_por_trabalho integer := public.revisores_por_trabalho();
  v_rodada           integer;
  r RECORD;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT t.rodada INTO v_rodada FROM public.trabalhos t WHERE t.id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;

  LOOP
    EXIT WHEN (
      SELECT count(*) FROM public.trabalho_revisores
      WHERE trabalho_id = _trabalho_id AND rodada = v_rodada
    ) >= v_max_por_trabalho;

    SELECT pool.email, pool.nome, pool.tipo INTO r
    FROM public._pool_revisores() pool
    CROSS JOIN LATERAL (
      SELECT count(*) AS carga
      FROM public.trabalho_revisores tr
      JOIN public.trabalhos tt ON tt.id = tr.trabalho_id
      WHERE lower(tr.revisor_email) = pool.email AND tr.rodada = tt.rodada
    ) c
    WHERE NOT EXISTS (
        SELECT 1 FROM public.trabalho_revisores tr2
        WHERE tr2.trabalho_id = _trabalho_id AND tr2.rodada = v_rodada
          AND lower(tr2.revisor_email) = pool.email
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.conflitos_do_trabalho(_trabalho_id) cf
        WHERE cf.email = pool.email
      )
    ORDER BY c.carga ASC, pool.email
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    INSERT INTO public.trabalho_revisores (trabalho_id, revisor_email, revisor_nome, tipo)
    VALUES (_trabalho_id, r.email, r.nome, r.tipo);
    v_criados := v_criados + 1;
  END LOOP;

  RETURN v_criados;
END; $$;
REVOKE ALL ON FUNCTION public.distribuir_revisores(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.distribuir_revisores(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.distribuir_revisores(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 10. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sobrou text;
  v_fonte  text;
  v_check  boolean;
BEGIN
  -- As seis regras leem o MESMO número. Uma que volte a ter "3" próprio
  -- é o bug do cabeçalho: o fechamento e a recomendação discordando.
  SELECT string_agg(p.proname, ', ') INTO v_sobrou
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'check_max_revisores', 'decisao_consolidada', 'aplicar_decisao',
      'registrar_parecer_editorial', 'recomendar_distribuicao', 'distribuir_revisores'
    )
    AND p.prosrc NOT LIKE '%revisores_por_trabalho()%';
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'Voltaram a usar número fixo de revisores: %', v_sobrou;
  END IF;

  -- Repetido da 20260820140000, porque `aplicar_decisao` foi redefinida.
  SELECT p.prosrc INTO v_fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'aplicar_decisao';
  IF v_fonte ~ '''(aprovado|reprovado|aprovado_correcoes)''' THEN
    RAISE EXCEPTION
      'aplicar_decisao voltou a gravar um desfecho — a decisão automática está de volta.';
  END IF;

  -- Repetido da 20260820120000, porque `distribuir_revisores` foi redefinida.
  SELECT p.prosrc INTO v_fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'distribuir_revisores';
  IF v_fonte LIKE '%owner_id = auth.uid()%' THEN
    RAISE EXCEPTION
      'distribuir_revisores ainda autoriza o dono do trabalho — a distribuição automática segue aberta ao autor.';
  END IF;

  -- `anon` não executa nada desta migration.
  SELECT string_agg(p.proname, ', ') INTO v_sobrou
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'revisores_por_trabalho', 'definir_revisores_por_trabalho',
      'recomendar_distribuicao', 'distribuir_revisores', 'registrar_parecer_editorial'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'anon ainda executa: %', v_sobrou;
  END IF;

  -- O CHECK é quem manda no intervalo. O UPDATE roda num subbloco: se o
  -- CHECK recusar, o subbloco desfaz; se aceitar, o RAISE de baixo
  -- derruba a migration inteira (e o UPDATE junto).
  BEGIN
    UPDATE public.configuracoes SET revisores_por_trabalho = 4 WHERE id;
    v_check := false;
  EXCEPTION WHEN check_violation THEN
    v_check := true;
  END;
  IF NOT v_check THEN
    RAISE EXCEPTION 'O CHECK de revisores_por_trabalho caiu: 4 foi aceito.';
  END IF;
END $$;
