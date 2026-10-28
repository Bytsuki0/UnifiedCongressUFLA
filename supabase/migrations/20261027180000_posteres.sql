-- ============================================================
-- Pôsteres — o anexo que o autor entrega DEPOIS da divulgação
-- ------------------------------------------------------------
-- Pedido de 2026-10-27, a segunda parte da divulgação dos resultados
-- (20261027120000). Uma exigência de PDF em /co-chairs/categorias ganha
-- uma terceira opção além de obrigatória e opcional: PÔSTER. Ela não
-- aparece na submissão; o autor manda o pôster depois, pela lista de
-- trabalhos (/estudante/papeis-submetidos), e só quando:
--
--   · a divulgação dos resultados já passou (`resultados_divulgados()`);
--   · o trabalho foi aprovado — 'aprovado' ou 'aprovado_correcoes'
--     (decisão do usuário);
--   · a categoria do trabalho pede pôster.
--
-- Todos os pôsteres aparecem numa aba nova dos co-chairs.
--
-- O pôster mora em `trabalho_anexos`, como todo anexo: excluir o trabalho
-- já o apaga do Storage, as telas já sabem abri-lo, e a FK ON DELETE SET
-- NULL já protege a entrega quando a exigência some. O que muda é QUEM
-- escreve: a submissão (`aplicar_anexos`) passa a ignorar pôster, e ele
-- ganha RPC própria, `enviar_posteres`.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. A marca, na exigência e na entrega
-- ------------------------------------------------------------
-- NOT NULL DEFAULT false: tudo o que existe continua sendo o que era.
ALTER TABLE public.categoria_anexos
  ADD COLUMN IF NOT EXISTS poster BOOLEAN NOT NULL DEFAULT false;

-- Pôster é sempre PDF e nunca é obrigatório: não há submissão para ele
-- trancar. O CHECK é o que impede a combinação sem sentido, não a tela.
ALTER TABLE public.categoria_anexos
  DROP CONSTRAINT IF EXISTS categoria_anexos_poster_check;
ALTER TABLE public.categoria_anexos
  ADD CONSTRAINT categoria_anexos_poster_check
  CHECK (NOT poster OR (tipo = 'pdf' AND NOT obrigatorio));

COMMENT ON COLUMN public.categoria_anexos.poster IS
  'true = pôster: fora da submissão; o autor de trabalho aprovado o envia depois da divulgação (enviar_posteres).';

-- Cópia na entrega, como `tipo`, `titulo` e `ordem`: apagar a exigência
-- deixa `anexo_id` nulo, e sem a cópia o pôster viraria "anexo órfão" —
-- que a próxima gravação do autor descartaria.
ALTER TABLE public.trabalho_anexos
  ADD COLUMN IF NOT EXISTS poster BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.trabalho_anexos
  DROP CONSTRAINT IF EXISTS trabalho_anexos_poster_check;
ALTER TABLE public.trabalho_anexos
  ADD CONSTRAINT trabalho_anexos_poster_check CHECK (NOT poster OR tipo = 'pdf');

-- ------------------------------------------------------------
-- 2. O modo não troca depois da primeira entrega
-- ------------------------------------------------------------
-- Mesmo motivo de `tipo` não ser editável: transformar em pôster uma
-- exigência que trabalhos já cumpriram na submissão deixaria aquelas
-- entregas penduradas numa exigência que a submissão não cobra mais (e
-- com `poster = false`, fora da aba dos pôsteres); o contrário poria um
-- pôster dentro do formulário de submissão. Sem entrega nenhuma, a troca é
-- livre — é o que deixa o co-chair corrigir um clique errado.
--
-- SECURITY DEFINER: a contagem não pode depender do que a RLS deixa quem
-- edita enxergar.
CREATE OR REPLACE FUNCTION public.trava_modo_poster()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.poster IS DISTINCT FROM OLD.poster
     AND EXISTS (SELECT 1 FROM public.trabalho_anexos ta WHERE ta.anexo_id = OLD.id) THEN
    RAISE EXCEPTION
      'Este anexo já foi entregue por algum trabalho e não pode virar pôster (nem deixar de ser). Crie uma exigência nova e remova esta.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.trava_modo_poster() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trava_modo_poster() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_trava_modo_poster ON public.categoria_anexos;
