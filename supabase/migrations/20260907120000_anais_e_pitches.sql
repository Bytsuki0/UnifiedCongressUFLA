-- ============================================================
-- Anais do Congresso e Pitches — duas vitrines públicas
-- ------------------------------------------------------------
-- Até aqui o site público mostrava DATAS (cronograma) e ARQUIVOS
-- (templates). Passa a mostrar também o que o congresso PRODUZIU: onde
-- os trabalhos foram publicados (os anais) e os vídeos de apresentação
-- dos trabalhos aprovados (os pitches).
--
-- Duas tabelas editáveis pela organização, no mesmo desenho que
-- `arquivos_download` (20260830120000) e o cronograma (20260903120000)
-- inauguraram: a organização acrescenta e remove linhas numa tela de
-- co-chairs, o visitante lê por uma RPC SECURITY DEFINER, e a tabela
-- continua fechada para `anon`.
--
--   anais              Uma edição publicada: título, onde/quando saiu
--                      (texto livre) e o link para os anais.
--   pitches_historico   Vídeos de congressos ANTERIORES, cadastrados à
--                      mão — o sistema não tem submissão daquela época.
--
-- ⚠ A terceira fonte dos pitches NÃO é uma tabela: são os vídeos que os
-- trabalhos APROVADOS desta edição já entregaram em `trabalho_anexos`.
-- É derivado de propósito. Uma quarta tabela copiando esses vídeos seria
-- uma segunda fonte da mesma verdade, e as duas discordariam no dia em
-- que um autor trocasse o link — que é exatamente o defeito que a
-- 20260830120000 fechou ao DROPAR as colunas `link_*`.
--
-- Corolário: "só entra na vitrine quem exigiu vídeo" não precisa de
-- regra nenhuma. Extensão não pede vídeo, então nenhum trabalho de
-- Extensão tem linha `tipo = 'video'` em `trabalho_anexos`, então nada
-- dele aparece aqui. BIC Jr. pede, então aparece. A pergunta "esta
-- categoria exige vídeo?" já foi respondida no ato da submissão, e a
-- resposta está gravada na entrega.
--
-- ⚠⚠ MUDANÇA DE VISIBILIDADE, e é a decisão mais séria desta migration:
-- `pitches_publicos()` publica TÍTULO, AUTORES e LINK DE VÍDEO de
-- trabalho aprovado para QUALQUER UM, sem sessão. Todo o resto de
-- `trabalhos` continua fechado pelo RLS (dono, revisor associado,
-- organização) — esta função é a única fresta, e ela é estreita de
-- propósito:
--
--   · só `status = 'aprovado'`. NÃO inclui 'aprovado_correcoes': ali o
--     trabalho ainda espera ação do autor, e pôr o vídeo no ar antes
--     disso anuncia como final um desfecho que ainda pode mudar de
--     forma. Quando o autor envia a correção, `enviar_correcao` grava
--     'aprovado' e o pitch entra sozinho.
--   · só o `valor` de anexo `tipo = 'video'` — nunca um caminho do
--     bucket `Pdfs`, que é privado e sairia como caminho inútil.
--   · nada de e-mail, orientador, coautores, parecer ou nota.
--
-- Se um dia o autor precisar consentir com a publicação, isto vira uma
-- coluna em `trabalhos` e um `AND` nesta função — não uma tabela nova.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `anais` — onde os trabalhos foram publicados
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anais (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- O que o visitante lê no cartão. Vazio daria um botão "ACESSAR"
  -- anônimo no meio da página, como em `arquivos_download`.
  titulo    TEXT NOT NULL CHECK (btrim(titulo) <> ''),

  -- ONDE e QUANDO a publicação saiu, em texto livre — "Revista X, v. 12,
  -- n. 3, dezembro de 2025". Não são duas colunas (veículo + data) de
  -- propósito: a forma de citar varia demais entre revista, anais em
  -- PDF e repositório institucional, e um par de campos fixos obrigaria
  -- a organização a torcer a referência para caber. Aqui é o texto que
  -- ela já tem pronto.
  descricao TEXT NOT NULL DEFAULT '',

  -- O link. Como em `arquivos_download`, não existe linha sem link:
  -- "cadastrado mas ainda sem endereço" não é estado — quem não tem o
  -- endereço ainda não publica.
  url       TEXT NOT NULL CHECK (btrim(url) <> ''),

  -- Ordem de exibição. `criado_em` desempata para a lista nunca
  -- embaralhar entre dois carregamentos.
  ordem     INTEGER NOT NULL DEFAULT 0,

  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid()
);

