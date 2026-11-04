-- ============================================================
-- Cronograma de apresentações (CA) — dia, horário, sala e formato
-- ------------------------------------------------------------
-- Pedido de 2026-11-04. O "Cronograma" de antes vira "Cronograma do
-- Evento" (só rótulo, nada aqui) e nasce o Cronograma de Apresentações:
-- quando e onde cada trabalho aprovado se apresenta. A organização o monta
-- em /co-chairs/admin-ca (aba "Editar Cronograma de Apresentação"); o
-- visitante o lê na landing e em /apresentacoes, e o autor em
-- /estudante/apresentacoes, com o próprio trabalho num quadro de destaque.
--
--   categorias.tipo_apresentacao  O FORMATO, por categoria, em texto livre
--                                 ("Pôster", "Apresentação oral"). Todo
--                                 trabalho da categoria herda o tipo — por
--                                 junção, nunca por cópia: mudar o tipo da
--                                 categoria muda o de todos os trabalhos dela.
--   apresentacoes                 Dia, início, fim e sala de um trabalho. Uma
--                                 linha por trabalho agendado; sem linha =
--                                 fora do cronograma.
--   envios_apresentacoes          O registro dos e-mails, irmão de
--                                 `envios_resultados`.
--
-- As regras, decididas com o usuário em 2026-11-04:
--
--   · Só trabalhos APROVADOS entram — 'aprovado' e 'aprovado_correcoes',
--     a régua da avaliação ao vivo (20261103120000): é o que se apresenta.
--   · Ao clicar SALVAR no AdminCA, o DONO (quem submeteu; coautor não
--     recebe) de todo trabalho com informação NOVA recebe um e-mail:
--     agendado pela primeira vez, ou com dia, início, fim, sala ou o tipo
--     da categoria alterado. Salvar sem mudar nada não manda nada. Tirar o
--     trabalho do cronograma não manda e-mail.
--   · Um e-mail por autor por lote, com todos os trabalhos dele que mudaram.
--
-- ⚠ MUDANÇA DE VISIBILIDADE: `apresentacoes_publicas()` publica TÍTULO e
-- AUTORES de trabalho aprovado — inclusive 'aprovado_correcoes', que a
-- vitrine de pitches (20260907120000) ainda segura — para QUALQUER UM, sem
-- sessão. Só de trabalho agendado, e nada de e-mail, dono, orientador,
-- coautores ou resumo. É a mesma fresta estreita de `pitches_publicos()`.
--
-- O e-mail sai pela fila da conta congressoparaiso@ufla.br (20261014120000,
-- 20261026120000, 20261027120000): a Edge Function `emails-revisores` pede
-- também a `apresentacoes_devidas()` o que sobrar do lote, o Apps Script —
-- que não muda — envia, e `concluir_envios` fecha a terceira tabela.
--
-- A regra mora AQUI; a Edge Function só monta o texto; o Apps Script só envia.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. O tipo de apresentação, por categoria
-- ------------------------------------------------------------
-- NOT NULL DEFAULT '': toda categoria que existe nasce "sem tipo", e as
-- escritas diretas de /co-chairs/categorias (que não conhecem a coluna)
-- continuam valendo. Quem grava o tipo é só `salvar_cronograma_apresentacoes`:
-- mudar o tipo é informação nova para os trabalhos agendados, e é a RPC que
-- sabe marcá-los para o e-mail.
ALTER TABLE public.categorias
  ADD COLUMN IF NOT EXISTS tipo_apresentacao TEXT NOT NULL DEFAULT '';

ALTER TABLE public.categorias
  DROP CONSTRAINT IF EXISTS categorias_tipo_apresentacao_check;
ALTER TABLE public.categorias
  ADD CONSTRAINT categorias_tipo_apresentacao_check
  CHECK (char_length(tipo_apresentacao) <= 80);

COMMENT ON COLUMN public.categorias.tipo_apresentacao IS
  'Formato de apresentação dos trabalhos da categoria (texto livre). Vazio = ainda não definido.';