CREATE TRIGGER trg_trava_modo_poster
  BEFORE UPDATE OF poster ON public.categoria_anexos
  FOR EACH ROW EXECUTE FUNCTION public.trava_modo_poster();

-- ------------------------------------------------------------
-- 3. O revisor não vê pôster
-- ------------------------------------------------------------
-- A policy da 20260904120000 com UMA mudança, no ramo do revisor: pôster
-- leva nome e instituição dos autores, e a avaliação é às cegas. Ele só
-- existe depois da decisão, mas a barreira é a RLS, não o calendário.
-- Organização e dono continuam vendo tudo.
DROP POLICY IF EXISTS "trabalho_anexos select" ON public.trabalho_anexos;
CREATE POLICY "trabalho_anexos select" ON public.trabalho_anexos FOR SELECT TO authenticated
  USING (
    public.email_confirmado()
    AND EXISTS (
      SELECT 1 FROM public.trabalhos t
      WHERE t.id = trabalho_anexos.trabalho_id
        AND (
          public.is_event_staff()
          OR t.owner_id = auth.uid()
          OR (NOT trabalho_anexos.poster AND EXISTS (
            SELECT 1 FROM public.trabalho_revisores tr
            WHERE tr.trabalho_id = t.id
              AND lower(tr.revisor_email) = lower(auth.email())
          ))
        )
    )
  );

-- ------------------------------------------------------------
-- 4. A submissão ignora o pôster
-- ------------------------------------------------------------
-- É a `aplicar_anexos` da 20260911120000 com três mudanças:
--
--   · pôster enviado no corpo da submissão é RECUSADO com a frase certa
--     (sem isto ele seria ignorado em silêncio, e o autor acharia que
--     mandou);
--   · o laço só percorre exigências que NÃO são pôster;
--   · ⚠ a limpeza do fim nunca alcança linha de pôster. É a mudança que
--     importa: `enviar_correcao` passa por aqui, e quem foi aprovado com
--     correções pode mandar o pôster ANTES da correção. Sem o `NOT
--     ta.poster`, corrigir o trabalho apagaria o pôster e devolveria o PDF
--     dele como órfão.
CREATE OR REPLACE FUNCTION public.aplicar_anexos(_trabalho_id uuid, _anexos jsonb)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_categoria uuid;
  v_uid       uuid := auth.uid();
  v_lista     jsonb := coalesce(_anexos, '[]'::jsonb);
  d           RECORD;
  v_enviado   text;
  v_atual     text;
  v_valor     text;
  v_orfaos    text[] := '{}'::text[];
  v_vistos    uuid[] := '{}'::uuid[];
