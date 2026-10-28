-- ============================================================
-- Divulgação dos resultados — um e-mail por autor, pela conta UFLA
-- ------------------------------------------------------------
-- O admin marca em /admin/configuracoes o MOMENTO da divulgação (data e
-- hora de Brasília). A partir dele, cada autor recebe UM e-mail de
-- congressoparaiso@ufla.br com todos os seus trabalhos: o desfecho de cada
-- um e a média das notas.
--
-- É a mesma fila dos e-mails aos revisores (20261014120000/20261026120000):
-- o Apps Script busca a cada minuto pela Edge Function `emails-revisores`,
-- que agora pede também a `resultados_devidos()` o que sobrar do lote. O
-- Apps Script não muda — os ids dos dois registros são UUIDs, e
-- `concluir_envios` fecha cada um na tabela certa.
--
-- As regras, decididas com o usuário em 2026-10-27:
--
--   · UM e-mail por autor, e com TODOS os trabalhos dele. Por isso o
--     e-mail espera até o último trabalho do autor ter decisão — um
--     trabalho ainda em avaliação segura o e-mail daquele autor (a tela do
--     admin mostra quantos estão esperando).
--   · Ordem de urgência: reenvio solicitado → aprovado com correções →
--     aprovado → reprovado. O autor entra na fila pelo desfecho MAIS
--     urgente que tiver, e a fila só desce para a faixa seguinte quando a
--     de cima esvazia.
--   · O portal NÃO muda: o autor continua vendo a decisão assim que o
--     co-chair a registra. A data só dispara o e-mail (e, na sessão
--     seguinte, abre o envio de pôsteres).
--   · Mudar a data depois não reenvia nada: quem já recebeu não recebe de
--     novo, nem a decisão da rodada 2 de um trabalho reenviado.
--
-- A regra mora AQUI; a Edge Function só monta o texto; o Apps Script só envia.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. O momento da divulgação
-- ------------------------------------------------------------
-- TIMESTAMP SEM fuso, lido como hora de Brasília: o `datetime-local` da
-- tela grava "AAAA-MM-DDTHH:MM" tal como o admin digitou, e só o servidor
-- converte (`AT TIME ZONE 'America/Sao_Paulo'`). Nem o relógio nem o fuso
-- do navegador entram na conta — mesma postura do prazo de submissão.
--
-- NULL = nada sai, o mesmo "vazio não dispara" de `revisoes_encerramento`:
-- aplicar esta migration não manda e-mail a ninguém.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS resultados_divulgacao TIMESTAMP;

COMMENT ON COLUMN public.configuracoes.resultados_divulgacao IS
  'Momento da divulgação dos resultados, hora de Brasília (sem fuso). '
  'A partir dele cada autor recebe um e-mail com todos os seus trabalhos. NULL = nada sai.';

-- ------------------------------------------------------------
-- 2. "Já divulgou?" — uma definição só
-- ------------------------------------------------------------
-- Usada pela fila daqui e, na sessão dos pôsteres, pela RPC que abre o
-- envio deles. Sem linha ou sem data = false.
CREATE OR REPLACE FUNCTION public.resultados_divulgados()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT now() >= (c.resultados_divulgacao AT TIME ZONE 'America/Sao_Paulo')
       FROM public.configuracoes c
      WHERE c.id),
    false);
$$;
-- `FROM PUBLIC` não tira o grant DIRETO que o ALTER DEFAULT PRIVILEGES do
-- projeto dá a anon (20260908120000): o REVOKE de anon é explícito.
REVOKE ALL ON FUNCTION public.resultados_divulgados() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resultados_divulgados() FROM anon;
GRANT EXECUTE ON FUNCTION public.resultados_divulgados() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. O registro — um e-mail de resultado por linha
-- ------------------------------------------------------------
-- Irmã de `envios_revisores`: nasce 'reservado' na busca e o Apps Script a
-- fecha como 'enviado' ou 'falha', com a frase do Google.
CREATE TABLE IF NOT EXISTS public.envios_resultados (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sem FK: purgar a conta não apaga o histórico do envio.
  autor_id     uuid NOT NULL,
  autor_email  text NOT NULL,
  autor_nome   text,
  -- 1 reenvio · 2 aprovado com correções · 3 aprovado · 4 reprovado: o
  -- desfecho mais urgente entre os trabalhos do autor.
  prioridade   smallint NOT NULL CHECK (prioridade BETWEEN 1 AND 4),
  -- Cópia: o que o e-mail DISSE, mesmo que o trabalho mude depois.
  -- [{ titulo, status, media, pareceres }]
  trabalhos    jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'reservado'
               CHECK (status IN ('reservado', 'enviado', 'falha')),
  erro         text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);

