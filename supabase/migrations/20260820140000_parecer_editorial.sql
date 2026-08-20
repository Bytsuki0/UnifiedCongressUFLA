-- ============================================================
-- Parecer editorial: a decisão final passa a ser de um co-chair
-- ------------------------------------------------------------
-- A 20260820120000 tirou o automatismo da DISTRIBUIÇÃO. Esta tira o da
-- DECISÃO, que é a outra metade do mesmo problema.
--
-- Até aqui: `trg_pareceres_decisao` disparava a cada parecer gravado e
-- `aplicar_decisao` escrevia em `trabalhos.status` a MODA dos 3 votos. O
-- terceiro revisor clicava em "Enviar parecer" e o trabalho já estava
-- aprovado ou reprovado. A organização não participava, não justificava e
-- não ficava registrada — não havia coluna, RPC nem tela que guardasse
-- uma decisão editorial. O único override era o botão cru de status do
-- Portal Admin, sem autor, sem justificativa e sem data, e que o parecer
-- seguinte sobrescrevia em silêncio.
--
-- Agora:
--   · 3 pareceres ENCERRAM a revisão -> 'aguardando_parecer_editorial'.
--   · Um co-chair lê tudo e registra a decisão, com comentário, em
--     `decisoes_editoriais`.
--   · Às três decisões de hoje soma-se 'resubmeter': o autor reedita o
--     trabalho INTEIRO uma vez e ele volta ao começo — revisores novos,
--     rodada nova, sem aprovação automática (é a diferença para o
--     "aprovado com correções") — e depois disso não edita mais.
--
-- `enviar_correcao` NÃO muda: a correção é ordem do co-chair, e cumpri-la
-- segue encerrando o assunto com 'aprovado'.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `rodada`: a peça que faz o reenvio fechar
-- ------------------------------------------------------------
-- Sem ela o reenvio não funciona, e falha em três lugares diferentes:
--   · os 3 pareceres da rodada 1 continuariam contando na consolidação;
--   · `check_max_revisores` recusaria o 4º revisor (conta TODAS as linhas
--     do trabalho, sem noção de rodada);
--   · o UNIQUE (trabalho_id, revisor_email) impediria reconvocar quem já
--     revisou.
--
-- `trabalhos.rodada` é a rodada CORRENTE; nas outras duas tabelas a
-- coluna carimba a rodada em que a linha nasceu. Reenviar é `rodada + 1`
-- — nada é apagado nem movido, e a rodada anterior continua legível para
-- o co-chair de graça. É este o "arquivar" da feature.
ALTER TABLE public.trabalhos
  ADD COLUMN IF NOT EXISTS rodada       INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reenviado_em TIMESTAMPTZ;

ALTER TABLE public.pareceres
  ADD COLUMN IF NOT EXISTS rodada INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.trabalho_revisores
  ADD COLUMN IF NOT EXISTS rodada INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.trabalhos.rodada IS
  'Rodada corrente de avaliação. Só `reenviar_trabalho` a incrementa.';
COMMENT ON COLUMN public.trabalhos.reenviado_em IS
  'Marca o reenvio pós-"resubmeter". Uma vez gravada, editar_submissao recusa para sempre.';

-- O UNIQUE antigo é o que impede reconvocar um revisor na rodada nova.
ALTER TABLE public.trabalho_revisores
  DROP CONSTRAINT IF EXISTS trabalho_revisores_trabalho_id_revisor_email_key;
ALTER TABLE public.trabalho_revisores
  DROP CONSTRAINT IF EXISTS trabalho_revisores_trabalho_revisor_rodada_key;
ALTER TABLE public.trabalho_revisores
  ADD CONSTRAINT trabalho_revisores_trabalho_revisor_rodada_key
  UNIQUE (trabalho_id, revisor_email, rodada);

ALTER TABLE public.pareceres
  DROP CONSTRAINT IF EXISTS pareceres_trabalho_id_revisor_email_key;
