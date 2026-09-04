-- ============================================================
-- Anexos por categoria — o que cada categoria exige da submissão
-- ------------------------------------------------------------
-- Até aqui a submissão era a mesma para todo mundo: `trabalhos` tinha UM
-- `pdf_url` e UM `video_url`, e o formulário do autor tinha uma área de
-- upload e um campo de link. A regra nova quebra isso: BIC Jr. pede um
-- PDF e um vídeo, Extensão pede DOIS PDFs e nenhum vídeo, e a organização
-- precisa poder mudar isso sem migration.
--
-- Duas tabelas, e a divisão entre elas é o ponto:
--
--   categoria_anexos   O QUE a categoria EXIGE. Uma linha por item, com
--                      tipo (pdf|video), título e descrição. "Quantos
--                      PDFs" é COUNT(*) — um contador não carregaria a
--                      descrição que cada item precisa ter de qualquer
--                      jeito ("o que este upload deve conter").
--
--   trabalho_anexos    O QUE o trabalho ENTREGOU. Uma linha por item,
--                      apontando para a exigência que ela cumpre.
--
-- ⚠ `trabalho_anexos` COPIA `tipo`, `titulo` e `ordem` da exigência no
-- momento da escrita, e sua FK é ON DELETE SET NULL. Não é redundância:
-- é o que impede que apagar uma categoria (ou uma exigência) destrua
-- trabalho já submetido. Hoje apagar categoria só faz
-- `trabalhos.categoria_id = NULL` e o `pdf_url` sobrevive; com uma FK em
-- cascata, apagar a categoria apagaria a referência dos arquivos e os
-- blobs ficariam órfãos no Storage para sempre.
--
-- Corolário, e é deliberado: as abas do revisor e do parecer editorial
-- saem de `trabalho_anexos` (o que foi entregue), NUNCA de
-- `categoria_anexos` (o que se exige hoje). Um co-chair acrescentando uma
-- terceira exigência hoje à tarde não pode fazer a submissão de ontem
-- renderizar uma aba vazia.
--
-- A escrita de `trabalho_anexos` não tem policy nenhuma — só as quatro
-- RPCs SECURITY DEFINER escrevem lá. Um autor não consegue inserir uma
-- linha de anexo que tenha pulado a validação nem por chamada direta à
-- API.
--
-- Sai junto: `tipo_resumo`. O radio "resumo simples / estendido" saiu do
-- formulário há tempos e a coluna só sobrevivia porque três RPCs a
-- exigiam. As três estão sendo reescritas aqui de qualquer forma.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `categoria_anexos` — a exigência
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categoria_anexos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,

  -- CHECK e não FK para uma tabela de tipos: os dois valores são
  -- estruturais (cada um tem um campo de formulário e um visualizador
  -- diferentes), não dado que a organização cadastra.
  tipo         TEXT NOT NULL CHECK (tipo IN ('pdf', 'video')),

  -- Rótulo curto — é o que vira nome da aba na tela do revisor. Vazio
  -- daria uma aba anônima, por isso o CHECK.
  titulo       TEXT NOT NULL CHECK (btrim(titulo) <> ''),

  -- A frase de apoio sob o campo no formulário do autor: "o que este
  -- upload deve conter". Opcional — um título bom às vezes basta.
  descricao    TEXT NOT NULL DEFAULT '',

  ordem        INTEGER NOT NULL DEFAULT 1,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.categoria_anexos IS
  'O que cada categoria exige da submissão: uma linha por PDF ou link de vídeo. A quantidade é COUNT(*).';

CREATE INDEX IF NOT EXISTS categoria_anexos_categoria_idx
  ON public.categoria_anexos (categoria_id, ordem, criado_em);

ALTER TABLE public.categoria_anexos ENABLE ROW LEVEL SECURITY;

