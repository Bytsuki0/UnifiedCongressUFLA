-- ============================================================
-- Distribuição de revisores vira RECOMENDAÇÃO
-- ------------------------------------------------------------
-- Até aqui o sistema associava revisores sozinho, sem ninguém autorizar,
-- por dois caminhos:
--
--   1. No INSTANTE da submissão — o cliente chamava `distribuir_revisores`
--      logo depois do INSERT em `trabalhos`. O autor apertava "Enviar" e o
--      banco já escolhia até 3 revisores. Ninguém da organização participava.
--   2. No botão "Distribuição automática" de /co-chairs/atribuicoes — um
--      laço em TypeScript que GRAVAVA enquanto calculava. O co-chair só
--      descobria o resultado depois de aplicado.
--
-- Agora a distribuição é proposta e só existe depois do aval de um
-- co-chair (ou acima). Esta migration entrega as duas metades disso:
--
--   · `recomendar_distribuicao()`  — calcula e NÃO grava nada.
--   · `confirmar_distribuicao()`   — grava o que o co-chair confirmou,
--                                     tudo ou nada, numa transação.
--
-- E fecha o portão que sobrava: `distribuir_revisores` aceitava ser
-- chamada pelo DONO do trabalho. Tirar a chamada do cliente não fecharia
-- isso — a RPC é SECURITY DEFINER com GRANT a `authenticated`, então
-- qualquer autor continuaria podendo se auto-atribuir revisores direto
-- pela API. A mudança seria só de fachada.
--
-- ------------------------------------------------------------
-- O teto de 5 trabalhos por revisor deixa de existir
-- ------------------------------------------------------------
-- Ele era um teto DURO: com todo mundo em 5, a distribuição simplesmente
-- parava e o trabalho ficava com menos de 3 revisores — silenciosamente,
-- porque a função só devolve quantas associações criou, nunca quantas
-- deixou de criar. Some daqui e vira META (4), que a ordenação por menor
-- carga já implementa sozinha: enquanto houver alguém elegível com menos
-- de 4, é ele quem sai; quando o pool inteiro está em 4 e ainda falta
-- revisor para completar um trabalho, aí sim alguém passa de 4.
--
-- Preencher o trabalho passa na frente de equilibrar a carga. O contrário
-- é o que deixava trabalho a descoberto.
--
-- O que esta migration NÃO toca: a decisão consolidada automática
-- (`aplicar_decisao` / moda dos pareceres) segue exatamente como está.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `distribuir_revisores`: só a organização
-- ------------------------------------------------------------
-- Corpo idêntico ao de 20260806140000, com uma única diferença: o ramo
-- `OR trabalhos.owner_id = auth.uid()` sai do teste de autorização.
-- Ninguém mais distribui revisores para o próprio trabalho.
--
-- A função permanece porque continua sendo a versão servidor da mesma
-- seleção — útil para um lote administrativo e coberta pela sonda de RLS.
CREATE OR REPLACE FUNCTION public.distribuir_revisores(_trabalho_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_criados          integer := 0;
  v_max_por_trabalho CONSTANT integer := 3;
  r RECORD;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  -- Era `is_event_staff() OR dono do trabalho`. O dono saiu.
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  LOOP
    EXIT WHEN (SELECT count(*) FROM public.trabalho_revisores WHERE trabalho_id = _trabalho_id)
              >= v_max_por_trabalho;

    -- Sem filtro de carga: o `ORDER BY c.carga` no fim é que mantém a
    -- meta de 4. Ver o cabeçalho desta migration.
    SELECT pool.email, pool.nome, pool.tipo INTO r
    FROM public._pool_revisores() pool
    CROSS JOIN LATERAL (
      SELECT count(*) AS carga FROM public.trabalho_revisores tr
      WHERE lower(tr.revisor_email) = pool.email
    ) c
    WHERE NOT EXISTS (
        SELECT 1 FROM public.trabalho_revisores tr2
        WHERE tr2.trabalho_id = _trabalho_id AND lower(tr2.revisor_email) = pool.email
      )
      -- Conflito de interesse: autor, orientador ou coautor.
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
-- A linha que faltava desde 20260709120000: só o REVOKE de `anon` desfaz
-- o default privilege do projeto (lição da 20260813150000).
REVOKE ALL ON FUNCTION public.distribuir_revisores(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.distribuir_revisores(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 2. `recomendar_distribuicao`: propõe, não grava
-- ------------------------------------------------------------
-- Mesma seleção gulosa de `distribuir_revisores` (menor carga primeiro,
-- teto de 3 por trabalho, conflito de interesse fora), varrendo de uma vez
-- todos os trabalhos com menos de 3 revisores.
--
-- "Menor carga primeiro" é o que realiza a meta de 4 trabalhos por
-- revisor sem teto duro: ninguém chega a 5 enquanto sobrar alguém
-- elegível com 4 ou menos, e passar de 4 só acontece quando a alternativa
-- é deixar trabalho com menos de 3 revisores.
--
-- A diferença está em não poder gravar: as escolhas da rodada precisam
-- pesar no cálculo de carga das rodadas seguintes, senão o mesmo revisor
-- de carga zero seria proposto para todos os trabalhos. Elas ficam em
-- arrays plpgsql, e os `unnest` abaixo somam essas escolhas à carga real.
--
-- ⚠ Nada de tabela temporária aqui: `CREATE TEMP TABLE`/`INSERT` dentro
-- de função não-VOLATILE é recusado pelo Postgres ("not allowed in a
-- non-volatile function"), e STABLE é justamente o que documenta, na
-- assinatura, que esta função não escreve.
CREATE OR REPLACE FUNCTION public.recomendar_distribuicao()
RETURNS TABLE(trabalho_id uuid, revisor_email text, revisor_nome text, tipo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_max_por_trabalho CONSTANT integer := 3;
  -- As quatro colunas da proposta, acumuladas em paralelo.
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
    SELECT tr.id,
           v_max_por_trabalho - (
             SELECT count(*) FROM public.trabalho_revisores x WHERE x.trabalho_id = tr.id
           ) AS vagas
    FROM public.trabalhos tr
    ORDER BY tr.titulo, tr.id
  LOOP
    v_vagas := t.vagas;
    WHILE v_vagas > 0 LOOP
      SELECT pool.email, pool.nome, pool.tipo INTO r
      FROM public._pool_revisores() pool
      CROSS JOIN LATERAL (
        SELECT (
          SELECT count(*) FROM public.trabalho_revisores tr
          WHERE lower(tr.revisor_email) = pool.email
        ) + (
          -- Escolhas desta mesma rodada contam como carga.
          SELECT count(*) FROM unnest(v_mail) AS m(mail) WHERE m.mail = pool.email
        ) AS carga
      ) c
      -- Sem filtro de carga, de novo: a meta de 4 é a ordenação.
      WHERE NOT EXISTS (
          SELECT 1 FROM public.trabalho_revisores tr2
          WHERE tr2.trabalho_id = t.id AND lower(tr2.revisor_email) = pool.email
        )
        -- Já proposto para ESTE trabalho nesta rodada.
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_tid, v_mail) AS p(tid, mail)
          WHERE p.tid = t.id AND p.mail = pool.email
        )
        -- Conflito de interesse: autor, orientador ou coautor.
        AND NOT EXISTS (
          SELECT 1 FROM public.conflitos_do_trabalho(t.id) cf
          WHERE cf.email = pool.email
        )
      ORDER BY c.carga ASC, pool.email
      LIMIT 1;

      -- Sem candidato possível: este trabalho fica com menos de 3.
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

COMMENT ON FUNCTION public.recomendar_distribuicao() IS
  'Proposta de distribuição de revisores. NÃO grava — quem grava é confirmar_distribuicao().';

-- ------------------------------------------------------------
-- 3. `confirmar_distribuicao`: grava o que o co-chair aprovou
-- ------------------------------------------------------------
-- Recebe [{"trabalho_id": "...", "revisor_email": "..."}, ...] e devolve
-- quantas associações criou.
--
-- Uma RPC é uma transação, e é essa a garantia que o fluxo novo pede:
-- qualquer RAISE aqui — ou qualquer trigger que recuse — aborta o LOTE
-- inteiro. Não existe distribuição pela metade, com um co-chair tendo de
-- adivinhar até onde a gravação chegou.
--
-- `nome` e `tipo` NÃO vêm do corpo: são resolvidos no servidor a partir
-- do e-mail, contra o pool. O cliente informa a escolha, nunca os
-- atributos dela — mesmo princípio do `auth.getUser()` das Edge Functions.
CREATE OR REPLACE FUNCTION public.confirmar_distribuicao(_pares jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_criados integer := 0;
  p RECORD;
  v_nome text;
  v_tipo text;
  v_titulo text;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  IF _pares IS NULL OR jsonb_typeof(_pares) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: esperado um array de pares.';
  END IF;

  FOR p IN
    SELECT (e ->> 'trabalho_id')::uuid       AS tid,
           lower(trim(e ->> 'revisor_email')) AS email
    FROM jsonb_array_elements(_pares) AS e
  LOOP
    IF p.tid IS NULL OR coalesce(p.email, '') = '' THEN
      RAISE EXCEPTION 'Par inválido: trabalho e revisor são obrigatórios.';
    END IF;

    SELECT tr.titulo INTO v_titulo FROM public.trabalhos tr WHERE tr.id = p.tid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Trabalho não encontrado: %', p.tid;
    END IF;

    -- Fora do pool não entra, e é daqui que saem nome e tipo.
    SELECT pool.nome, pool.tipo INTO v_nome, v_tipo
    FROM public._pool_revisores() pool
    WHERE pool.email = p.email;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '% não está no pool de revisores (conceda o papel de professor ou avaliador em Papéis).',
        p.email;
    END IF;

    -- Duplicata: o UNIQUE (trabalho_id, revisor_email) da tabela é
    -- case-sensitive, enquanto todo o resto do SQL compara com lower().
    -- Uma linha antiga em maiúsculas passaria pelo UNIQUE e viraria
    -- revisor repetido; por isso a checagem é explícita e com lower().
    IF EXISTS (
      SELECT 1 FROM public.trabalho_revisores tr
      WHERE tr.trabalho_id = p.tid AND lower(tr.revisor_email) = p.email
    ) THEN
      RAISE EXCEPTION '% já revisa o trabalho "%".', p.email, v_titulo;
    END IF;

    -- Não há teto de trabalhos por revisor, e é deliberado: 4 é meta da
    -- recomendação, não regra. Um co-chair que decida dar o quinto
    -- trabalho a alguém — porque o pool acabou — não pode ser barrado
    -- aqui; era esse teto que deixava trabalho com menos de 3 revisores.
    --
    -- Teto de 3 por trabalho e conflito de interesse NÃO são repetidos
    -- aqui de propósito: `trg_max_revisores` e `trg_conflito_revisor`
    -- disparam neste INSERT, dentro desta transação, e as frases deles
    -- já dizem quem é a pessoa e em que qualidade ela consta.
    INSERT INTO public.trabalho_revisores (trabalho_id, revisor_email, revisor_nome, tipo)
    VALUES (p.tid, p.email, v_nome, v_tipo);
    v_criados := v_criados + 1;
  END LOOP;

  RETURN v_criados;
END; $$;
REVOKE ALL ON FUNCTION public.confirmar_distribuicao(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_distribuicao(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirmar_distribuicao(jsonb) TO authenticated;

COMMENT ON FUNCTION public.confirmar_distribuicao(jsonb) IS
  'Grava a distribuição revisada por um co-chair. Tudo ou nada: um par recusado aborta o lote.';

-- ------------------------------------------------------------
-- 4. Confere na própria migration
-- ------------------------------------------------------------
-- Sem isto a brecha voltaria em silêncio: `anon` executando qualquer uma
-- das três, ou a `distribuir_revisores` ainda aceitando o dono do
-- trabalho. Falhar aqui é melhor do que descobrir na sonda.
DO $$
DECLARE
  v_sobrou text;
  v_fonte  text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_sobrou
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('distribuir_revisores', 'recomendar_distribuicao', 'confirmar_distribuicao')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'anon ainda executa: %', v_sobrou;
  END IF;

  SELECT p.prosrc INTO v_fonte
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'distribuir_revisores';

  IF v_fonte LIKE '%owner_id = auth.uid()%' THEN
    RAISE EXCEPTION
      'distribuir_revisores ainda autoriza o dono do trabalho — a distribuição automática segue aberta ao autor.';
  END IF;
END $$;