ALTER TABLE public.pareceres
  DROP CONSTRAINT IF EXISTS pareceres_trabalho_revisor_rodada_key;
ALTER TABLE public.pareceres
  ADD CONSTRAINT pareceres_trabalho_revisor_rodada_key
  UNIQUE (trabalho_id, revisor_email, rodada);

CREATE INDEX IF NOT EXISTS idx_pareceres_trabalho_rodada
  ON public.pareceres(trabalho_id, rodada);
CREATE INDEX IF NOT EXISTS idx_trabalho_revisores_trabalho_rodada
  ON public.trabalho_revisores(trabalho_id, rodada);

-- `salvarParecer` faz upsert com onConflict "trabalho_id,revisor_email".
-- Com o UNIQUE trocado, esse nome de conflito deixa de existir e o upsert
-- passa a dar 42P10. O cliente muda junto (revisorService.salvarParecer).

-- Rodada do parecer e da associação NUNCA vêm do cliente: saem do
-- trabalho. Sem isto, um revisor poderia gravar parecer carimbado numa
-- rodada antiga e envenenar a contagem da rodada corrente.
CREATE OR REPLACE FUNCTION public.carimba_rodada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  SELECT t.rodada INTO NEW.rodada
  FROM public.trabalhos t WHERE t.id = NEW.trabalho_id;
  IF NEW.rodada IS NULL THEN
    NEW.rodada := 1;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rodada_pareceres ON public.pareceres;
CREATE TRIGGER trg_rodada_pareceres
  BEFORE INSERT ON public.pareceres
  FOR EACH ROW EXECUTE FUNCTION public.carimba_rodada();

DROP TRIGGER IF EXISTS trg_rodada_revisores ON public.trabalho_revisores;
CREATE TRIGGER trg_rodada_revisores
  BEFORE INSERT ON public.trabalho_revisores
  FOR EACH ROW EXECUTE FUNCTION public.carimba_rodada();

-- Teto de 3 por trabalho, agora por RODADA. Sem isto um trabalho na
-- rodada 2 nasce "3/3" por causa dos revisores da rodada 1 e nunca mais
-- recebe ninguém.
CREATE OR REPLACE FUNCTION public.check_max_revisores()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.trabalho_revisores tr
      WHERE tr.trabalho_id = NEW.trabalho_id
        AND tr.rodada = NEW.rodada) >= 3 THEN
    RAISE EXCEPTION 'Um trabalho pode ter no máximo 3 revisores associados.';
  END IF;
  RETURN NEW;
END; $$;

-- O trigger de rodada tem de rodar ANTES do de teto, senão NEW.rodada
-- ainda é o default 1 na hora de contar. Triggers BEFORE de mesmo evento
-- disparam em ordem alfabética de NOME: trg_max_revisores < trg_rodada_*.
-- Recriar o de teto com nome posterior é o que garante a ordem.
DROP TRIGGER IF EXISTS trg_max_revisores ON public.trabalho_revisores;
DROP TRIGGER IF EXISTS trg_z_max_revisores ON public.trabalho_revisores;
CREATE TRIGGER trg_z_max_revisores
  BEFORE INSERT ON public.trabalho_revisores
  FOR EACH ROW EXECUTE FUNCTION public.check_max_revisores();

-- ------------------------------------------------------------
-- 2. Vocabulário de status
-- ------------------------------------------------------------
-- `trabalhos.status` nasceu TEXT sem CHECK nenhum (20260617120000), então
-- qualquer string sempre foi aceita. Com dois valores novos entrando, a
-- constraint vira barata e evita o erro de digitação que só aparece na
-- tela do autor semanas depois.
--
-- Falhar aqui é melhor do que a constraint estourar num UPDATE futuro:
-- este bloco lista o que já está fora da lista, em vez de deixar o
-- ADD CONSTRAINT morrer com uma mensagem que não diz qual linha.
DO $$
DECLARE v_fora text;
BEGIN
  SELECT string_agg(DISTINCT t.status, ', ') INTO v_fora
  FROM public.trabalhos t
  WHERE t.status NOT IN (
    'pendente', 'em_avaliacao', 'aguardando_parecer_editorial',
    'aprovado', 'aprovado_correcoes', 'reprovado', 'resubmeter'
  );
  IF v_fora IS NOT NULL THEN
    RAISE EXCEPTION 'Status fora do vocabulário em public.trabalhos: %', v_fora;
  END IF;