-- ⚠ "Um e-mail por autor" é ESTE índice, não código. A reserva é um
-- INSERT … ON CONFLICT DO NOTHING contra ele: duas buscas simultâneas não
-- reservam o mesmo autor, e nenhuma busca reserva quem já recebeu. Falha
-- fica fora do índice — é o que deixa a fila tentar de novo.
CREATE UNIQUE INDEX IF NOT EXISTS envios_resultados_um_por_autor
  ON public.envios_resultados (autor_id)
  WHERE status IN ('reservado', 'enviado');

CREATE INDEX IF NOT EXISTS envios_resultados_criado_em_idx
  ON public.envios_resultados (criado_em DESC);

-- Leitura: o admin, no card da divulgação em /admin/configuracoes (a
-- policy acompanha onde a tela mora). Escrita: policy nenhuma — só
-- `resultados_devidos` e `concluir_envios` (SECURITY DEFINER) gravam aqui.
ALTER TABLE public.envios_resultados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "envios_resultados select" ON public.envios_resultados;
CREATE POLICY "envios_resultados select" ON public.envios_resultados
  FOR SELECT TO authenticated
  USING (public.is_app_admin() AND public.email_confirmado());
-- O ALTER DEFAULT PRIVILEGES do projeto concede tudo a anon.
REVOKE ALL ON public.envios_resultados FROM anon;