-- Mesmo desenho de `criterios`: qualquer autenticado LÊ (o formulário de
-- submissão precisa saber o que pedir) e só a organização ESCREVE. O
-- gate de e-mail confirmado vem junto, como em 20260806140000.
DROP POLICY IF EXISTS "categoria_anexos select" ON public.categoria_anexos;
CREATE POLICY "categoria_anexos select" ON public.categoria_anexos FOR SELECT TO authenticated
  USING (public.email_confirmado());

DROP POLICY IF EXISTS "categoria_anexos write" ON public.categoria_anexos;
CREATE POLICY "categoria_anexos write" ON public.categoria_anexos FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categoria_anexos TO authenticated;
GRANT ALL ON public.categoria_anexos TO service_role;
REVOKE ALL ON public.categoria_anexos FROM anon;

-- ------------------------------------------------------------
-- 2. `trabalho_anexos` — a entrega
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trabalho_anexos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabalho_id UUID NOT NULL REFERENCES public.trabalhos(id) ON DELETE CASCADE,

  -- SET NULL, e não CASCADE: ver o cabeçalho. A exigência some, o
  -- arquivo entregue fica.
  anexo_id    UUID REFERENCES public.categoria_anexos(id) ON DELETE SET NULL,

  -- Cópia da exigência no momento da escrita. É o que mantém a aba com
  -- nome depois que `anexo_id` vira NULL.
  tipo        TEXT NOT NULL CHECK (tipo IN ('pdf', 'video')),
  titulo      TEXT NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 1,

  -- Caminho no bucket `Pdfs` (tipo 'pdf') ou URL do YouTube (tipo
  -- 'video'). Linha de anexo sem valor não existe: quem não entregou
  -- não tem linha.
  valor       TEXT NOT NULL CHECK (btrim(valor) <> ''),

  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- NULL é distinto de NULL em UNIQUE no Postgres, então as linhas
  -- órfãs (exigência apagada) não brigam entre si — que é o desejado:
  -- elas são histórico, não alvo de upsert.
  CONSTRAINT trabalho_anexos_trabalho_anexo_key UNIQUE (trabalho_id, anexo_id)
);

COMMENT ON TABLE public.trabalho_anexos IS
  'O que cada trabalho entregou. `tipo`/`titulo`/`ordem` são cópia da exigência: sobrevivem a ela ser apagada.';

CREATE INDEX IF NOT EXISTS trabalho_anexos_trabalho_idx
  ON public.trabalho_anexos (trabalho_id, ordem, criado_em);

ALTER TABLE public.trabalho_anexos ENABLE ROW LEVEL SECURITY;

-- Espelha `trabalhos select` (dono, revisor associado, organização) com
-- o mesmo gate de e-mail confirmado. Quem enxerga o trabalho enxerga o
-- que ele entregou; ninguém mais.
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
          OR EXISTS (
            SELECT 1 FROM public.trabalho_revisores tr
            WHERE tr.trabalho_id = t.id
              AND lower(tr.revisor_email) = lower(auth.email())
          )
        )
    )
  );

-- SEM policy de INSERT/UPDATE/DELETE, e é o ponto: a única escrita
-- possível é pelas RPCs SECURITY DEFINER abaixo, que validam. O GRANT
-- de DELETE existe só para `ON DELETE CASCADE` de `trabalhos` não
-- depender de privilégio de tabela — mas sem policy ele não alcança
-- linha nenhuma.
GRANT SELECT ON public.trabalho_anexos TO authenticated;
GRANT ALL ON public.trabalho_anexos TO service_role;
REVOKE ALL ON public.trabalho_anexos FROM anon;

-- ------------------------------------------------------------
-- 3. Semente: o que toda categoria exigia até hoje
-- ------------------------------------------------------------
-- Um PDF e um vídeo do YouTube, que é literalmente o formulário que
-- existia. A organização edita a partir daí — Extensão vira dois PDFs e
-- nenhum vídeo, e assim por diante.
INSERT INTO public.categoria_anexos (categoria_id, tipo, titulo, descricao, ordem)
SELECT c.id, v.tipo, v.titulo, v.descricao, v.ordem
FROM public.categorias c
CROSS JOIN (VALUES
  ('pdf',   'Trabalho completo',      'O arquivo do trabalho em PDF, até 10 MB.',                  1),
  ('video', 'Vídeo de apresentação',  'Link do vídeo no YouTube. Os avaliadores o assistem dentro do sistema.', 2)
) AS v(tipo, titulo, descricao, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categoria_anexos ca WHERE ca.categoria_id = c.id
);