END $$;

ALTER TABLE public.trabalhos DROP CONSTRAINT IF EXISTS trabalhos_status_valido;
ALTER TABLE public.trabalhos
  ADD CONSTRAINT trabalhos_status_valido CHECK (status IN (
    'pendente', 'em_avaliacao', 'aguardando_parecer_editorial',
    'aprovado', 'aprovado_correcoes', 'reprovado', 'resubmeter'
  ));

-- ------------------------------------------------------------
-- 3. `decisoes_editoriais`
-- ------------------------------------------------------------
-- SEM UNIQUE (trabalho_id, rodada), de propósito: rever a decisão INSERE
-- uma linha nova, e a vigente é a mais recente da rodada corrente. É
-- assim que "cada mudança fica no histórico" sai sem tabela de auditoria
-- à parte — e é o oposto do botão cru do Admin, que não deixava rastro.
CREATE TABLE IF NOT EXISTS public.decisoes_editoriais (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabalho_id   UUID NOT NULL REFERENCES public.trabalhos(id) ON DELETE CASCADE,
  rodada        INTEGER NOT NULL,
  decisao       TEXT NOT NULL CHECK (decisao IN
                  ('aprovado', 'aprovado_correcoes', 'reprovado', 'resubmeter')),
  comentario    TEXT NOT NULL,
  decidido_por  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_nome TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decisoes_editoriais_trabalho
  ON public.decisoes_editoriais(trabalho_id, rodada, created_at DESC);

ALTER TABLE public.decisoes_editoriais ENABLE ROW LEVEL SECURITY;

-- Só a organização lê e escreve. O AUTOR não tem policy aqui de
-- propósito: ele lê pela RPC, que omite quem assinou.
DROP POLICY IF EXISTS "decisoes_editoriais select" ON public.decisoes_editoriais;
CREATE POLICY "decisoes_editoriais select" ON public.decisoes_editoriais
  FOR SELECT TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado());

-- Sem UPDATE e sem DELETE: decisão registrada não se apaga nem se
-- reescreve — revisar é registrar outra.
DROP POLICY IF EXISTS "decisoes_editoriais insert" ON public.decisoes_editoriais;
CREATE POLICY "decisoes_editoriais insert" ON public.decisoes_editoriais
  FOR INSERT TO authenticated
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

REVOKE ALL ON public.decisoes_editoriais FROM anon;
GRANT SELECT, INSERT ON public.decisoes_editoriais TO authenticated;
GRANT ALL ON public.decisoes_editoriais TO service_role;

-- ------------------------------------------------------------
-- 4. A consolidação vira SUGESTÃO
-- ------------------------------------------------------------
-- `decisao_consolidada` continua existindo e continua sendo a moda dos
-- votos — o que muda é o papel: de veredito para sugestão exibida ao
-- co-chair. Passa a contar só a rodada corrente.
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
    WHEN (SELECT coalesce(sum(v.n), 0) FROM votos v) < 3 THEN NULL
    WHEN (SELECT count(*) FROM topo) = 1 THEN (SELECT t.voto FROM topo t)
    -- Empate (1/1/1): o meio-termo é aprovar com correções.
    ELSE 'aprovado_correcoes'
  END;
