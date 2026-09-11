-- ============================================================
-- Anexo opcional — a categoria passa a distinguir o que EXIGE do que
-- apenas ACEITA
-- ------------------------------------------------------------
-- A 20260904120000 tirou a submissão do molde único (um `pdf_url` e um
-- `video_url` para todo mundo) e a pôs na mão da organização: cada
-- categoria lista em `categoria_anexos` o que pede, uma linha por item.
-- Só que TODA linha de lá é cobrada — `aplicar_anexos` estoura em
-- "Envie ..." para qualquer exigência sem valor. "Estar na lista" e
-- "ser obrigatório" são, hoje, a mesma coisa.
--
-- Não são. A organização quer pedir um vídeo de apresentação a quem
-- tiver um, sem trancar a submissão de quem não tiver, e quer oferecer
-- um segundo PDF (anexos complementares, carta de anuência) que nem todo
-- trabalho tem. Sem esta coluna a única forma de fazer isso é NÃO
-- cadastrar a linha — e aí o autor que TEM o vídeo não tem onde pô-lo.
--
-- Daí o booleano:
--
--   obrigatorio = true   (o padrão, e o que toda linha existente vira)
--                        a submissão não passa sem ele. É exatamente o
--                        que `aplicar_anexos` já fazia.
--
--   obrigatorio = false  o campo aparece no formulário do autor, com o
--                        mesmo título e a mesma descrição, mas vazio
--                        deixa a submissão passar.
--
-- Um booleano na EXIGÊNCIA, e não um "mínimo/máximo" por tipo: a linha
-- já é o item ("quantos PDFs" é COUNT(*), como a 20260904120000
-- anotou), então "opcional" é só "esta linha pode ficar vazia". Um
-- contador precisaria dizer QUAL das duas linhas de PDF é a dispensável,
-- que é a pergunta que o booleano responde de graça.
--
-- ⚠ Opcional é sobre ESTAR AUSENTE, nunca sobre estar errado. Anexo
-- opcional que o autor preencheu passa pela MESMA validação do
-- obrigatório: link tem de ser do YouTube, PDF tem de estar na pasta do
-- dono. Deixar o opcional entrar sem conferência daria ao formulário um
-- caminho para gravar link de qualquer domínio — bastaria a organização
-- marcar a linha como opcional.
--
-- ⚠ O que esta migration NÃO faz: dar ao autor como REMOVER um anexo
-- opcional já entregue. O contrato de `_anexos` continua sendo "valor
-- nulo = mantém o que está gravado" (é ele que impede que editar um
-- título obrigue a reenviar todos os PDFs), e não há como dizer
-- "apague". Opcional aqui quer dizer "pode nunca ser enviado", não
-- "pode ser desfeito". Um "remover anexo" exige um terceiro estado no
-- corpo da RPC — outra migration, quando a organização pedir.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A coluna
-- ------------------------------------------------------------
-- DEFAULT true e NOT NULL: as linhas que já existem viram obrigatórias,
-- que é literalmente o que elas são hoje. A migration é, para os dados,
-- um no-op — nenhuma submissão muda de resultado por causa dela.
ALTER TABLE public.categoria_anexos
  ADD COLUMN IF NOT EXISTS obrigatorio BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.categoria_anexos.obrigatorio IS
  'false = o campo aparece no formulário do autor mas pode ficar vazio. O padrão é true (a submissão não passa sem ele).';

-- ------------------------------------------------------------
-- 2. `aplicar_anexos` — o validador único aprende a dispensar
-- ------------------------------------------------------------
-- Continua sendo a ÚNICA escrita possível em `trabalho_anexos` (a tabela
-- não tem policy de INSERT/UPDATE/DELETE), e por isso continua sendo o
-- único lugar onde a regra vive. A validação do cliente, em
-- `src/lib/anexos.ts`, é cortesia: existe para a pessoa não preencher um
-- formulário que o banco vai recusar.
--
-- Só uma coisa muda no corpo: o `RAISE` de valor ausente passa a ser
-- condicionado a `obrigatorio`. O resto é a função da 20260904120000,
-- palavra por palavra.
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

  -- ⚠ Trabalho sem categoria não tem exigência a conferir, e a saída
  -- ingênua daqui é destrutiva: sem categoria o conjunto-alvo é vazio, e
  -- o laço abaixo apagaria TODOS os anexos já entregues devolvendo os
  -- PDFs como órfãos. Ou seja, um co-chair apagando a categoria faria o
  -- autor perder os arquivos na próxima vez que salvasse o título. Antes
  -- desta tabela isso não existia: `pdf_url` sobrevivia a qualquer edição
  -- que não trocasse o arquivo. Mantém-se o que está lá.
  IF v_categoria IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  -- Um anexo_id que não pertence à categoria do trabalho não entra. É o
  -- mesmo cuidado de `confirmar_distribuicao`: o cliente informa a
  -- escolha, jamais os atributos dela.
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

  FOR d IN
    SELECT ca.id, ca.tipo, ca.titulo, ca.ordem, ca.obrigatorio
    FROM public.categoria_anexos ca
    WHERE ca.categoria_id = v_categoria
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

      -- Opcional e vazio: não há linha a gravar — `trabalho_anexos.valor`
      -- tem CHECK de não-vazio, "não entregou" se escreve com AUSÊNCIA de
      -- linha. Sair sem marcar em `v_vistos` é seguro exatamente aqui, e
      -- só aqui: `v_valor` nulo depois do coalesce significa que `v_atual`
      -- também é nulo, ou seja, não existe linha para a limpeza do fim
      -- alcançar. Se um dia o coalesce mudar, este CONTINUE vira uma
      -- exclusão silenciosa do que o autor já tinha entregue.
      CONTINUE;
    END IF;

    IF d.tipo = 'video' THEN
      -- Conferência grosseira de domínio, idêntica à que estava nas três
      -- RPCs: a extração do id do vídeo é do cliente, aqui só se barra o
      -- link que claramente não é do YouTube. Vale para opcional também:
      -- dispensado é o campo vazio, não o campo errado.
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

  -- Sobrou o que a categoria não exige mais: reenvio que trocou a
  -- categoria, ou exigência que a organização apagou (anexo_id NULL).
  -- Os PDFs entram na lista de órfãos antes de a linha sair.
  SELECT v_orfaos || coalesce(array_agg(ta.valor), '{}'::text[])
    INTO v_orfaos
  FROM public.trabalho_anexos ta
  WHERE ta.trabalho_id = _trabalho_id
    AND ta.tipo = 'pdf'
    AND (ta.anexo_id IS NULL OR NOT (ta.anexo_id = ANY(v_vistos)));

  DELETE FROM public.trabalho_anexos ta
  WHERE ta.trabalho_id = _trabalho_id
    AND (ta.anexo_id IS NULL OR NOT (ta.anexo_id = ANY(v_vistos)));

  RETURN v_orfaos;