-- Os trabalhos que já existirem viram linhas de anexo. O site ainda não
-- abriu para submissão, então na prática isto é no-op — está aqui para
-- que a migration não dependa disso ser verdade.
INSERT INTO public.trabalho_anexos (trabalho_id, anexo_id, tipo, titulo, ordem, valor)
SELECT t.id, ca.id, 'pdf', coalesce(ca.titulo, 'Trabalho completo'), coalesce(ca.ordem, 1), t.pdf_url
FROM public.trabalhos t
LEFT JOIN public.categoria_anexos ca
  ON ca.categoria_id = t.categoria_id AND ca.tipo = 'pdf' AND ca.ordem = 1
WHERE nullif(btrim(coalesce(t.pdf_url, '')), '') IS NOT NULL
ON CONFLICT (trabalho_id, anexo_id) DO NOTHING;

INSERT INTO public.trabalho_anexos (trabalho_id, anexo_id, tipo, titulo, ordem, valor)
SELECT t.id, ca.id, 'video', coalesce(ca.titulo, 'Vídeo de apresentação'), coalesce(ca.ordem, 2), t.video_url
FROM public.trabalhos t
LEFT JOIN public.categoria_anexos ca
  ON ca.categoria_id = t.categoria_id AND ca.tipo = 'video' AND ca.ordem = 2
WHERE nullif(btrim(coalesce(t.video_url, '')), '') IS NOT NULL
ON CONFLICT (trabalho_id, anexo_id) DO NOTHING;

-- Confere o backfill ANTES de dropar as colunas — depois não há mais
-- como comparar.
DO $$
DECLARE v_falta INTEGER;
BEGIN
  SELECT count(*) INTO v_falta
  FROM public.trabalhos t
  WHERE nullif(btrim(coalesce(t.pdf_url, '')), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.trabalho_anexos ta
      WHERE ta.trabalho_id = t.id AND ta.tipo = 'pdf'
    );
  IF v_falta > 0 THEN
    RAISE EXCEPTION '% trabalho(s) com pdf_url ficaram sem linha em trabalho_anexos', v_falta;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. `aplicar_anexos` — o validador único
-- ------------------------------------------------------------
-- As quatro escritas do autor (submeter, editar, corrigir, reenviar)
-- passam por aqui. Uma cópia só da regra: quatro cópias divergiriam, e
-- foi por isso que a validação do vídeo já vivia repetida em três RPCs.
--
-- Contrato de `_anexos`: array de {anexo_id, valor}.
--   · `valor` ausente ou null = "mantém o que já está gravado". É o que
--     preserva o comportamento de hoje, em que o PDF só é revalidado
--     quando o autor manda um arquivo novo — linhas legadas guardam URL
--     pública inteira (bucket público, antes de 20260709120000) e
--     revalidá-las trancaria a edição para sempre.
--   · devolve os CAMINHOS DE PDF que deixaram de ser referenciados, para
--     o cliente apagar os blobs. O blob não sai por SQL. É o mesmo
--     contrato do `RETURNS text` de antes, alargado para lista.
--
-- REVOKE de `authenticated`: só as RPCs abaixo a alcançam (dentro de um
-- SECURITY DEFINER o EXECUTE é conferido contra o dono da função). Mesmo
-- desenho de `exigir_email_confirmado`.
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
    SELECT ca.id, ca.tipo, ca.titulo, ca.ordem
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
      RAISE EXCEPTION 'Envie "%": é exigido pela categoria deste trabalho.', d.titulo;
    END IF;

    IF d.tipo = 'video' THEN
      -- Conferência grosseira de domínio, idêntica à que estava nas três
      -- RPCs: a extração do id do vídeo é do cliente, aqui só se barra o
      -- link que claramente não é do YouTube.
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

