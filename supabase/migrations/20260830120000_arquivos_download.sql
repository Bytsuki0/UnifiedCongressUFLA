-- ============================================================
-- Arquivos para download — lista editável, no lugar de 8 colunas fixas
-- ------------------------------------------------------------
-- A 20260817120000 pendurou os downloads em `configuracoes`: uma coluna
-- `link_*` por arquivo, e a lista dos arquivos escrita à mão em
-- `src/lib/downloads.ts`. Publicar um arquivo novo era, portanto, uma
-- migration + uma edição de código + um deploy. A organização passa a
-- acrescentar e remover arquivos em /admin/configuracoes, sozinha.
--
-- Uma tabela, e o `grupo` é o que decide ONDE o arquivo aparece:
--
--   'estudante'  landing (carrossel), /login e /estudante/templates
--   'revisor'    /revisor/arquivo
--
-- Os dois acervos são coisas diferentes — modelos de submissão de um
-- lado, edital e código de ética do outro — e continuariam diferentes
-- mesmo numa lista só; sem o `grupo`, publicar o Manual do Revisor o
-- colocaria na página inicial do congresso.
--
-- Leitura pública pela RPC `arquivos_download_publicos()`, nunca pela
-- tabela: é o mesmo desenho que `links_downloads()` inaugurou e que o
-- cronograma repetiu. O projeto tem ALTER DEFAULT PRIVILEGES concedendo
-- tudo a `anon`, então o REVOKE explícito do item 4 não é redundante
-- com o RLS — é o que impede a tabela de virar janela aberta se um dia
-- alguém acrescentar uma policy `USING (true)` sem pensar.
--
-- ⚠ O acervo do revisor sai pela MESMA função pública, e portanto fica
-- legível sem sessão. É a decisão que a 20260817120000 já havia tomado
-- e que esta migration só carrega adiante: são documentos públicos do
-- congresso, e o que vaza é o endereço do Drive, não o conteúdo (quem
-- controla o acesso ao arquivo é o compartilhamento do próprio Drive).
-- Se algum desses documentos passar a exigir sessão, a função tem de
-- ser partida em duas — uma por grupo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arquivos_download (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Onde o arquivo aparece. CHECK e não FK para uma tabela de grupos:
  -- os dois valores são estruturais (cada um tem uma tela que os
  -- desenha de um jeito), não dado que a organização cadastra.
  grupo     TEXT NOT NULL CHECK (grupo IN ('estudante', 'revisor')),

  -- O que o usuário lê no cartão. `btrim(...) <> ''` porque um arquivo
  -- sem nome é um botão BAIXAR anônimo no meio da página inicial.
  titulo    TEXT NOT NULL CHECK (btrim(titulo) <> ''),

  -- O link do Drive. Também não pode ser vazio: a lista agora é
  -- editável, então "linha cadastrada sem link" deixou de ser o estado
  -- normal de quem ainda não publicou — quem não publicou não cadastra.
  url       TEXT NOT NULL CHECK (btrim(url) <> ''),

  -- Selo do formato (.DOCX, PDF, ...). OPCIONAL: quem hospeda é o
  -- Drive, o link não carrega extensão e ninguém deveria ser obrigado
  -- a digitar uma para publicar um arquivo. Vazio esconde o selo.
  formato   TEXT NOT NULL DEFAULT '',

  -- Linha de apoio sob o título. Hoje só /revisor/arquivo a mostra.
  descricao TEXT NOT NULL DEFAULT '',

  -- Ordem de exibição dentro do grupo. Empate desempata por `criado_em`
  -- para que a lista nunca embaralhe entre dois carregamentos.
  ordem     INTEGER NOT NULL DEFAULT 0,

  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.arquivos_download IS
  'Arquivos que a organização publica para download. `grupo` decide a tela: estudante (landing/login/templates) ou revisor (/revisor/arquivo).';

CREATE INDEX IF NOT EXISTS arquivos_download_grupo_idx
  ON public.arquivos_download (grupo, ordem, criado_em);

-- ------------------------------------------------------------
-- 2. Traz o que já estava configurado
-- ------------------------------------------------------------
-- Só as colunas preenchidas viram linha: uma coluna vazia significava
-- "ainda não publicado", e o equivalente disso no modelo novo é não
-- existir. O `NOT EXISTS` deixa a migration idempotente sem UNIQUE em
-- `url` — repetir o mesmo link em dois grupos é legítimo (o edital pode
-- valer para os dois lados), repetir nesta carga inicial não.
INSERT INTO public.arquivos_download (grupo, titulo, url, formato, descricao, ordem)
SELECT v.grupo, v.titulo, v.url, v.formato, v.descricao, v.ordem
FROM public.configuracoes c
CROSS JOIN LATERAL (VALUES
  ('estudante', 'Modelo de artigo · Word',  c.link_template_word,        '.DOCX', '', 1),
  ('estudante', 'Modelo de artigo · LaTeX', c.link_template_latex,       '.TEX',  '', 2),
  ('estudante', 'Modelo dos slides',        c.link_template_slides,      '.PPTX', '', 3),
  ('estudante', 'Normas de formatação',     c.link_normas_formatacao,    '.PDF',  '', 4),
  ('revisor',   'Edital do Congresso',      c.link_edital_congresso,     'PDF',
                'Regulamento completo e normas', 1),
  ('revisor',   'Manual do Revisor',        c.link_manual_revisor,       'PDF',
                'Orientações para avaliação duplo-cega', 2),
  ('revisor',   'Diretrizes de Avaliação',  c.link_diretrizes_avaliacao, 'PDF',
                'Critérios e pontuações por categoria', 3),
  ('revisor',   'Código de Ética',          c.link_codigo_etica,         'PDF',
                'Normas de conduta e conflitos de interesse', 4)
) AS v(grupo, titulo, url, formato, descricao, ordem)
WHERE btrim(coalesce(v.url, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.arquivos_download a
    WHERE a.grupo = v.grupo AND a.url = v.url
  );

-- ------------------------------------------------------------
-- 3. RLS — a organização escreve, quem tem sessão lê
-- ------------------------------------------------------------
-- Escrita restrita ao ADMIN, e não a `is_event_staff()`: a tela que
-- edita esta lista é /admin/configuracoes, do lado do admin, como o
-- resto de `configuracoes` (20260813120000). Co-chair não publica
-- arquivo — e se um dia publicar, é a policy abaixo que muda, não o
-- cliente.
--
-- SELECT para `authenticated` cobre o caminho normal de quem já entrou
-- (a tela do admin precisa dos ids para editar e apagar). O visitante
-- sem sessão não passa por aqui: passa pela RPC do item 4.
ALTER TABLE public.arquivos_download ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arquivos_download select" ON public.arquivos_download;
CREATE POLICY "arquivos_download select" ON public.arquivos_download FOR SELECT TO authenticated
  USING (public.email_confirmado());

DROP POLICY IF EXISTS "arquivos_download write" ON public.arquivos_download;
CREATE POLICY "arquivos_download write" ON public.arquivos_download FOR ALL TO authenticated
  USING (public.is_app_admin() AND public.email_confirmado())
  WITH CHECK (public.is_app_admin() AND public.email_confirmado());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.arquivos_download TO authenticated;

-- ------------------------------------------------------------
-- 4. A janela pública
-- ------------------------------------------------------------
-- `id` sai junto porque a landing precisa de uma chave estável de React
-- para os cartões do carrossel; não identifica ninguém e não abre nada.
CREATE OR REPLACE FUNCTION public.arquivos_download_publicos()
RETURNS TABLE(
  id        uuid,
  grupo     text,
  titulo    text,
  url       text,
  formato   text,
  descricao text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.grupo, a.titulo, a.url, a.formato, a.descricao
  FROM public.arquivos_download a
  ORDER BY a.grupo, a.ordem, a.criado_em;
$$;

REVOKE ALL ON FUNCTION public.arquivos_download_publicos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arquivos_download_publicos() TO anon, authenticated;

-- O REVOKE que o ALTER DEFAULT PRIVILEGES do projeto torna necessário.
REVOKE ALL ON public.arquivos_download FROM anon;

-- ------------------------------------------------------------
-- 5. O modelo antigo sai de cena
-- ------------------------------------------------------------
-- Duas fontes para a mesma informação é o defeito que esta migration
-- existe para fechar: com `links_downloads()` de pé, uma tela poderia
-- continuar lendo a coluna enquanto o admin edita a tabela, e as duas
-- discordariam em silêncio. As colunas caem junto pelo mesmo motivo —
-- os valores delas já viraram linha no item 2.
DROP FUNCTION IF EXISTS public.links_downloads();

ALTER TABLE public.configuracoes
  DROP COLUMN IF EXISTS link_template_word,
  DROP COLUMN IF EXISTS link_template_latex,
  DROP COLUMN IF EXISTS link_template_slides,
  DROP COLUMN IF EXISTS link_normas_formatacao,
  DROP COLUMN IF EXISTS link_edital_congresso,
  DROP COLUMN IF EXISTS link_manual_revisor,
  DROP COLUMN IF EXISTS link_diretrizes_avaliacao,
  DROP COLUMN IF EXISTS link_codigo_etica;

-- ------------------------------------------------------------
-- 6. Confere na própria migration
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.arquivos_download_publicos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon deveria executar arquivos_download_publicos() e não executa';
  END IF;

  IF has_table_privilege('anon', 'public.arquivos_download', 'SELECT') THEN
    RAISE EXCEPTION 'anon consegue ler public.arquivos_download direto — o REVOKE não pegou';
  END IF;

  IF has_table_privilege('anon', 'public.configuracoes', 'SELECT') THEN
    RAISE EXCEPTION 'anon voltou a ler public.configuracoes';
  END IF;

  -- A migration não pode ter deixado a lista antiga e a nova convivendo.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'configuracoes'
      AND column_name LIKE 'link\_%'
  ) THEN
    RAISE EXCEPTION 'sobrou coluna link_* em public.configuracoes';
  END IF;
END $$;