COMMENT ON TABLE public.anais IS
  'Anais do congresso: uma linha por publicação, com o texto livre de onde/quando saiu e o link.';

CREATE INDEX IF NOT EXISTS anais_ordem_idx ON public.anais (ordem, criado_em);

-- ------------------------------------------------------------
-- 2. `pitches_historico` — os vídeos das edições anteriores
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pitches_historico (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  titulo    TEXT NOT NULL CHECK (btrim(titulo) <> ''),

  -- Linha de apoio sob o título — autores, resumo de uma frase. Vazia
  -- esconde a linha, em vez de reservar espaço.
  descricao TEXT NOT NULL DEFAULT '',

  -- Rótulo da edição ("2024", "XII Congresso"). Texto e não ano
  -- numérico: as edições nem sempre são anuais nem se identificam por
  -- ano. Vazio esconde o selo.
  edicao    TEXT NOT NULL DEFAULT '',

  -- Mesma regra dos vídeos da submissão (`aplicar_anexos`): o player é
  -- um <iframe> do YouTube, então um link de outro lugar entraria na
  -- vitrine como cartão quebrado. A trava é do SERVIDOR pelo mesmo
  -- motivo de sempre — a conferência da tela é cortesia.
  video_url TEXT NOT NULL CHECK (
    video_url ~* '^https?://(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/'
  ),

  ordem     INTEGER NOT NULL DEFAULT 0,

  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid()
);

COMMENT ON TABLE public.pitches_historico IS
  'Pitches de edições anteriores, cadastrados à mão. Os desta edição saem de trabalho_anexos e NÃO são copiados para cá.';

CREATE INDEX IF NOT EXISTS pitches_historico_ordem_idx
  ON public.pitches_historico (ordem, criado_em);

-- ------------------------------------------------------------
-- 3. RLS — a organização escreve, quem tem sessão lê
-- ------------------------------------------------------------
-- Escrita para `is_event_staff()`, e não para o admin: as duas telas
-- moram em /co-chairs, junto do cronograma e das categorias. (É o
-- contrário de `arquivos_download`, que é do admin porque a tela dele
-- fica em /admin/configuracoes — o que decide é onde a tela mora.)
ALTER TABLE public.anais             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitches_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anais select" ON public.anais;
CREATE POLICY "anais select" ON public.anais FOR SELECT TO authenticated
  USING (public.email_confirmado());

DROP POLICY IF EXISTS "anais write" ON public.anais;
CREATE POLICY "anais write" ON public.anais FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "pitches_historico select" ON public.pitches_historico;
CREATE POLICY "pitches_historico select" ON public.pitches_historico FOR SELECT TO authenticated
  USING (public.email_confirmado());

DROP POLICY IF EXISTS "pitches_historico write" ON public.pitches_historico;
CREATE POLICY "pitches_historico write" ON public.pitches_historico FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.anais             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pitches_historico TO authenticated;
GRANT ALL ON public.anais             TO service_role;
GRANT ALL ON public.pitches_historico TO service_role;

-- O projeto tem ALTER DEFAULT PRIVILEGES concedendo tudo a `anon`, então
-- este REVOKE não é redundante com o RLS: sem ele, o dia em que alguém
-- acrescentar uma policy `USING (true)` sem pensar abre a tabela inteira.
REVOKE ALL ON public.anais             FROM anon;
REVOKE ALL ON public.pitches_historico FROM anon;