-- ------------------------------------------------------------
-- 2. `apresentacoes` — quando e onde cada trabalho se apresenta
-- ------------------------------------------------------------
-- Dia e horas SEM fuso: são a hora de Lavras como a organização digitou,
-- e ninguém converte nada — o mesmo "texto da data" do cronograma do evento.
--
-- O `id` próprio é o que a RPC pública devolve: o id do TRABALHO não sai
-- para quem não tem sessão.
--
-- O estado do e-mail são duas marcas, como `trabalho_revisores` (20261014120000):
--   aviso_solicitado_em  o Salvar viu informação nova e pôs o trabalho na fila;
--   aviso_reservado_em   a fila o pegou (o envio está em `envios_apresentacoes`).
-- Na fila = solicitado e não reservado. Salvar de novo zera a reserva: se um
-- e-mail com a informação antiga ainda está saindo, este sai depois dele.
CREATE TABLE IF NOT EXISTS public.apresentacoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabalho_id         UUID NOT NULL UNIQUE REFERENCES public.trabalhos(id) ON DELETE CASCADE,
  data                DATE NOT NULL,
  hora_inicio         TIME NOT NULL,
  hora_fim            TIME NOT NULL,
  sala                TEXT NOT NULL,
  aviso_solicitado_em TIMESTAMPTZ,
  aviso_reservado_em  TIMESTAMPTZ,
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Sem FK: purgar a conta de quem editou não apaga o agendamento.
  atualizado_por      UUID DEFAULT auth.uid(),
  -- As travas que valem: a validação da tela é cortesia.
  CONSTRAINT apresentacoes_horario_check CHECK (hora_fim > hora_inicio),
  CONSTRAINT apresentacoes_sala_check CHECK (btrim(sala) <> '' AND char_length(sala) <= 120)
);

CREATE INDEX IF NOT EXISTS apresentacoes_horario_idx
  ON public.apresentacoes (data, hora_inicio);

COMMENT ON TABLE public.apresentacoes IS
  'Cronograma de apresentações: dia, início, fim e sala de cada trabalho aprovado. Só salvar_cronograma_apresentacoes() grava.';

-- Leitura: a organização, no AdminCA. O autor e o visitante leem pela RPC
-- pública, que já diz ao autor quais são os dele. Escrita: policy nenhuma —
-- só a RPC grava, como em `avaliacoes_evento`.
ALTER TABLE public.apresentacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "apresentacoes select" ON public.apresentacoes;
CREATE POLICY "apresentacoes select" ON public.apresentacoes FOR SELECT TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado());

-- O REVOKE explícito é porque o ALTER DEFAULT PRIVILEGES do projeto concede
-- tudo a anon e a authenticated no CREATE.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.apresentacoes FROM authenticated;
GRANT SELECT ON public.apresentacoes TO authenticated;
GRANT ALL ON public.apresentacoes TO service_role;
REVOKE ALL ON public.apresentacoes FROM anon;

-- ------------------------------------------------------------
-- 3. O registro dos e-mails — um por linha
-- ------------------------------------------------------------
-- Irmã de `envios_resultados`: nasce 'reservado' na busca e o Apps Script a
-- fecha como 'enviado' ou 'falha', com a frase do Google. SEM o índice de
-- "um por autor" de lá: aqui o mesmo autor recebe um e-mail a cada vez que
-- o trabalho dele muda.
CREATE TABLE IF NOT EXISTS public.envios_apresentacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sem FK: purgar a conta não apaga o histórico do envio.
  autor_id      UUID NOT NULL,
  autor_email   TEXT NOT NULL,
  autor_nome    TEXT,
  -- Os TRABALHOS do e-mail (sem FK, é array). É o id do trabalho, e não o
  -- da apresentação, porque ele sobrevive a tirar e repor no cronograma:
  -- é com ele que a fila sabe se o autor já recebeu aquele trabalho antes.
  trabalhos_ids UUID[] NOT NULL,
  -- Cópia: o que o e-mail DISSE, mesmo que o cronograma mude depois.
  -- [{ titulo, categoria, tipo, data, hora_inicio, hora_fim, sala, alteracao }]
  trabalhos     JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'reservado'
                CHECK (status IN ('reservado', 'enviado', 'falha')),
  erro          TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS envios_apresentacoes_criado_em_idx
  ON public.envios_apresentacoes (criado_em DESC);
CREATE INDEX IF NOT EXISTS envios_apresentacoes_trabalhos_idx
  ON public.envios_apresentacoes USING gin (trabalhos_ids);

