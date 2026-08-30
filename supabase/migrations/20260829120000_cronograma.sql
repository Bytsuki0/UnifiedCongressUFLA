-- ============================================================
-- Cronograma do congresso — calendário público por mês
-- ------------------------------------------------------------
-- A organização escolhe QUAIS MESES aparecem (agosto e setembro, ou
-- outros), pinta os dias e escreve o que acontece em cada um. O
-- resultado é lido em três lugares: a landing (sem sessão), a página
-- pública /cronograma e /estudante/cronograma.
--
-- Três tabelas, e a divisão entre elas é o ponto:
--
--   cronograma_meses    quais meses a organização publica. É a única
--                       coisa que decide o que a landing desenha — um
--                       mês fora desta lista não existe para o visitante.
--   cronograma_eventos  a MARCAÇÃO: cor + nome + descrição. Uma só,
--                       compartilhada por todos os dias dela.
--   cronograma_dias     que dias pertencem a que marcação.
--
-- Por que a marcação não mora no dia: o pedido é "selecionar um ou
-- vários dias de uma vez" e dar a eles a mesma cor e o mesmo nome. Com
-- cor/nome/descrição por dia, corrigir um typo de um período de cinco
-- dias seriam cinco edições que podem divergir entre si. Aqui é uma.
--
-- Um dia PODE pertencer a mais de uma marcação (submissão aberta e
-- minicurso no mesmo dia são coisas diferentes). Não há UNIQUE em `dia`
-- de propósito; a tela mostra a cor da primeira marcação e um ponto
-- para cada uma das outras.
--
-- Leitura pública: pelas RPCs `cronograma_publico_*`, nunca pelas
-- tabelas — mesmo desenho de `links_downloads()` (20260817120000). O
-- projeto tem ALTER DEFAULT PRIVILEGES concedendo tudo a `anon`, então
-- o REVOKE explícito no fim não é redundante com o RLS: é o que impede
-- a tabela de virar uma janela aberta se algum dia uma policy `USING
-- (true)` for acrescentada sem cuidado.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Os meses publicados
-- ------------------------------------------------------------
-- PK composta (ano, mes): a lista é um CONJUNTO de meses, e um id
-- artificial só permitiria cadastrar "agosto de 2026" duas vezes. A
-- ordem de exibição não é coluna — é `ORDER BY ano, mes`, a única ordem
-- que faz sentido num calendário e que, por não ser configurável, não
-- pode ser configurada errado.
CREATE TABLE IF NOT EXISTS public.cronograma_meses (
  ano       INTEGER NOT NULL CHECK (ano BETWEEN 2000 AND 2999),
  mes       INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ano, mes)
);

COMMENT ON TABLE public.cronograma_meses IS
  'Meses que o cronograma público exibe. Lista vazia = nenhum calendário na landing.';

-- ------------------------------------------------------------
-- 2. As marcações (cor + nome + descrição)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cronograma_eventos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo     TEXT NOT NULL CHECK (btrim(titulo) <> ''),
  descricao  TEXT NOT NULL DEFAULT '',

  -- Hex de 6 dígitos, com CHECK. A cor vai parar num atributo `style`
  -- em três páginas diferentes; validar o formato aqui é o que garante
  -- que a coluna carregue cor, e não texto arbitrário que cada tela
  -- teria de higienizar por conta própria.
  cor        TEXT NOT NULL CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),

  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.cronograma_eventos IS
  'Marcação do cronograma: cor, nome e descrição compartilhados por todos os dias dela.';

-- ------------------------------------------------------------
-- 3. Os dias de cada marcação
-- ------------------------------------------------------------
-- ON DELETE CASCADE: apagar a marcação apaga os dias. É o que se espera
-- e evita dia órfão pintado com uma cor que ninguém mais explica.
CREATE TABLE IF NOT EXISTS public.cronograma_dias (
  evento_id UUID NOT NULL REFERENCES public.cronograma_eventos(id) ON DELETE CASCADE,
  dia       DATE NOT NULL,
  PRIMARY KEY (evento_id, dia)
);

-- O calendário sempre lê por faixa de datas.
CREATE INDEX IF NOT EXISTS cronograma_dias_dia_idx ON public.cronograma_dias (dia);

-- ------------------------------------------------------------
-- 4. RLS — escrita da organização, leitura de quem tem sessão
-- ------------------------------------------------------------
-- Leitura para `authenticated` existe para a tela de GESTÃO (co-chairs
-- precisa dos ids para editar) e como caminho normal de quem já entrou.
-- O visitante sem sessão não passa por aqui: passa pelas RPCs do item 5.
ALTER TABLE public.cronograma_meses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cronograma_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cronograma_dias    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cronograma_meses select" ON public.cronograma_meses;
CREATE POLICY "cronograma_meses select" ON public.cronograma_meses FOR SELECT TO authenticated
  USING (public.email_confirmado());
DROP POLICY IF EXISTS "cronograma_meses write" ON public.cronograma_meses;
CREATE POLICY "cronograma_meses write" ON public.cronograma_meses FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "cronograma_eventos select" ON public.cronograma_eventos;
CREATE POLICY "cronograma_eventos select" ON public.cronograma_eventos FOR SELECT TO authenticated
  USING (public.email_confirmado());
DROP POLICY IF EXISTS "cronograma_eventos write" ON public.cronograma_eventos;
CREATE POLICY "cronograma_eventos write" ON public.cronograma_eventos FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "cronograma_dias select" ON public.cronograma_dias;
CREATE POLICY "cronograma_dias select" ON public.cronograma_dias FOR SELECT TO authenticated
  USING (public.email_confirmado());