-- ------------------------------------------------------------
-- 4. A fila dos resultados
-- ------------------------------------------------------------
-- Um autor está DEVIDO quando:
--   · a divulgação já passou;
--   · TODOS os trabalhos dele têm decisão (um trabalho reenviado antes da
--     divulgação voltou a 'pendente' e segura o e-mail até a rodada 2
--     decidir — é o "espera todas as decisões");
--   · não há envio dele 'reservado' nem 'enviado';
--   · e falhou menos de 3 vezes: endereço que o Google recusa para de ser
--     tentado, em vez de falhar a cada minuto para sempre. As falhas ficam
--     no registro, à vista do admin.
--
-- `ORDER BY prioridade` no recorte E na devolução: o lote pega primeiro a
-- faixa mais urgente, e o Apps Script envia na ordem em que recebe.
--
-- A nota é a média dos `itens[].nota` dos pareceres da RODADA CORRENTE —
-- os que produziram a decisão que o e-mail comunica.
CREATE OR REPLACE FUNCTION public.resultados_devidos(_limite integer DEFAULT 20)
RETURNS TABLE(
  envio_id    uuid,
  autor_email text,
  autor_nome  text,
  prioridade  smallint,
  trabalhos   jsonb
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
-- Os nomes do RETURNS TABLE também são variáveis aqui dentro e colidem com
-- colunas de envios_resultados: toda coluna abaixo vai qualificada.
DECLARE
  v_limite integer := least(greatest(coalesce(_limite, 20), 1), 50);
  v_ids    uuid[];
BEGIN
  IF NOT public.resultados_divulgados() THEN
    RETURN;
  END IF;

  WITH papel AS (
    -- `urgencia` NULL = sem decisão (pendente, em avaliação, com a organização).
    SELECT t.id, t.owner_id, t.titulo, t.status, t.rodada,
           CASE t.status
             WHEN 'resubmeter'         THEN 1
             WHEN 'aprovado_correcoes' THEN 2
             WHEN 'aprovado'           THEN 3
             WHEN 'reprovado'          THEN 4
           END AS urgencia
      FROM public.trabalhos t
     WHERE t.owner_id IS NOT NULL
  ), devido AS (
    SELECT p.owner_id, min(p.urgencia)::smallint AS urgencia
      FROM papel p
     GROUP BY p.owner_id
    HAVING bool_and(p.urgencia IS NOT NULL)
       AND NOT EXISTS (
             SELECT 1 FROM public.envios_resultados er
              WHERE er.autor_id = p.owner_id
                AND er.status IN ('reservado', 'enviado'))
       AND (SELECT count(*) FROM public.envios_resultados er
             WHERE er.autor_id = p.owner_id AND er.status = 'falha') < 3
     ORDER BY 2, 1
     LIMIT v_limite
  ), novos AS (
    INSERT INTO public.envios_resultados AS er
           (autor_id, autor_email, autor_nome, prioridade, trabalhos)
    SELECT d.owner_id,
           lower(u.email),
           nullif(btrim(pf.nome), ''),
           d.urgencia,
           (SELECT jsonb_agg(jsonb_build_object(
                     'titulo',    p.titulo,
                     'status',    p.status,
                     'media',     n.media,
                     'pareceres', n.pareceres)
                   ORDER BY p.urgencia, p.titulo)
              FROM papel p
             CROSS JOIN LATERAL (
               -- Uma linha sempre: sem parecer, média NULL e 0 pareceres.
               -- Nota que não é número fica de fora da média em vez de
               -- derrubar a busca — um parecer malformado não pode segurar
               -- o e-mail de todos os autores.
               SELECT round(avg(CASE WHEN i.item->>'nota' ~ '^[0-9]+(\.[0-9]+)?$'
                                     THEN (i.item->>'nota')::numeric END), 2) AS media,
                      count(DISTINCT pa.id) AS pareceres
                 FROM public.pareceres pa
                 LEFT JOIN LATERAL jsonb_array_elements(
                        CASE WHEN jsonb_typeof(pa.itens) = 'array' THEN pa.itens
                             ELSE '[]'::jsonb END) AS i(item) ON true
                WHERE pa.trabalho_id = p.id
                  AND pa.rodada = p.rodada
             ) n
             WHERE p.owner_id = d.owner_id)
      FROM devido d
      JOIN auth.users u ON u.id = d.owner_id
      LEFT JOIN public.profiles pf ON pf.id = d.owner_id
     WHERE u.email IS NOT NULL
    ON CONFLICT (autor_id) WHERE status IN ('reservado', 'enviado') DO NOTHING
    RETURNING er.id
  )
  SELECT array_agg(novos.id) INTO v_ids FROM novos;

  RETURN QUERY
    SELECT er.id, er.autor_email, er.autor_nome, er.prioridade, er.trabalhos
      FROM public.envios_resultados er
     WHERE er.id = ANY (v_ids)
     ORDER BY er.prioridade, er.autor_email;
END; $$;
-- Só a Edge Function (service_role) busca a fila: buscar é reservar.
REVOKE ALL ON FUNCTION public.resultados_devidos(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resultados_devidos(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resultados_devidos(integer) TO service_role;

-- ------------------------------------------------------------
-- 5. `concluir_envios` fecha os dois registros
-- ------------------------------------------------------------
-- O laço dos revisores é o da 20261026120000, palavra por palavra. O que
-- entra é o segundo UPDATE: os UUIDs não colidem entre as tabelas, então
-- o Apps Script continua mandando uma lista só e não precisa saber de
-- qual fila veio cada e-mail.
--
-- Falha de resultado não precisa de devolução: a linha vira 'falha', sai
-- do índice de "um por autor", e `resultados_devidos` a pega de novo no
-- minuto seguinte (até a 3ª falha).
CREATE OR REPLACE FUNCTION public.concluir_envios(_resultados jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  r   record;
BEGIN
  FOR r IN
    UPDATE public.envios_revisores en
       SET status       = CASE WHEN x.erro IS NULL THEN 'enviado' ELSE 'falha' END,
           erro         = x.erro,
           concluido_em = now()
      FROM (SELECT (j->>'id')::uuid AS id,
                   nullif(left(j->>'erro', 500), '') AS erro
              FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) j) x
     WHERE en.id = x.id
       AND en.status = 'reservado'
    RETURNING en.tipo, en.associacoes, en.status
  LOOP
    v_n := v_n + 1;
    CONTINUE WHEN r.status = 'enviado';

    IF r.tipo = 'atribuicao' THEN
      -- `aviso_enviado_em IS NOT NULL`: se o co-chair reenviou enquanto este
      -- envio estava no ar, a associação já está de volta à fila — não a tira.
      UPDATE public.trabalho_revisores tr
         SET aviso_solicitado_em = NULL, aviso_enviado_em = NULL
       WHERE tr.id = ANY (r.associacoes)
         AND tr.aviso_enviado_em IS NOT NULL;
    ELSIF r.tipo = 'lembrete' THEN
      UPDATE public.trabalho_revisores tr SET lembrete_prazo = NULL
       WHERE tr.id = ANY (r.associacoes);
    ELSE
      UPDATE public.trabalho_revisores tr SET atraso_prazo = NULL
       WHERE tr.id = ANY (r.associacoes);
    END IF;
  END LOOP;

  -- Os resultados aos autores (migration 20261027120000).
  WITH x AS (
    SELECT (j->>'id')::uuid AS id,
           nullif(left(j->>'erro', 500), '') AS erro
      FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) j
  ), fechados AS (
    UPDATE public.envios_resultados er
       SET status       = CASE WHEN x.erro IS NULL THEN 'enviado' ELSE 'falha' END,
           erro         = x.erro,
           concluido_em = now()
      FROM x
     WHERE er.id = x.id
       AND er.status = 'reservado'
    RETURNING er.id
  )
  SELECT v_n + count(*) INTO v_n FROM fechados;

  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.concluir_envios(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.concluir_envios(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concluir_envios(jsonb) TO service_role;

-- ------------------------------------------------------------
-- 6. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sobrou  text;
  v_default text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_sobrou
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('resultados_devidos', 'concluir_envios')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'Ficou executável pela API: %. Buscar a fila é reservá-la.', v_sobrou;
  END IF;

  IF NOT has_function_privilege('service_role', 'public.resultados_devidos(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.concluir_envios(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role sem EXECUTE na fila: a Edge Function não conseguiria buscar nem concluir.';
  END IF;

  IF has_function_privilege('anon', 'public.resultados_divulgados()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa resultados_divulgados — o REVOKE explícito não pegou.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.resultados_divulgados()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE em resultados_divulgados: a tela do autor não saberia se abriu.';
  END IF;

  IF has_table_privilege('anon', 'public.envios_resultados', 'SELECT') THEN
    RAISE EXCEPTION 'anon lê envios_resultados: e-mail de autor ficaria público.';
  END IF;

  -- Uma policy de escrita deixaria "corrigir" o registro à mão — e ele
  -- deixaria de dizer o que o Google respondeu.
  SELECT string_agg(pol.policyname, ', ') INTO v_sobrou
    FROM pg_policies pol
   WHERE pol.schemaname = 'public' AND pol.tablename = 'envios_resultados'
     AND pol.cmd <> 'SELECT';
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'envios_resultados ganhou policy de escrita: %.', v_sobrou;
  END IF;

  -- Sem o índice, a reserva não tem contra o que conflitar: o mesmo autor
  -- seria reservado de novo a cada busca e receberia um e-mail por minuto.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes i
     WHERE i.schemaname = 'public'
       AND i.indexname = 'envios_resultados_um_por_autor'
       AND i.indexdef LIKE 'CREATE UNIQUE INDEX%'
       AND i.indexdef LIKE '%WHERE%'
  ) THEN
    RAISE EXCEPTION 'Falta o índice único parcial envios_resultados_um_por_autor — "um e-mail por autor" deixou de valer.';
  END IF;

  -- A decisão do usuário: o e-mail espera TODOS os trabalhos do autor.
  IF position('bool_and' IN (
       SELECT p.prosrc FROM pg_proc p
        WHERE p.oid = 'public.resultados_devidos(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'resultados_devidos deixou de esperar todas as decisões do autor.';
  END IF;

  IF position('America/Sao_Paulo' IN (
       SELECT p.prosrc FROM pg_proc p
        WHERE p.oid = 'public.resultados_divulgados()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'resultados_divulgados deixou de ler o momento na hora de Brasília.';
  END IF;

  -- Sem isto o resultado ficaria 'reservado' para sempre, mesmo enviado.
  IF position('envios_resultados' IN (
       SELECT p.prosrc FROM pg_proc p
        WHERE p.oid = 'public.concluir_envios(jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'concluir_envios não fecha envios_resultados.';
  END IF;

  -- A coluna nasce vazia: aplicar a migration não pode disparar e-mail.
  SELECT c.column_default INTO v_default
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'configuracoes'
     AND c.column_name = 'resultados_divulgacao';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'configuracoes.resultados_divulgacao não existe.';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'configuracoes.resultados_divulgacao ganhou DEFAULT (%): a divulgação dispararia sozinha.', v_default;
  END IF;

  RAISE NOTICE 'OK: um e-mail por autor, fila só para service_role, registro só para o admin.';
END $$;