-- Leitura: a organização, no AdminCA (a policy acompanha onde a tela mora).
-- Escrita: policy nenhuma — só `apresentacoes_devidas` e `concluir_envios`
-- (SECURITY DEFINER) gravam aqui.
ALTER TABLE public.envios_apresentacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "envios_apresentacoes select" ON public.envios_apresentacoes;
CREATE POLICY "envios_apresentacoes select" ON public.envios_apresentacoes
  FOR SELECT TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.envios_apresentacoes FROM authenticated;
GRANT SELECT ON public.envios_apresentacoes TO authenticated;
GRANT ALL ON public.envios_apresentacoes TO service_role;
REVOKE ALL ON public.envios_apresentacoes FROM anon;

-- ------------------------------------------------------------
-- 4. O botão SALVAR do AdminCA — a única escrita
-- ------------------------------------------------------------
-- Uma chamada para a tela inteira, numa transação só: uma linha recusada
-- aborta o lote, com a frase dizendo QUAL trabalho — a tela mantém as
-- edições e a pessoa conserta só aquela.
--
--   _tipos          [{ categoria_id, tipo }]   — só as categorias que mudaram
--   _apresentacoes  [{ trabalho_id, data, hora_inicio, hora_fim, sala }]
--                   ou [{ trabalho_id, remover: true }]
--
-- "Informação nova", a régua do e-mail: trabalho agendado pela primeira vez,
-- dia/início/fim/sala diferente do gravado, ou o tipo da categoria mudou
-- (aí todos os agendados dela). Item igual ao gravado não marca nada — é o
-- "salvar sem mudar não manda e-mail". Remover não marca nada.
--
-- Devolve quantos trabalhos ficaram com informação nova (os e-mails a sair).
CREATE OR REPLACE FUNCTION public.salvar_cronograma_apresentacoes(
  _tipos jsonb DEFAULT '[]'::jsonb,
  _apresentacoes jsonb DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_tipos    jsonb := coalesce(_tipos, '[]'::jsonb);
  v_itens    jsonb := coalesce(_apresentacoes, '[]'::jsonb);
  v_marcados uuid[] := '{}'::uuid[];
  e          jsonb;
  v_cat      uuid;
  v_tipo     text;
  t          public.trabalhos%ROWTYPE;
  v_atual    public.apresentacoes%ROWTYPE;
  v_data     date;
  v_inicio   time;
  v_fim      time;
  v_sala     text;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  IF jsonb_typeof(v_tipos) <> 'array' OR jsonb_typeof(v_itens) <> 'array' THEN
    RAISE EXCEPTION 'Dados do cronograma de apresentações inválidos.';
  END IF;

  -- a) Os tipos. Primeiro, para a marcação dos agendados da categoria já
  --    valer para o e-mail dos itens que vêm logo abaixo.
  FOR e IN SELECT * FROM jsonb_array_elements(v_tipos) LOOP
    v_cat  := nullif(e->>'categoria_id', '')::uuid;
    v_tipo := btrim(coalesce(e->>'tipo', ''));
    IF char_length(v_tipo) > 80 THEN
      RAISE EXCEPTION 'O tipo de apresentação passa de 80 caracteres: "%".', v_tipo;
    END IF;

    UPDATE public.categorias c
       SET tipo_apresentacao = v_tipo
     WHERE c.id = v_cat
       AND c.tipo_apresentacao IS DISTINCT FROM v_tipo;

    IF FOUND THEN
      -- O tipo é informação de cada trabalho: quem já está no cronograma
      -- recebe a mudança.
      SELECT v_marcados || coalesce(array_agg(a.trabalho_id), '{}'::uuid[])
        INTO v_marcados
        FROM public.apresentacoes a
        JOIN public.trabalhos tr ON tr.id = a.trabalho_id
       WHERE tr.categoria_id = v_cat
         AND tr.status IN ('aprovado', 'aprovado_correcoes');
    ELSIF NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = v_cat) THEN
      RAISE EXCEPTION 'Categoria não encontrada.';
    END IF;
  END LOOP;

  -- b) Os trabalhos.
  FOR e IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    SELECT * INTO t FROM public.trabalhos tr WHERE tr.id = nullif(e->>'trabalho_id', '')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Trabalho não encontrado.';
    END IF;

    -- Tirar do cronograma vale para qualquer status: é como se limpa um
    -- agendamento de trabalho cuja decisão foi revista.
    IF coalesce((e->>'remover')::boolean, false) THEN
      DELETE FROM public.apresentacoes a WHERE a.trabalho_id = t.id;
      v_marcados := array_remove(v_marcados, t.id);
      CONTINUE;
    END IF;

    IF t.status NOT IN ('aprovado', 'aprovado_correcoes') THEN
      RAISE EXCEPTION '"%" não está aprovado: só trabalhos aprovados entram no cronograma de apresentações.', t.titulo;
    END IF;

    BEGIN
      v_data   := nullif(e->>'data', '')::date;
      v_inicio := nullif(e->>'hora_inicio', '')::time;
      v_fim    := nullif(e->>'hora_fim', '')::time;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Dia ou horário inválido em "%".', t.titulo;
    END;
    v_sala := btrim(coalesce(e->>'sala', ''));

    IF v_data IS NULL OR v_inicio IS NULL OR v_fim IS NULL OR v_sala = '' THEN
      RAISE EXCEPTION 'Preencha dia, início, fim e sala de "%".', t.titulo;
    END IF;
    IF v_fim <= v_inicio THEN
      RAISE EXCEPTION 'O fim da apresentação de "%" precisa ser depois do início.', t.titulo;
    END IF;
    IF char_length(v_sala) > 120 THEN
      RAISE EXCEPTION 'A sala de "%" passa de 120 caracteres.', t.titulo;
    END IF;

    SELECT * INTO v_atual FROM public.apresentacoes a WHERE a.trabalho_id = t.id;
    IF NOT FOUND THEN
      INSERT INTO public.apresentacoes (trabalho_id, data, hora_inicio, hora_fim, sala, atualizado_por)
      VALUES (t.id, v_data, v_inicio, v_fim, v_sala, v_uid);
      v_marcados := v_marcados || t.id;
    ELSIF (v_atual.data, v_atual.hora_inicio, v_atual.hora_fim, v_atual.sala)
          IS DISTINCT FROM (v_data, v_inicio, v_fim, v_sala) THEN
      UPDATE public.apresentacoes a
         SET data = v_data, hora_inicio = v_inicio, hora_fim = v_fim, sala = v_sala,
             atualizado_em = now(), atualizado_por = v_uid
       WHERE a.id = v_atual.id;
      v_marcados := v_marcados || t.id;
    END IF;
  END LOOP;

  -- c) A fila. Quem já estava nela continua, com a informação de agora.
  UPDATE public.apresentacoes a
     SET aviso_solicitado_em = now(),
         aviso_reservado_em  = NULL
   WHERE a.trabalho_id = ANY (v_marcados);

  RETURN (SELECT count(DISTINCT m) FROM unnest(v_marcados) AS m);