$$;
REVOKE ALL ON FUNCTION public.decisao_consolidada(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decisao_consolidada(uuid) FROM anon, authenticated;

-- `aplicar_decisao` PARA DE DECIDIR. É o coração desta migration.
--
-- Ela não escreve mais 'aprovado', 'reprovado' nem 'aprovado_correcoes':
-- os 3 pareceres agora só ENCERRAM a revisão, e quem decide é uma pessoa
-- em `registrar_parecer_editorial`. O bloco DO no fim do arquivo falha se
-- algum desses literais voltar ao corpo desta função.
CREATE OR REPLACE FUNCTION public.aplicar_decisao(_trabalho_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pareceres integer;
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

  v_status := CASE
    -- Revisão encerrada: a decisão agora é de uma pessoa.
    WHEN v_pareceres >= 3 THEN 'aguardando_parecer_editorial'
    -- Avaliação em curso: já tem parecer, mas ainda não os 3.
    WHEN v_pareceres > 0  THEN 'em_avaliacao'
    -- Sem nenhum parecer: não mexe no status.
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RETURN NULL;
  END IF;

  -- Decisão editorial já registrada nesta rodada manda mais do que a
  -- contagem de pareceres: sem esta guarda, um revisor que editasse o
  -- próprio parecer depois da decisão puxaria o trabalho de volta para
  -- 'aguardando_parecer_editorial' e desfaria a decisão em silêncio.
  IF EXISTS (
    SELECT 1 FROM public.decisoes_editoriais d
    WHERE d.trabalho_id = _trabalho_id AND d.rodada = v_rodada
  ) THEN
    RETURN v_atual;
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
REVOKE ALL ON FUNCTION public.aplicar_decisao(uuid) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 5. `registrar_parecer_editorial`
-- ------------------------------------------------------------
-- A decisão que substituiu a moda automática. Staff-only.
--
-- Rever é permitido ENQUANTO O AUTOR NÃO AGIU — depois disso a decisão
-- já produziu efeito no mundo (o autor reenviou, ou mandou a correção) e
-- mudá-la deixaria o trabalho num estado que ninguém pediu.
CREATE OR REPLACE FUNCTION public.registrar_parecer_editorial(
  _trabalho_id uuid,
  _decisao     text,
  _comentario  text
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t          public.trabalhos%ROWTYPE;
  v_coment   text := nullif(btrim(coalesce(_comentario, '')), '');
  v_pareceres integer;
  v_nome     text;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF _decisao NOT IN ('aprovado', 'aprovado_correcoes', 'reprovado', 'resubmeter') THEN
    RAISE EXCEPTION 'Decisão inválida: %', _decisao;
  END IF;
  -- Comentário obrigatório: decisão editorial sem justificativa é
  -- exatamente o que o botão cru do Portal Admin já fazia.
  IF v_coment IS NULL THEN
    RAISE EXCEPTION 'O comentário da decisão é obrigatório.';
  END IF;

  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;

  -- O autor já cumpriu a decisão anterior: não se muda mais. Estes dois
  -- testes vêm ANTES da contagem de pareceres de propósito — depois de um
  -- reenvio a rodada nova tem 0 pareceres, e a mensagem sobre "os 3
  -- pareceres" mandaria o co-chair procurar o problema no lugar errado.
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

  IF v_pareceres < 3 THEN
    RAISE EXCEPTION
      'Este trabalho ainda não recebeu os 3 pareceres (tem %).', v_pareceres;
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
-- 6. A decisão como o AUTOR a lê
-- ------------------------------------------------------------
-- Espelho de `pareceres_do_meu_trabalho`: devolve a decisão e o
-- comentário SEM `decidido_por`/`decidido_nome`. O autor lê o que foi
-- decidido, não quem assinou — mesma postura do resto do sistema.
CREATE OR REPLACE FUNCTION public.parecer_editorial_do_meu_trabalho(_trabalho_id uuid)
RETURNS TABLE(rodada integer, decisao text, comentario text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_email_confirmado();
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

  RETURN QUERY
  SELECT d.rodada, d.decisao, d.comentario, d.created_at
  FROM public.decisoes_editoriais d
  JOIN public.trabalhos t ON t.id = d.trabalho_id
  WHERE d.trabalho_id = _trabalho_id
    AND d.rodada = t.rodada
  ORDER BY d.created_at DESC
  LIMIT 1;
END; $$;
REVOKE ALL ON FUNCTION public.parecer_editorial_do_meu_trabalho(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parecer_editorial_do_meu_trabalho(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.parecer_editorial_do_meu_trabalho(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 7. `pareceres_do_meu_trabalho` muda de gatilho
-- ------------------------------------------------------------
-- O gatilho era `decisao_consolidada(...) IS NOT NULL`, ou seja: assim
-- que o 3º parecer entrava. Isso agora seria VAZAMENTO — o autor leria
-- os três vereditos antes de o co-chair decidir, veria "3x aprovado" e
-- poderia receber 'reprovado' depois.
--
-- Novo gatilho: existe decisão editorial para a rodada corrente. As
-- rodadas anteriores saem juntas (a decisão delas já foi dada), com a
-- rodada identificada para o autor saber o que é de quando.
--
-- DROP antes do CREATE porque o retorno GANHOU a coluna `rodada`, e
-- `CREATE OR REPLACE` não muda tipo de retorno (42P13 — foi o erro que
-- abortou a primeira tentativa desta migration). O DROP leva junto os
-- GRANT/REVOKE, por isso eles são refeitos por inteiro logo abaixo —
-- mesma lição da 20260819120000 com `editar_submissao`.
DROP FUNCTION IF EXISTS public.pareceres_do_meu_trabalho(uuid);
CREATE FUNCTION public.pareceres_do_meu_trabalho(_trabalho_id uuid)
RETURNS TABLE(ordem integer, resultado text, comentario_geral text, itens jsonb, rodada integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rodada integer;
BEGIN
  PERFORM public.exigir_email_confirmado();
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

  SELECT t.rodada INTO v_rodada FROM public.trabalhos t WHERE t.id = _trabalho_id;

  -- Sem decisão editorial na rodada corrente, nada da rodada corrente é
  -- revelado. A organização enxerga sempre.
  IF NOT public.is_event_staff() AND NOT EXISTS (
    SELECT 1 FROM public.decisoes_editoriais d
    WHERE d.trabalho_id = _trabalho_id AND d.rodada = v_rodada
  ) THEN
    -- Rodadas anteriores continuam visíveis: já foram decididas.
    RETURN QUERY
    SELECT (row_number() OVER (ORDER BY p.rodada, p.created_at, p.id))::integer,
           p.resultado, p.comentario_geral, p.itens, p.rodada
    FROM public.pareceres p
    WHERE p.trabalho_id = _trabalho_id AND p.rodada < v_rodada;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (row_number() OVER (ORDER BY p.rodada, p.created_at, p.id))::integer,
         p.resultado, p.comentario_geral, p.itens, p.rodada
  FROM public.pareceres p
  WHERE p.trabalho_id = _trabalho_id;
END; $$;
REVOKE ALL ON FUNCTION public.pareceres_do_meu_trabalho(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pareceres_do_meu_trabalho(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pareceres_do_meu_trabalho(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 8. `reenviar_trabalho`: o caminho novo do autor
-- ------------------------------------------------------------
-- Irmã de `enviar_correcao`, com duas diferenças que são o ponto da
-- feature:
--
--   · abre AUTORIA e CATEGORIA, que nenhuma outra escrita do autor abre;
--   · devolve o trabalho a 'pendente' na rodada seguinte, sem aprovar
--     nada — é a diferença para o "aprovado com correções", que aprova
--     no ato do reenvio.
--
-- Abrir autoria e categoria é seguro AQUI e só aqui: a distribuição da
-- rodada nova acontece DEPOIS deste UPDATE, então ela lê os conflitos
-- novos e os critérios novos. Em `editar_submissao` seria o oposto —
-- lá os revisores já foram escolhidos.
--
-- Ignora o prazo pelo mesmo GUC de `enviar_correcao`: a decisão
-- editorial pode sair depois do encerramento, e respeitar o prazo
-- deixaria o autor com uma ordem de reenviar e nenhum jeito de cumprir.
CREATE OR REPLACE FUNCTION public.reenviar_trabalho(
  _trabalho_id      uuid,
  _titulo           text,
  _palavras_chave   text[],
  _video_url        text,
  _tipo_resumo      text,
  _autores          text,
  _orientador_email text,
  _coautores        jsonb,
  _categoria_id     uuid,
  _pdf_url          text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t          public.trabalhos%ROWTYPE;
  v_pdf_novo text := nullif(trim(coalesce(_pdf_url, '')), '');
  v_kw       text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
  v_video    text := nullif(btrim(coalesce(_video_url, '')), '');
  v_coaut    jsonb := CASE
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
  IF v_video IS NULL
     OR v_video !~* '^https?://(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/' THEN
    RAISE EXCEPTION 'Informe um link válido de vídeo do YouTube.';
  END IF;
  IF _tipo_resumo NOT IN ('simples', 'estendido') THEN
    RAISE EXCEPTION 'Tipo de resumo inválido.';
  END IF;
  IF _categoria_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = _categoria_id) THEN
    RAISE EXCEPTION 'Selecione uma categoria válida.';
  END IF;
  IF v_pdf_novo IS NOT NULL AND split_part(v_pdf_novo, '/', 1) <> auth.uid()::text THEN
    RAISE EXCEPTION 'Caminho de PDF inválido.';
  END IF;

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET titulo           = trim(_titulo),
         palavras_chave   = v_kw,
         video_url        = v_video,
         tipo_resumo      = _tipo_resumo,
         autores          = trim(_autores),
         orientador_email = nullif(btrim(coalesce(_orientador_email, '')), ''),
         coautores        = v_coaut,
         categoria_id     = _categoria_id,
         pdf_url          = coalesce(v_pdf_novo, pdf_url),
         -- A rodada nova é o que arquiva a anterior: os pareceres e as
         -- associações antigas ficam onde estão, carimbados com a rodada
         -- de origem, e somem das contagens da rodada corrente.
         rodada           = t.rodada + 1,
         status           = 'pendente',
         reenviado_em     = now()
         -- `data_submissao` NÃO é reescrita: ela é a data do envio
         -- original, e é `reenviado_em` que marca o reenvio. Sobrescrever
         -- apagaria o histórico para ganhar nada.
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  RETURN CASE
    WHEN v_pdf_novo IS NOT NULL AND t.pdf_url IS DISTINCT FROM v_pdf_novo THEN t.pdf_url
    ELSE NULL
  END;
END; $$;
REVOKE ALL ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, text, text, jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, text, text, jsonb, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, text, text, jsonb, uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- 9. `editar_submissao` trava depois do reenvio
-- ------------------------------------------------------------
-- Corpo idêntico ao de 20260819120000, mais uma guarda. Sem ela o
-- reenvio devolve o trabalho a 'pendente' e a edição comum reabriria
-- dentro do prazo — o oposto do combinado ("reenviou, não edita mais").
CREATE OR REPLACE FUNCTION public.editar_submissao(
  _trabalho_id    uuid,
  _titulo         text,
  _palavras_chave text[],
  _video_url      text,
  _tipo_resumo    text,
  _pdf_url        text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t          public.trabalhos%ROWTYPE;
  v_pdf_novo text := nullif(trim(coalesce(_pdf_url, '')), '');
  v_kw       text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
  v_video    text := nullif(btrim(coalesce(_video_url, '')), '');
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
  -- A guarda nova. O reenvio é envio único.
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
  IF v_video IS NULL
     OR v_video !~* '^https?://(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/' THEN
    RAISE EXCEPTION 'Informe um link válido de vídeo do YouTube.';
  END IF;
  IF _tipo_resumo NOT IN ('simples', 'estendido') THEN
    RAISE EXCEPTION 'Tipo de resumo inválido.';
  END IF;
  IF v_pdf_novo IS NOT NULL AND split_part(v_pdf_novo, '/', 1) <> auth.uid()::text THEN
    RAISE EXCEPTION 'Caminho de PDF inválido.';
  END IF;

  UPDATE public.trabalhos
     SET titulo         = trim(_titulo),
         palavras_chave = v_kw,
         video_url      = v_video,
         tipo_resumo    = _tipo_resumo,
         pdf_url        = coalesce(v_pdf_novo, pdf_url)
   WHERE id = _trabalho_id;

  RETURN CASE
    WHEN v_pdf_novo IS NOT NULL AND t.pdf_url IS DISTINCT FROM v_pdf_novo THEN t.pdf_url
    ELSE NULL
  END;
END; $$;
REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 10. A distribuição passa a enxergar rodada
-- ------------------------------------------------------------
-- Sem isto, um trabalho na rodada 2 nasce "3/3" por causa dos revisores
-- da rodada 1 e a recomendação nunca propõe ninguém para ele — e a carga
-- de quem revisou na rodada 1 nunca zera.
CREATE OR REPLACE FUNCTION public.recomendar_distribuicao()
RETURNS TABLE(trabalho_id uuid, revisor_email text, revisor_nome text, tipo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_max_por_trabalho CONSTANT integer := 3;
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
    v_vagas := t.vagas;
    WHILE v_vagas > 0 LOOP
      SELECT pool.email, pool.nome, pool.tipo INTO r
      FROM public._pool_revisores() pool
      CROSS JOIN LATERAL (
        SELECT (
          -- Carga = só as associações da rodada CORRENTE de cada trabalho.
          SELECT count(*) FROM public.trabalho_revisores tr
          JOIN public.trabalhos tt ON tt.id = tr.trabalho_id
          WHERE lower(tr.revisor_email) = pool.email AND tr.rodada = tt.rodada
        ) + (
          SELECT count(*) FROM unnest(v_mail) AS m(mail) WHERE m.mail = pool.email
        ) AS carga
      ) c
      -- Sem filtro de carga: a meta de 4 é a ordenação.
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

CREATE OR REPLACE FUNCTION public.confirmar_distribuicao(_pares jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_criados integer := 0;
  p RECORD;
  v_nome   text;
  v_tipo   text;
  v_titulo text;
  v_rodada integer;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  IF _pares IS NULL OR jsonb_typeof(_pares) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: esperado um array de pares.';
  END IF;

  FOR p IN
    SELECT (e ->> 'trabalho_id')::uuid        AS tid,
           lower(trim(e ->> 'revisor_email')) AS email
    FROM jsonb_array_elements(_pares) AS e
  LOOP
    IF p.tid IS NULL OR coalesce(p.email, '') = '' THEN
      RAISE EXCEPTION 'Par inválido: trabalho e revisor são obrigatórios.';
    END IF;

    SELECT tr.titulo, tr.rodada INTO v_titulo, v_rodada
    FROM public.trabalhos tr WHERE tr.id = p.tid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Trabalho não encontrado: %', p.tid;
    END IF;

    SELECT pool.nome, pool.tipo INTO v_nome, v_tipo
    FROM public._pool_revisores() pool
    WHERE pool.email = p.email;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '% não está no pool de revisores (conceda o papel de professor ou avaliador em Papéis).',
        p.email;
    END IF;

    -- Duplicata dentro da RODADA CORRENTE. Ter revisado numa rodada
    -- anterior não impede: é justamente o que o reenvio precisa permitir.
    IF EXISTS (
      SELECT 1 FROM public.trabalho_revisores tr
      WHERE tr.trabalho_id = p.tid AND tr.rodada = v_rodada
        AND lower(tr.revisor_email) = p.email
    ) THEN
      RAISE EXCEPTION '% já revisa o trabalho "%".', p.email, v_titulo;
    END IF;

    -- Não há teto de trabalhos por revisor, e é deliberado: 4 é meta da
    -- recomendação, não regra.
    --
    -- Teto de 3 por trabalho e conflito de interesse NÃO são repetidos
    -- aqui: `trg_z_max_revisores` e `trg_conflito_revisor` disparam neste
    -- INSERT, dentro desta transação.
    INSERT INTO public.trabalho_revisores (trabalho_id, revisor_email, revisor_nome, tipo)
    VALUES (p.tid, p.email, v_nome, v_tipo);
    v_criados := v_criados + 1;
  END LOOP;

  RETURN v_criados;
END; $$;
REVOKE ALL ON FUNCTION public.confirmar_distribuicao(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_distribuicao(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirmar_distribuicao(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.distribuir_revisores(_trabalho_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_criados          integer := 0;
  v_max_por_trabalho CONSTANT integer := 3;
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
-- 11. Backfill dos trabalhos já decididos automaticamente
-- ------------------------------------------------------------
-- Trabalhos que a moda já decidiu ficam como estão — a decisão foi dada,
-- o autor já a leu, e reabri-los seria pior. O que se registra é a
-- origem: uma linha em `decisoes_editoriais` marcando que aquela decisão
-- veio do sistema antigo, para a tela não mostrar um desfecho sem
-- nenhuma justificativa e para `pareceres_do_meu_trabalho` continuar
-- revelando os pareceres a quem já os via.
INSERT INTO public.decisoes_editoriais
  (trabalho_id, rodada, decisao, comentario, decidido_por, decidido_nome)
SELECT t.id, t.rodada, t.status,
       'Decisão gerada automaticamente pela consolidação dos pareceres, antes da criação do parecer editorial (migration 20260820140000).',
       NULL, NULL
FROM public.trabalhos t
WHERE t.status IN ('aprovado', 'aprovado_correcoes', 'reprovado')
  AND NOT EXISTS (
    SELECT 1 FROM public.decisoes_editoriais d
    WHERE d.trabalho_id = t.id AND d.rodada = t.rodada
  );

-- Trabalhos com os 3 pareceres e sem decisão nenhuma: vão para a fila do
-- co-chair. (Depois do INSERT acima, para não pegar os já decididos.)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT t.id FROM public.trabalhos t
    WHERE t.status IN ('pendente', 'em_avaliacao')
  LOOP
    PERFORM public.aplicar_decisao(r.id);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 12. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_fonte  text;
  v_sobrou text;
BEGIN
  -- A regressão que apagaria a feature inteira: `aplicar_decisao` voltar
  -- a escrever um desfecho.
  SELECT p.prosrc INTO v_fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'aplicar_decisao';

  IF v_fonte ~ '''(aprovado|reprovado|aprovado_correcoes)''' THEN
    RAISE EXCEPTION
      'aplicar_decisao voltou a gravar um desfecho — a decisão automática está de volta.';
  END IF;

  -- `anon` não executa nenhuma das RPCs novas (só o REVOKE de `anon`
  -- desfaz o default privilege do projeto — lição da 20260813150000).
  SELECT string_agg(p.proname, ', ') INTO v_sobrou
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'registrar_parecer_editorial', 'parecer_editorial_do_meu_trabalho',
      'reenviar_trabalho', 'pareceres_do_meu_trabalho'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'anon ainda executa: %', v_sobrou;
  END IF;

  IF has_table_privilege('anon', 'public.decisoes_editoriais', 'SELECT') THEN
    RAISE EXCEPTION 'anon ainda lê public.decisoes_editoriais';
  END IF;
END $$;