BEGIN
  IF jsonb_typeof(v_lista) <> 'array' THEN
    RAISE EXCEPTION 'Lista de anexos inválida.';
  END IF;

  SELECT t.categoria_id INTO v_categoria
  FROM public.trabalhos t WHERE t.id = _trabalho_id;

  -- ⚠ Trabalho sem categoria: mantém o que está lá (ver 20260904120000).
  IF v_categoria IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  -- Um anexo_id que não pertence à categoria do trabalho não entra.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_lista) AS e
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categoria_anexos ca
      WHERE ca.id = nullif(e->>'anexo_id', '')::uuid
        AND ca.categoria_id = v_categoria
    )
  ) THEN
    RAISE EXCEPTION 'Anexo enviado não pertence à categoria deste trabalho.';
  END IF;

  -- O pôster não é cumprido na submissão: tem RPC própria, que só abre
  -- depois da divulgação dos resultados. Só recusa quem MANDA arquivo: um
  -- item de pôster vazio não grava nada, e recusá-lo trancaria a submissão
  -- inteira da categoria se uma tela um dia deixasse o campo escapar.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_lista) AS e
    JOIN public.categoria_anexos ca ON ca.id = nullif(e->>'anexo_id', '')::uuid
     WHERE ca.poster
       AND nullif(btrim(e->>'valor'), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'O pôster não vai na submissão: ele é enviado pela lista de trabalhos, depois da divulgação dos resultados.';
  END IF;

  FOR d IN
    SELECT ca.id, ca.tipo, ca.titulo, ca.ordem, ca.obrigatorio
    FROM public.categoria_anexos ca
    WHERE ca.categoria_id = v_categoria
      AND NOT ca.poster
    ORDER BY ca.ordem, ca.criado_em
  LOOP
    SELECT nullif(btrim(e->>'valor'), '') INTO v_enviado
    FROM jsonb_array_elements(v_lista) AS e
    WHERE nullif(e->>'anexo_id', '')::uuid = d.id
    LIMIT 1;

    SELECT ta.valor INTO v_atual
    FROM public.trabalho_anexos ta
    WHERE ta.trabalho_id = _trabalho_id AND ta.anexo_id = d.id;

    v_valor := coalesce(v_enviado, v_atual);

    IF v_valor IS NULL THEN
      IF d.obrigatorio THEN
        RAISE EXCEPTION 'Envie "%": é exigido pela categoria deste trabalho.', d.titulo;
      END IF;

      -- Opcional e vazio: não há linha a gravar (ver 20260911120000).
      CONTINUE;
    END IF;

    IF d.tipo = 'video' THEN
      IF v_valor !~* '^https?://(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/' THEN
        RAISE EXCEPTION 'O link de "%" precisa ser um vídeo do YouTube.', d.titulo;
      END IF;
    ELSE
      -- Só o arquivo NOVO passa pela regra de pasta — a mesma que a
      -- policy de Storage aplica no upload.
      IF v_valor IS DISTINCT FROM v_atual THEN
        IF split_part(v_valor, '/', 1) <> v_uid::text THEN
          RAISE EXCEPTION 'Caminho de PDF inválido em "%".', d.titulo;
        END IF;
        IF v_atual IS NOT NULL THEN
          v_orfaos := v_orfaos || v_atual;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.trabalho_anexos (trabalho_id, anexo_id, tipo, titulo, ordem, valor)
    VALUES (_trabalho_id, d.id, d.tipo, d.titulo, d.ordem, v_valor)
    ON CONFLICT (trabalho_id, anexo_id) DO UPDATE
      SET tipo   = EXCLUDED.tipo,
          titulo = EXCLUDED.titulo,
          ordem  = EXCLUDED.ordem,
          valor  = EXCLUDED.valor;

    v_vistos := v_vistos || d.id;
  END LOOP;

  -- Sobrou o que a categoria não exige mais — menos o pôster, que esta
  -- função nunca escreve e por isso nunca apaga.
  SELECT v_orfaos || coalesce(array_agg(ta.valor), '{}'::text[])
    INTO v_orfaos
  FROM public.trabalho_anexos ta
  WHERE ta.trabalho_id = _trabalho_id
    AND ta.tipo = 'pdf'
    AND NOT ta.poster
    AND (ta.anexo_id IS NULL OR NOT (ta.anexo_id = ANY(v_vistos)));

  DELETE FROM public.trabalho_anexos ta
  WHERE ta.trabalho_id = _trabalho_id
    AND NOT ta.poster
    AND (ta.anexo_id IS NULL OR NOT (ta.anexo_id = ANY(v_vistos)));

  RETURN v_orfaos;
END; $$;
REVOKE ALL ON FUNCTION public.aplicar_anexos(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicar_anexos(uuid, jsonb) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 5. `enviar_posteres` — a única escrita de pôster
-- ------------------------------------------------------------
-- Mesmo corpo das escritas do autor: `_anexos` = [{ anexo_id, valor }],
-- `valor` nulo = mantém o que está gravado, e a função devolve os caminhos
-- que deixaram de ser referenciados (o pôster trocado) para o cliente
-- apagar do Storage — o blob não sai por SQL.
--
-- Não toca em `trabalhos`, então o trigger de prazo não entra: o pôster
-- chega depois do encerramento das submissões por definição.
CREATE OR REPLACE FUNCTION public.enviar_posteres(_trabalho_id uuid, _anexos jsonb)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t        public.trabalhos%ROWTYPE;
  v_uid    uuid := auth.uid();
  v_lista  jsonb := coalesce(_anexos, '[]'::jsonb);
  d        RECORD;
  v_valor  text;
  v_atual  text;
  v_orfaos text[] := '{}'::text[];
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF jsonb_typeof(v_lista) <> 'array' THEN
    RAISE EXCEPTION 'Lista de anexos inválida.';
  END IF;

  -- Trabalho alheio responde igual a trabalho inexistente.
  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND OR t.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;

  IF NOT public.resultados_divulgados() THEN
    RAISE EXCEPTION 'O envio de pôsteres abre na divulgação dos resultados.';
  END IF;

  IF t.status NOT IN ('aprovado', 'aprovado_correcoes') THEN
    RAISE EXCEPTION 'Só trabalhos aprovados enviam pôster.';
  END IF;

  -- Todo item tem de ser exigência de PÔSTER da categoria do trabalho: o
  -- cliente informa a escolha, jamais os atributos dela.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_lista) AS e
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categoria_anexos ca
      WHERE ca.id = nullif(e->>'anexo_id', '')::uuid
        AND ca.categoria_id = t.categoria_id
        AND ca.poster
    )
  ) THEN
    RAISE EXCEPTION 'A categoria deste trabalho não pede esse pôster.';
  END IF;

  FOR d IN
    SELECT ca.id, ca.titulo, ca.ordem
    FROM public.categoria_anexos ca
    WHERE ca.categoria_id = t.categoria_id
      AND ca.poster
    ORDER BY ca.ordem, ca.criado_em
  LOOP
    SELECT nullif(btrim(e->>'valor'), '') INTO v_valor
    FROM jsonb_array_elements(v_lista) AS e
    WHERE nullif(e->>'anexo_id', '')::uuid = d.id
    LIMIT 1;
    CONTINUE WHEN v_valor IS NULL;

    -- A mesma regra de pasta da policy de Storage e de `aplicar_anexos`.
    IF split_part(v_valor, '/', 1) <> v_uid::text THEN
      RAISE EXCEPTION 'Caminho de PDF inválido em "%".', d.titulo;
    END IF;

    SELECT ta.valor INTO v_atual
    FROM public.trabalho_anexos ta
    WHERE ta.trabalho_id = _trabalho_id AND ta.anexo_id = d.id;
    IF v_atual IS NOT NULL AND v_atual <> v_valor THEN
      v_orfaos := v_orfaos || v_atual;
    END IF;

    -- `criado_em` acompanha o arquivo: para o pôster, a data que interessa
    -- à organização é a do arquivo em vigor (foi trocado depois que eu
    -- imprimi?), não a da primeira versão.
    INSERT INTO public.trabalho_anexos (trabalho_id, anexo_id, tipo, titulo, ordem, poster, valor)
    VALUES (_trabalho_id, d.id, 'pdf', d.titulo, d.ordem, true, v_valor)
    ON CONFLICT (trabalho_id, anexo_id) DO UPDATE
      SET tipo      = EXCLUDED.tipo,
          titulo    = EXCLUDED.titulo,
          ordem     = EXCLUDED.ordem,
          poster    = true,
          valor     = EXCLUDED.valor,
          criado_em = now();
  END LOOP;

  RETURN v_orfaos;