DROP POLICY IF EXISTS "cronograma_dias write" ON public.cronograma_dias;
CREATE POLICY "cronograma_dias write" ON public.cronograma_dias FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cronograma_meses   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cronograma_eventos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cronograma_dias    TO authenticated;

-- ------------------------------------------------------------
-- 5. A janela pública
-- ------------------------------------------------------------
-- Duas funções em vez de um `jsonb` só: `gen:types` devolve linha
-- tipada para `RETURNS TABLE` e `Json` (ou seja, `as any` de volta)
-- para jsonb. O cliente dispara as duas em paralelo.
CREATE OR REPLACE FUNCTION public.cronograma_publico_meses()
RETURNS TABLE(ano integer, mes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.ano, m.mes FROM public.cronograma_meses m ORDER BY m.ano, m.mes;
$$;

-- Só os dias que caem num mês PUBLICADO. Uma marcação criada e depois
-- deixada fora da lista de meses some da vista pública inteira, sem que
-- ninguém precise apagá-la — e nada é desenhado fora das abas que a
-- outra função devolveu.
CREATE OR REPLACE FUNCTION public.cronograma_publico_dias()
RETURNS TABLE(
  dia       date,
  evento_id uuid,
  titulo    text,
  descricao text,
  cor       text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT d.dia, e.id, e.titulo, e.descricao, e.cor
  FROM public.cronograma_dias d
  JOIN public.cronograma_eventos e ON e.id = d.evento_id
  WHERE EXISTS (
    SELECT 1 FROM public.cronograma_meses m
    WHERE m.ano = EXTRACT(YEAR  FROM d.dia)::int
      AND m.mes = EXTRACT(MONTH FROM d.dia)::int
  )
  ORDER BY d.dia, e.criado_em;
$$;

REVOKE ALL ON FUNCTION public.cronograma_publico_meses() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cronograma_publico_dias()  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cronograma_publico_meses() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cronograma_publico_dias()  TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. Gravar uma marcação — uma RPC, uma transação
-- ------------------------------------------------------------
-- Marcação e dias são duas tabelas; gravá-las com dois requests do
-- cliente deixa a porta aberta para "criou o evento, falhou os dias" e
-- uma cor sem dia nenhum na lista da organização. Mesmo motivo de
-- `confirmar_distribuicao` (20260820120000): tudo ou nada.
--
-- `p_id` NULL cria; `p_id` preenchido edita. Editar SUBSTITUI o
-- conjunto de dias pelo que veio — é o que a tela mostra (a seleção no
-- calendário é o estado final, não um delta), e assim tirar um dia de
-- uma marcação não precisa de uma segunda RPC.
CREATE OR REPLACE FUNCTION public.salvar_marcacao_cronograma(
  p_id        uuid,
  p_titulo    text,
  p_descricao text,
  p_cor       text,
  p_dias      date[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Apenas a organização pode editar o cronograma.';
  END IF;

  IF btrim(coalesce(p_titulo, '')) = '' THEN
    RAISE EXCEPTION 'Informe o nome do evento.';
  END IF;

  -- Sem dia nenhum a marcação não aparece em lugar algum: seria uma
  -- linha invisível que só atrapalha a lista da organização.
  IF p_dias IS NULL OR array_length(p_dias, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um dia.';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.cronograma_eventos (titulo, descricao, cor, criado_por)
    VALUES (btrim(p_titulo), coalesce(p_descricao, ''), p_cor, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.cronograma_eventos
       SET titulo = btrim(p_titulo), descricao = coalesce(p_descricao, ''), cor = p_cor
     WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Evento não encontrado.';
    END IF;

    DELETE FROM public.cronograma_dias WHERE evento_id = v_id;
  END IF;

  INSERT INTO public.cronograma_dias (evento_id, dia)
  SELECT v_id, d FROM unnest(p_dias) AS d
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.salvar_marcacao_cronograma(uuid, text, text, text, date[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salvar_marcacao_cronograma(uuid, text, text, text, date[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.salvar_marcacao_cronograma(uuid, text, text, text, date[]) TO authenticated;

-- ------------------------------------------------------------
-- 7. Fechar `anon` nas tabelas
-- ------------------------------------------------------------
-- O ALTER DEFAULT PRIVILEGES do projeto já concedeu tudo a `anon` no
-- instante em que os CREATE TABLE acima rodaram (foi exatamente isso
-- que a 20260813150000 teve de consertar depois do fato). O RLS já
-- recusa — não há policy para `anon` —, mas o grant tem de sair também:
-- é ele que transformaria uma policy `TO public` futura em vazamento.
REVOKE ALL ON public.cronograma_meses   FROM anon;
REVOKE ALL ON public.cronograma_eventos FROM anon;
REVOKE ALL ON public.cronograma_dias    FROM anon;

-- ------------------------------------------------------------
-- 8. Confere na própria migration
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.cronograma_publico_meses()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.cronograma_publico_dias()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon deveria ler o cronograma público e não lê';
  END IF;

  IF has_table_privilege('anon', 'public.cronograma_meses', 'SELECT')
     OR has_table_privilege('anon', 'public.cronograma_eventos', 'SELECT')
     OR has_table_privilege('anon', 'public.cronograma_dias', 'SELECT') THEN
    RAISE EXCEPTION 'anon ficou com grant de tabela no cronograma';
  END IF;

  IF has_function_privilege('anon',
       'public.salvar_marcacao_cronograma(uuid, text, text, text, date[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa a escrita do cronograma';
  END IF;
END $$;