END; $$;

-- CREATE OR REPLACE preserva os privilégios, mas repetir o REVOKE é
-- barato e é o que garante que a função continue inalcançável por fora
-- das RPCs mesmo que um dia ela precise de DROP/CREATE.
REVOKE ALL ON FUNCTION public.aplicar_anexos(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicar_anexos(uuid, jsonb) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3. Confere na própria migration
-- ------------------------------------------------------------
-- Os canários abaixo quebram a migration se ela não fizer o que diz. O
-- do DEFAULT é o que importa: uma coluna que nascesse `false` (ou
-- NULLABLE) passaria por "a coluna existe" e silenciosamente DISPENSARIA
-- todo anexo do congresso na primeira submissão — ninguém descobre isso
-- por uma tela, descobre-se por um trabalho submetido sem PDF.
DO $$
DECLARE
  v_default TEXT;
  v_notnull BOOLEAN;
  v_nasce   BOOLEAN;
  v_corpo   TEXT;
BEGIN
  SELECT column_default, is_nullable = 'NO'
    INTO v_default, v_notnull
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'categoria_anexos'
    AND column_name = 'obrigatorio';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'categoria_anexos.obrigatorio não existe';
  END IF;

  IF NOT v_notnull THEN
    RAISE EXCEPTION 'categoria_anexos.obrigatorio aceita NULL — o terceiro estado não existe aqui';
  END IF;

  IF v_default IS NULL THEN
    RAISE EXCEPTION 'categoria_anexos.obrigatorio ficou sem DEFAULT — exigência nova nasceria indefinida';
  END IF;

  -- Avalia a expressão do DEFAULT em vez de comparar o texto dela: o
  -- catálogo pode devolver `true` ou `'t'::boolean` conforme a versão, e
  -- uma comparação de string aprovaria um default errado só por não
  -- reconhecer o formato.
  EXECUTE format('SELECT (%s)::boolean', v_default) INTO v_nasce;
  IF NOT v_nasce THEN
    RAISE EXCEPTION 'categoria_anexos.obrigatorio não nasce true (default: %)', v_default;
  END IF;

  -- NÃO há canário de "nenhuma linha existente virou opcional", e a
  -- ausência é deliberada: NOT NULL + DEFAULT true já garante isso no
  -- próprio ALTER (uma linha que não recebesse o default violaria o NOT
  -- NULL), e a contagem passaria a acusar falsamente numa reaplicação
  -- manual, depois de a organização ter marcado exigências como
  -- opcionais de propósito.

  -- E a função tem de estar LENDO a coluna. Sem isto, a tela do co-chair
  -- gravaria "opcional" e o banco continuaria cobrando.
  SELECT p.prosrc INTO v_corpo
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'aplicar_anexos';

  IF v_corpo IS NULL OR v_corpo NOT LIKE '%d.obrigatorio%' THEN
    RAISE EXCEPTION 'aplicar_anexos não consulta obrigatorio — o opcional continuaria sendo cobrado';
  END IF;

  -- A função segue fora do alcance de quem não é RPC.
  IF has_function_privilege('authenticated', 'public.aplicar_anexos(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated executa aplicar_anexos direto — ela é interna às RPCs';
  END IF;

  -- E a tabela segue fechada para quem não tem sessão.
  IF has_table_privilege('anon', 'public.categoria_anexos', 'SELECT') THEN
    RAISE EXCEPTION 'anon lê categoria_anexos direto — o REVOKE não pegou';
  END IF;
END $$;