-- ------------------------------------------------------------
-- 4. A janela pública dos anais
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anais_publicos()
RETURNS TABLE(
  id        uuid,
  titulo    text,
  descricao text,
  url       text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.titulo, a.descricao, a.url
    FROM public.anais a
   ORDER BY a.ordem, a.criado_em;
$$;

REVOKE ALL ON FUNCTION public.anais_publicos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anais_publicos() TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. A janela pública dos pitches — as duas fontes numa lista só
-- ------------------------------------------------------------
-- Ler o aviso ⚠⚠ do cabeçalho antes de mexer aqui.
--
-- A ORDEM é parte do contrato, porque a tela pagina: se dois
-- carregamentos devolvessem ordens diferentes, um vídeo pularia da
-- página 2 para a 1 entre um clique e outro e o visitante veria o mesmo
-- pitch duas vezes (ou nenhuma). Por isso todo critério aqui é estável e
-- nenhum depende de relógio:
--
--   bloco 0  os aprovados DESTA edição, alfabéticos pelo título
--   bloco 1  o histórico, na ordem que a organização definiu
--
-- Esta edição na frente porque é o que o visitante vem ver; o arquivo
-- fica logo atrás, na mesma lista, e a paginação atravessa os dois sem
-- costura visível.
--
-- `descricao`/`edicao` (só o histórico tem) e `autores`/`categoria` (só
-- o trabalho tem) convivem como colunas vazias do outro lado, em vez de
-- duas RPCs: é UMA lista paginada, e paginar duas fontes separadas no
-- cliente é reinventar o `ORDER BY` em JavaScript.
CREATE OR REPLACE FUNCTION public.pitches_publicos()
RETURNS TABLE(
  id        uuid,
  origem    text,
  titulo    text,
  descricao text,
  autores   text,
  categoria text,
  edicao    text,
  video_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH unidos AS (
    -- Os vídeos que os trabalhos APROVADOS entregaram.
    --
    -- Sem filtro por `anexo_id IS NOT NULL`: a exigência que originou a
    -- entrega pode ter sido apagada depois (a FK é ON DELETE SET NULL),
    -- e o vídeo entregue continua sendo o vídeo daquele trabalho
    -- aprovado. É o mesmo princípio das abas do revisor — a tela mostra
    -- o que foi ENTREGUE, nunca o que se exige hoje.
    --
    -- Sem recorte por rodada: `trabalho_anexos` guarda uma linha por
    -- exigência (UNIQUE em trabalho_id, anexo_id) e o reenvio a
    -- sobrescreve. O que está lá já é o vídeo corrente.
    SELECT ta.id                        AS id,
           'trabalho'::text             AS origem,
           t.titulo                     AS titulo,
           ''::text                     AS descricao,
           t.autores                    AS autores,
           coalesce(c.nome, '')         AS categoria,
           ''::text                     AS edicao,
           ta.valor                     AS video_url,
           0                            AS bloco,
           0                            AS ordem,
           t.titulo                     AS desempate
      FROM public.trabalho_anexos ta
      JOIN public.trabalhos t       ON t.id = ta.trabalho_id
      LEFT JOIN public.categorias c ON c.id = t.categoria_id
     WHERE ta.tipo   = 'video'
       AND t.status  = 'aprovado'

    UNION ALL

    -- As edições anteriores, cadastradas à mão.
    SELECT p.id, 'historico'::text, p.titulo, p.descricao,
           ''::text, ''::text, p.edicao, p.video_url,
           1, p.ordem, p.criado_em::text
      FROM public.pitches_historico p
  )
  SELECT u.id, u.origem, u.titulo, u.descricao,
         u.autores, u.categoria, u.edicao, u.video_url
    FROM unidos u
   ORDER BY u.bloco, u.ordem, u.desempate, u.id;
$$;

REVOKE ALL ON FUNCTION public.pitches_publicos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pitches_publicos() TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_vazado INTEGER;
BEGIN
  IF NOT has_function_privilege('anon', 'public.anais_publicos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon deveria executar anais_publicos() e não executa';
  END IF;

  IF NOT has_function_privilege('anon', 'public.pitches_publicos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon deveria executar pitches_publicos() e não executa';
  END IF;

  IF has_table_privilege('anon', 'public.anais', 'SELECT')
     OR has_table_privilege('anon', 'public.pitches_historico', 'SELECT') THEN
    RAISE EXCEPTION 'anon ficou com grant de tabela nas vitrines — o REVOKE não pegou';
  END IF;

  -- A trava que mais importa: a fresta de `pitches_publicos()` não pode
  -- alargar. Um trabalho que não está aprovado NÃO pode aparecer, e a
  -- função é SECURITY DEFINER — o RLS de `trabalhos` não vai socorrer
  -- ninguém aqui. Este bloco é o que quebra a migration se alguém
  -- acrescentar 'aprovado_correcoes' ao WHERE sem pensar.
  SELECT count(*) INTO v_vazado
    FROM public.pitches_publicos() pp
    JOIN public.trabalho_anexos ta ON ta.id = pp.id
    JOIN public.trabalhos t        ON t.id  = ta.trabalho_id
   WHERE pp.origem = 'trabalho'
     AND t.status <> 'aprovado';

  IF v_vazado > 0 THEN
    RAISE EXCEPTION 'pitches_publicos() expôs % trabalho(s) não aprovado(s)', v_vazado;
  END IF;

  -- Nenhum caminho do bucket privado pode sair por aqui: só link de vídeo.
  SELECT count(*) INTO v_vazado
    FROM public.pitches_publicos() pp
   WHERE pp.video_url !~* '^https?://';

  IF v_vazado > 0 THEN
    RAISE EXCEPTION 'pitches_publicos() devolveu % valor(es) que não são URL', v_vazado;
  END IF;
END $$;