END; $$;
-- `FROM PUBLIC` não tira o grant DIRETO do ALTER DEFAULT PRIVILEGES.
REVOKE ALL ON FUNCTION public.salvar_cronograma_apresentacoes(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salvar_cronograma_apresentacoes(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.salvar_cronograma_apresentacoes(jsonb, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 5. A janela pública — landing, /apresentacoes e o portal do autor
-- ------------------------------------------------------------
-- Uma RPC para as três telas. `meu` é o que o autor logado vê destacado:
-- vem de `auth.uid()`, que sem sessão é NULL — para o visitante é sempre
-- false. Não diz de quem é nenhum outro trabalho.
--
-- ⚠ É a única fresta pública para dentro de `trabalhos` e `apresentacoes`,
-- SECURITY DEFINER: o RLS não socorre ninguém aqui. Só trabalho aprovado e
-- agendado; só título, autores e categoria — e-mail, dono, orientador,
-- coautores, resumo e parecer, nunca.
CREATE OR REPLACE FUNCTION public.apresentacoes_publicas()
RETURNS TABLE(
  id           uuid,
  titulo       text,
  autores      text,
  categoria_id uuid,
  categoria    text,
  tipo         text,
  data         date,
  hora_inicio  time,
  hora_fim     time,
  sala         text,
  meu          boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, t.titulo, t.autores, t.categoria_id,
         coalesce(c.nome, ''), coalesce(c.tipo_apresentacao, ''),
         a.data, a.hora_inicio, a.hora_fim, a.sala,
         coalesce(t.owner_id = auth.uid(), false)
    FROM public.apresentacoes a
    JOIN public.trabalhos t       ON t.id = a.trabalho_id
    LEFT JOIN public.categorias c ON c.id = t.categoria_id
   WHERE t.status IN ('aprovado', 'aprovado_correcoes')
   ORDER BY a.data, a.hora_inicio, a.sala, t.titulo, a.id;
$$;
REVOKE ALL ON FUNCTION public.apresentacoes_publicas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apresentacoes_publicas() TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. A fila das apresentações
-- ------------------------------------------------------------
-- Um autor está DEVIDO quando tem trabalho:
--   · na fila (solicitado e não reservado);
--   · ainda aprovado — decisão revista depois do agendamento não avisa;
--   · com dono que tem e-mail (trabalho cadastrado pela organização não
--     tem a quem avisar);
--   · que falhou menos de 3 vezes desde o Salvar que o marcou: endereço que
--     o Google recusa para de ser tentado, em vez de falhar a cada minuto.
--     Salvar de novo recomeça a contagem.
--
-- Um e-mail por autor por lote, com todos os trabalhos dele na fila. A
-- reserva é no WHERE do próprio UPDATE, como em `emails_devidos`: o que uma
-- busca reservou a seguinte não pega. Mais antigo primeiro.
--
-- `alteracao` diz, por trabalho, se o autor já recebeu um e-mail dele antes:
-- é o que faz o texto dizer "alterado" em vez de "agendado".
CREATE OR REPLACE FUNCTION public.apresentacoes_devidas(_limite integer DEFAULT 20)
RETURNS TABLE(
  envio_id    uuid,
  autor_email text,
  autor_nome  text,
  trabalhos   jsonb
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
-- Os nomes do RETURNS TABLE também são variáveis aqui dentro e colidem com
-- colunas de envios_apresentacoes: toda coluna abaixo vai qualificada.
DECLARE
  v_limite integer := least(greatest(coalesce(_limite, 20), 1), 50);
  v_donos  uuid[];
  v_ids    uuid[];
BEGIN
  SELECT array_agg(s.owner_id) INTO v_donos FROM (
    SELECT tr.owner_id
      FROM public.apresentacoes a
      JOIN public.trabalhos tr ON tr.id = a.trabalho_id
      JOIN auth.users u        ON u.id = tr.owner_id
     WHERE a.aviso_solicitado_em IS NOT NULL
       AND a.aviso_reservado_em IS NULL
       AND tr.status IN ('aprovado', 'aprovado_correcoes')
       AND u.email IS NOT NULL
       AND (SELECT count(*) FROM public.envios_apresentacoes ea
             WHERE tr.id = ANY (ea.trabalhos_ids)
               AND ea.status = 'falha'
               AND ea.criado_em >= a.aviso_solicitado_em) < 3
     GROUP BY tr.owner_id
     ORDER BY min(a.aviso_solicitado_em), tr.owner_id
     LIMIT v_limite
  ) s;

  IF v_donos IS NULL THEN
    RETURN;
  END IF;

  WITH m AS (
    UPDATE public.apresentacoes a
       SET aviso_reservado_em = now()
      FROM public.trabalhos tr
     WHERE tr.id = a.trabalho_id
       AND tr.owner_id = ANY (v_donos)
       AND a.aviso_solicitado_em IS NOT NULL
       AND a.aviso_reservado_em IS NULL
       AND tr.status IN ('aprovado', 'aprovado_correcoes')
       AND (SELECT count(*) FROM public.envios_apresentacoes ea
             WHERE tr.id = ANY (ea.trabalhos_ids)
               AND ea.status = 'falha'
               AND ea.criado_em >= a.aviso_solicitado_em) < 3
    RETURNING a.trabalho_id, tr.owner_id, tr.titulo, tr.categoria_id,
              a.data, a.hora_inicio, a.hora_fim, a.sala
  ), novos AS (
    INSERT INTO public.envios_apresentacoes AS ea
           (autor_id, autor_email, autor_nome, trabalhos_ids, trabalhos)
    SELECT m.owner_id,
           lower(u.email),
           nullif(btrim(pf.nome), ''),
           array_agg(m.trabalho_id ORDER BY m.data, m.hora_inicio, m.titulo),
           jsonb_agg(jsonb_build_object(
                       'titulo',      m.titulo,
                       'categoria',   coalesce(c.nome, ''),
                       'tipo',        coalesce(c.tipo_apresentacao, ''),
                       'data',        m.data,
                       -- 'HH:MM': o segundo nunca foi digitado por ninguém.
                       'hora_inicio', left(m.hora_inicio::text, 5),
                       'hora_fim',    left(m.hora_fim::text, 5),
                       'sala',        m.sala,
                       'alteracao',   EXISTS (
                                        SELECT 1 FROM public.envios_apresentacoes ant
                                         WHERE m.trabalho_id = ANY (ant.trabalhos_ids)
                                           AND ant.status = 'enviado'))
                     ORDER BY m.data, m.hora_inicio, m.titulo)
      FROM m
      JOIN auth.users u             ON u.id = m.owner_id
      LEFT JOIN public.profiles pf  ON pf.id = m.owner_id
      LEFT JOIN public.categorias c ON c.id = m.categoria_id
     GROUP BY m.owner_id, u.email, pf.nome
    RETURNING ea.id
  )
  SELECT array_agg(novos.id) INTO v_ids FROM novos;

  RETURN QUERY
    SELECT ea.id, ea.autor_email, ea.autor_nome, ea.trabalhos
      FROM public.envios_apresentacoes ea
     WHERE ea.id = ANY (v_ids)
     ORDER BY ea.autor_email;
END; $$;
-- Só a Edge Function (service_role) busca a fila: buscar é reservar.
REVOKE ALL ON FUNCTION public.apresentacoes_devidas(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apresentacoes_devidas(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apresentacoes_devidas(integer) TO service_role;

-- ------------------------------------------------------------
-- 7. `concluir_envios` fecha os três registros
-- ------------------------------------------------------------
-- Os dois primeiros blocos são os da 20261027120000, palavra por palavra. O
-- que entra é o terceiro: os UUIDs não colidem entre as tabelas, então o
-- Apps Script continua mandando uma lista só.
--
-- Falha de apresentação volta sozinha para a fila (`apresentacoes_devidas`
-- para na 3ª), mas só o trabalho que AINDA está reservado por este envio:
-- a reserva e o `criado_em` do envio saem do mesmo `now()` (mesma
-- transação), e a igualdade dos dois é o "reservado por este envio". Se o
-- co-chair salvou de novo enquanto o e-mail estava no ar, o trabalho já
-- voltou à fila com a informação nova — e uma busca seguinte pode até tê-lo
-- reservado outra vez; nos dois casos ele não é mexido.
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

  -- O cronograma de apresentações (migration 20261104120000).
  WITH x AS (
    SELECT (j->>'id')::uuid AS id,
           nullif(left(j->>'erro', 500), '') AS erro
      FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) j
  ), fechados AS (
    UPDATE public.envios_apresentacoes ea
       SET status       = CASE WHEN x.erro IS NULL THEN 'enviado' ELSE 'falha' END,
           erro         = x.erro,
           concluido_em = now()
      FROM x
     WHERE ea.id = x.id
       AND ea.status = 'reservado'
    RETURNING ea.trabalhos_ids, ea.status, ea.criado_em
  ), devolvidos AS (
    -- Comando de escrita no WITH roda inteiro mesmo sem ser lido abaixo.
    UPDATE public.apresentacoes a
       SET aviso_reservado_em = NULL
      FROM fechados f
     WHERE f.status = 'falha'
       AND a.trabalho_id = ANY (f.trabalhos_ids)
       AND a.aviso_reservado_em = f.criado_em
    RETURNING a.id
  )
  SELECT v_n + count(*) INTO v_n FROM fechados;

  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.concluir_envios(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.concluir_envios(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concluir_envios(jsonb) TO service_role;

-- ------------------------------------------------------------
-- 8. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sobrou  text;
  v_src     text;
  v_default text;
BEGIN
  -- A fila e a conclusão: só a Edge Function. Buscar é reservar.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_sobrou
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('apresentacoes_devidas', 'concluir_envios')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'Ficou executável pela API: %. Buscar a fila é reservá-la.', v_sobrou;
  END IF;
  IF NOT has_function_privilege('service_role', 'public.apresentacoes_devidas(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.concluir_envios(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role sem EXECUTE na fila: a Edge Function não conseguiria buscar nem concluir.';
  END IF;

  -- O Salvar: só com sessão (a organização é conferida lá dentro).
  IF has_function_privilege('anon', 'public.salvar_cronograma_apresentacoes(jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa salvar_cronograma_apresentacoes — o REVOKE explícito não pegou.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.salvar_cronograma_apresentacoes(jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE em salvar_cronograma_apresentacoes: o AdminCA não salvaria.';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.salvar_cronograma_apresentacoes(jsonb, jsonb)'::regprocedure;
  IF position('is_event_staff()' IN v_src) = 0
     OR position('''aprovado_correcoes''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'salvar_cronograma_apresentacoes deixou de conferir a organização ou o status aprovado.';
  END IF;

  -- A janela pública: aberta, e estreita.
  IF NOT has_function_privilege('anon', 'public.apresentacoes_publicas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon deveria ler o cronograma de apresentações e não lê.';
  END IF;
  SELECT string_agg(nome, ', ') INTO v_sobrou
    FROM pg_proc p,
         unnest(p.proargnames, p.proargmodes) AS a(nome, modo)
   WHERE p.oid = 'public.apresentacoes_publicas()'::regprocedure
     AND a.modo = 't'
     AND (a.nome ~* '(email|owner|dono|orientador|coautor|resumo|parecer)');
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'apresentacoes_publicas() devolve coluna que não pode ser pública: %.', v_sobrou;
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.apresentacoes_publicas()'::regprocedure;
  IF v_src NOT LIKE '%t.status IN (''aprovado'', ''aprovado_correcoes'')%' THEN
    RAISE EXCEPTION 'apresentacoes_publicas() perdeu o recorte de trabalho aprovado.';
  END IF;

  -- As tabelas: fechadas para anon, sem escrita por policy nem por grant.
  IF has_table_privilege('anon', 'public.apresentacoes', 'SELECT')
     OR has_table_privilege('anon', 'public.envios_apresentacoes', 'SELECT') THEN
    RAISE EXCEPTION 'anon ficou com grant de tabela no cronograma de apresentações — o REVOKE não pegou.';
  END IF;
  IF has_table_privilege('authenticated', 'public.apresentacoes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.apresentacoes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.apresentacoes', 'DELETE')
     OR has_table_privilege('authenticated', 'public.envios_apresentacoes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.envios_apresentacoes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.envios_apresentacoes', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated ficou com grant de escrita no cronograma de apresentações — só as RPCs gravam.';
  END IF;
  SELECT string_agg(pol.tablename || '.' || pol.policyname, ', ') INTO v_sobrou
    FROM pg_policies pol
   WHERE pol.schemaname = 'public'
     AND pol.tablename IN ('apresentacoes', 'envios_apresentacoes')
     AND pol.cmd <> 'SELECT';
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'O cronograma de apresentações ganhou policy de escrita: %.', v_sobrou;
  END IF;

  -- As travas do horário e da sala são do servidor.
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.apresentacoes'::regclass
         AND conname IN ('apresentacoes_horario_check', 'apresentacoes_sala_check')) <> 2 THEN
    RAISE EXCEPTION 'apresentacoes perdeu o CHECK do horário ou o da sala.';
  END IF;

  -- Sem isto o e-mail ficaria 'reservado' para sempre, mesmo enviado — e as
  -- duas filas antigas não podem ter caído na reescrita.
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.concluir_envios(jsonb)'::regprocedure;
  IF position('envios_revisores' IN v_src) = 0
     OR position('envios_resultados' IN v_src) = 0
     OR position('envios_apresentacoes' IN v_src) = 0 THEN
    RAISE EXCEPTION 'concluir_envios deixou de fechar uma das três filas.';
  END IF;

  -- A decisão do usuário: só trabalho aprovado é avisado.
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.apresentacoes_devidas(integer)'::regprocedure;
  IF position('''aprovado_correcoes''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'apresentacoes_devidas deixou de conferir que o trabalho segue aprovado.';
  END IF;

  -- A coluna nasce vazia em toda categoria: tipo nenhum é inventado.
  SELECT c.column_default INTO v_default
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'categorias'
     AND c.column_name = 'tipo_apresentacao' AND c.is_nullable = 'NO';
  IF NOT FOUND OR v_default IS NULL OR v_default NOT LIKE '''''%' THEN
    RAISE EXCEPTION 'categorias.tipo_apresentacao tem de ser NOT NULL DEFAULT '''' (veio %).', v_default;
  END IF;

  RAISE NOTICE 'OK: cronograma de apresentações só por RPC, janela pública estreita, fila só para service_role.';
END $$;