REVOKE ALL ON FUNCTION public.aplicar_anexos(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicar_anexos(uuid, jsonb) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 5. `submeter_trabalho` — a submissão vira RPC
-- ------------------------------------------------------------
-- Era um `.insert()` do cliente. Com duas tabelas, dois requests
-- significam "criou o trabalho, perdeu os arquivos" — o espelho do que a
-- 20260903120000 anotou sobre o cronograma: lá uma tabela só removeu o
-- que havia para coordenar, aqui a segunda tabela cria.
--
-- NÃO liga `app.decisao_automatica`: o INSERT tem de passar pelo trigger
-- `protect_trabalhos_fields`, que é quem aplica o PRAZO de submissão e
-- quem carimba owner_id/status.
CREATE OR REPLACE FUNCTION public.submeter_trabalho(
  _titulo           text,
  _palavras_chave   text[],
  _categoria_id     uuid,
  _autores          text,
  _orientador_email text,
  _coautores        jsonb,
  _anexos           jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  -- ARRAY(SELECT ...) preserva a ordem em que o autor digitou; um
  -- array_agg(DISTINCT ...) a embaralharia.
  v_kw    text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
  v_coaut jsonb := CASE
    WHEN jsonb_typeof(coalesce(_coautores, '[]'::jsonb)) = 'array'
      THEN coalesce(_coautores, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' THEN
    RAISE EXCEPTION 'O título é obrigatório.';
  END IF;
  IF coalesce(trim(_autores), '') = '' THEN
    RAISE EXCEPTION 'Informe os autores.';
  END IF;
  IF coalesce(array_length(v_kw, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma palavra-chave.';
  END IF;
  IF _categoria_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = _categoria_id) THEN
    RAISE EXCEPTION 'Selecione uma categoria válida.';
  END IF;

  INSERT INTO public.trabalhos (
    titulo, palavras_chave, categoria_id, autores,
    orientador_email, coautores, owner_id, status, data_submissao
  ) VALUES (
    trim(_titulo), v_kw, _categoria_id, trim(_autores),
    nullif(btrim(coalesce(_orientador_email, '')), ''), v_coaut,
    auth.uid(), 'pendente',
    -- `data_local()` e não CURRENT_DATE: o banco roda em UTC e uma
    -- submissão das 22h em Lavras seria carimbada no dia seguinte.
    public.data_local()
  )
  RETURNING id INTO v_id;

  -- Sem órfão a devolver: o trabalho acabou de nascer.
  PERFORM public.aplicar_anexos(v_id, _anexos);

  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.submeter_trabalho(text, text[], uuid, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submeter_trabalho(text, text[], uuid, text, text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.submeter_trabalho(text, text[], uuid, text, text, jsonb, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 6. As três RPCs do autor, sem os campos que saíram
-- ------------------------------------------------------------
-- DROP antes de CREATE, obrigatoriamente: mudar o tipo de retorno
-- (`text` -> `text[]`) não é possível por CREATE OR REPLACE, e deixar a
-- assinatura antiga viva permitiria a um bundle velho gravar ignorando
-- os anexos.
DROP FUNCTION IF EXISTS public.editar_submissao(uuid, text, text[], text, text, text);
DROP FUNCTION IF EXISTS public.enviar_correcao(uuid, text, text[], text, text, text);
DROP FUNCTION IF EXISTS public.reenviar_trabalho(uuid, text, text[], text, text, text, text, jsonb, uuid, text);
-- Assinaturas ainda mais antigas, caso o banco venha de um ponto anterior.
DROP FUNCTION IF EXISTS public.editar_submissao(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.enviar_correcao(uuid, text, text, text);

-- ---- editar_submissao ---------------------------------------
-- Continua SEM `set_config('app.decisao_automatica')`: esta escrita é do
-- autor, não do banco, e tem de seguir passando pelo trigger de
-- proteção — inclusive pelo teste de prazo.
CREATE FUNCTION public.editar_submissao(
  _trabalho_id    uuid,
  _titulo         text,
  _palavras_chave text[],
  _anexos         jsonb DEFAULT '[]'::jsonb
)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t    public.trabalhos%ROWTYPE;
  v_kw text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;
  IF t.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o autor pode editar o trabalho.';
  END IF;
  IF t.status <> 'pendente' THEN
    RAISE EXCEPTION 'Este trabalho já entrou em avaliação e não pode mais ser editado.';
  END IF;
  -- O reenvio é envio único (20260820140000).
  IF t.reenviado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este trabalho já foi reenviado e não pode mais ser editado.';
  END IF;
  IF NOT public.submissoes_abertas() THEN
    RAISE EXCEPTION 'O prazo de submissão está encerrado — o trabalho não pode mais ser editado.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' THEN
    RAISE EXCEPTION 'O título é obrigatório.';
  END IF;
  IF coalesce(array_length(v_kw, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma palavra-chave.';
  END IF;

  UPDATE public.trabalhos
     SET titulo         = trim(_titulo),
         palavras_chave = v_kw
   WHERE id = _trabalho_id;

  RETURN public.aplicar_anexos(_trabalho_id, _anexos);
END; $$;

REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text[], jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_submissao(uuid, text, text[], jsonb) TO authenticated;

-- ---- enviar_correcao ----------------------------------------
-- Irmã da anterior com o gatilho trocado: exige 'aprovado_correcoes' e
-- IGNORA o prazo (o GUC `app.decisao_automatica` faz o trigger devolver
-- cedo). É a exceção do "aprovado com correções", que segue corrigível
-- depois do encerramento. Segue aprovando no ato do reenvio da correção
-- — é a diferença deliberada para `resubmeter`.
CREATE FUNCTION public.enviar_correcao(
  _trabalho_id    uuid,
  _titulo         text,
  _palavras_chave text[],
  _anexos         jsonb DEFAULT '[]'::jsonb
)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t         public.trabalhos%ROWTYPE;
  v_kw      text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
  v_orfaos  text[];
BEGIN
  PERFORM public.exigir_email_confirmado();
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
  IF coalesce(trim(_titulo), '') = '' THEN
    RAISE EXCEPTION 'O título é obrigatório.';
  END IF;
  IF coalesce(array_length(v_kw, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma palavra-chave.';
  END IF;

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET titulo                = trim(_titulo),
         palavras_chave        = v_kw,
         status                = 'aprovado',
         correcoes_enviadas_em = now()
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  v_orfaos := public.aplicar_anexos(_trabalho_id, _anexos);
  RETURN v_orfaos;
END; $$;

REVOKE ALL ON FUNCTION public.enviar_correcao(uuid, text, text[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_correcao(uuid, text, text[], jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_correcao(uuid, text, text[], jsonb) TO authenticated;

-- ---- reenviar_trabalho --------------------------------------
-- A ÚNICA escrita do autor que abre autoria e categoria. É segura só
-- aqui: a distribuição da rodada nova acontece depois, sobre os
-- conflitos novos. Ignora o prazo (mesmo GUC) porque a decisão editorial
-- pode sair depois do encerramento.
--
-- ⚠ `aplicar_anexos` roda DEPOIS do UPDATE de propósito: a categoria
-- pode ter mudado, e é a categoria NOVA que diz o que é exigido. Os
-- anexos da categoria antiga saem e seus PDFs voltam como órfãos.
CREATE FUNCTION public.reenviar_trabalho(
  _trabalho_id      uuid,
  _titulo           text,
  _palavras_chave   text[],
  _autores          text,
  _orientador_email text,
  _coautores        jsonb,
  _categoria_id     uuid,
  _anexos           jsonb DEFAULT '[]'::jsonb
)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t       public.trabalhos%ROWTYPE;
  v_kw    text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
  v_coaut jsonb := CASE
    WHEN jsonb_typeof(coalesce(_coautores, '[]'::jsonb)) = 'array'
      THEN coalesce(_coautores, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;
  IF t.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o autor pode reenviar o trabalho.';
  END IF;
  IF t.status <> 'resubmeter' THEN
    RAISE EXCEPTION 'Este trabalho não está aguardando reenvio.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' THEN
    RAISE EXCEPTION 'O título é obrigatório.';
  END IF;
  IF coalesce(trim(_autores), '') = '' THEN
    RAISE EXCEPTION 'Informe os autores.';
  END IF;
  IF coalesce(array_length(v_kw, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma palavra-chave.';
  END IF;
  IF _categoria_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = _categoria_id) THEN
    RAISE EXCEPTION 'Selecione uma categoria válida.';
  END IF;

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET titulo           = trim(_titulo),
         palavras_chave   = v_kw,
         autores          = trim(_autores),
         orientador_email = nullif(btrim(coalesce(_orientador_email, '')), ''),
         coautores        = v_coaut,
         categoria_id     = _categoria_id,
         -- A rodada nova é o que arquiva a anterior: os pareceres e as
         -- associações antigas ficam onde estão, carimbados com a rodada
         -- de origem, e somem das contagens da rodada corrente.
         rodada           = t.rodada + 1,
         status           = 'pendente',
         reenviado_em     = now()
         -- `data_submissao` NÃO é reescrita: ela é a data do envio
         -- original, e é `reenviado_em` que marca o reenvio.
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  RETURN public.aplicar_anexos(_trabalho_id, _anexos);
END; $$;

REVOKE ALL ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, jsonb, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, jsonb, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, jsonb, uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 7. As colunas saem
-- ------------------------------------------------------------
-- Duas fontes para a mesma informação é o defeito que esta migration
-- fecha — o mesmo argumento da 20260830120000 ao dropar as `link_*`.
-- Com `pdf_url` de pé, uma tela poderia continuar lendo a coluna
-- enquanto o autor edita a lista de anexos, e as duas discordariam em
-- silêncio.
ALTER TABLE public.trabalhos
  DROP CONSTRAINT IF EXISTS trabalhos_tipo_resumo_valido;

ALTER TABLE public.trabalhos
  DROP COLUMN IF EXISTS pdf_url,
  DROP COLUMN IF EXISTS video_url,
  DROP COLUMN IF EXISTS tipo_resumo;

-- ------------------------------------------------------------
-- 8. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT count(*) INTO v_n
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'trabalhos'
    AND column_name IN ('pdf_url', 'video_url', 'tipo_resumo');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'sobrou coluna de anexo em public.trabalhos (% coluna(s))', v_n;
  END IF;

  IF has_table_privilege('anon', 'public.categoria_anexos', 'SELECT')
  OR has_table_privilege('anon', 'public.trabalho_anexos', 'SELECT') THEN
    RAISE EXCEPTION 'anon lê as tabelas de anexo — o REVOKE não pegou';
  END IF;

  -- A escrita de `trabalho_anexos` é exclusiva das RPCs. Uma policy de
  -- INSERT/UPDATE/DELETE aqui devolveria ao autor o poder de gravar
  -- anexo sem passar pela validação.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trabalho_anexos'
      AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'trabalho_anexos ganhou policy de escrita — só as RPCs podem gravar lá';
  END IF;

  IF has_function_privilege('authenticated', 'public.aplicar_anexos(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated executa aplicar_anexos direto — ela é interna às RPCs';
  END IF;

  -- As assinaturas antigas não podem sobreviver: um bundle velho
  -- gravaria por elas e os anexos ficariam para trás.
  SELECT count(*) INTO v_n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('editar_submissao', 'enviar_correcao', 'reenviar_trabalho');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'esperava 1 versão de cada RPC do autor, encontrei % no total', v_n;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.submeter_trabalho(text, text[], uuid, text, text, jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated não executa submeter_trabalho';
  END IF;
END $$;