END; $$;
REVOKE ALL ON FUNCTION public.enviar_posteres(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_posteres(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_posteres(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 6. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_corpo  text;
  v_sobrou text;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.table_name IN ('categoria_anexos', 'trabalho_anexos')
         AND c.column_name = 'poster'
         AND c.is_nullable = 'NO'
         AND c.column_default IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'poster tem de ser NOT NULL com DEFAULT nas duas tabelas de anexo.';
  END IF;

  -- A submissão não pode voltar a apagar pôster: é a linha que protege o
  -- pôster de quem foi aprovado com correções.
  SELECT p.prosrc INTO v_corpo FROM pg_proc p
   WHERE p.oid = 'public.aplicar_anexos(uuid, jsonb)'::regprocedure;
  IF position('NOT ta.poster' IN v_corpo) = 0 THEN
    RAISE EXCEPTION 'aplicar_anexos voltou a poder apagar pôster na limpeza.';
  END IF;
  IF position('NOT ca.poster' IN v_corpo) = 0 THEN
    RAISE EXCEPTION 'aplicar_anexos voltou a percorrer as exigências de pôster.';
  END IF;
  IF has_function_privilege('authenticated', 'public.aplicar_anexos(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated executa aplicar_anexos direto — ela é interna às RPCs.';
  END IF;

  SELECT p.prosrc INTO v_corpo FROM pg_proc p
   WHERE p.oid = 'public.enviar_posteres(uuid, jsonb)'::regprocedure;
  IF position('resultados_divulgados' IN v_corpo) = 0 THEN
    RAISE EXCEPTION 'enviar_posteres deixou de esperar a divulgação dos resultados.';
  END IF;
  IF position('aprovado_correcoes' IN v_corpo) = 0 THEN
    RAISE EXCEPTION 'enviar_posteres deixou de conferir que o trabalho foi aprovado.';
  END IF;
  IF has_function_privilege('anon', 'public.enviar_posteres(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa enviar_posteres — o REVOKE explícito não pegou.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.enviar_posteres(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE em enviar_posteres: o autor não conseguiria mandar o pôster.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
     WHERE tg.tgname = 'trg_trava_modo_poster'
       AND tg.tgrelid = 'public.categoria_anexos'::regclass
  ) THEN
    RAISE EXCEPTION 'Falta o trigger que trava o modo pôster depois da primeira entrega.';
  END IF;
  IF has_function_privilege('authenticated', 'public.trava_modo_poster()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated executa trava_modo_poster.';
  END IF;

  -- `trabalho_anexos` continua sem escrita por policy: só as RPCs gravam.
  SELECT string_agg(pol.policyname, ', ') INTO v_sobrou
    FROM pg_policies pol
   WHERE pol.schemaname = 'public' AND pol.tablename = 'trabalho_anexos'
     AND pol.cmd <> 'SELECT';
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'trabalho_anexos ganhou policy de escrita: %.', v_sobrou;
  END IF;

  -- E a leitura do revisor não alcança pôster.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies pol
     WHERE pol.schemaname = 'public' AND pol.tablename = 'trabalho_anexos'
       AND pol.policyname = 'trabalho_anexos select'
       AND pol.qual LIKE '%poster%'
  ) THEN
    RAISE EXCEPTION 'A policy de leitura de trabalho_anexos deixou o revisor ver pôster.';
  END IF;

  IF has_table_privilege('anon', 'public.trabalho_anexos', 'SELECT') THEN
    RAISE EXCEPTION 'anon lê trabalho_anexos direto — o REVOKE não pegou.';
  END IF;

  RAISE NOTICE 'OK: pôster fora da submissão, só depois da divulgação, só aprovado, invisível ao revisor.';
END $$;
