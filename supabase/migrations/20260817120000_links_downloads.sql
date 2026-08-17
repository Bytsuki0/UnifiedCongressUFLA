-- ============================================================
-- Links de download configuráveis (Google Drive)
-- ------------------------------------------------------------
-- Os botões BAIXAR da landing, do /login, de /estudante/templates e de
-- /revisor/arquivo eram simulação: `alert("Download de ... (simulação)")`
-- e `toast.info("... em breve")`. Nenhum dos arquivos citados existia —
-- nem em `public/`, nem em bucket nenhum. A organização passa a colar os
-- links do Drive em /admin/configuracoes e os botões abrem o link.
--
-- Por que RPC e não leitura direta da tabela: a landing e o /login são
-- páginas PÚBLICAS, sem sessão. A policy de SELECT de `configuracoes`
-- exige `authenticated` + e-mail confirmado, e a 20260813150000 revogou
-- a tabela de `anon` de propósito. Nada disso muda aqui. O que abre é
-- uma função que devolve SÓ as colunas de link — prazo, edital,
-- `atualizado_por` e o resto continuam fora do alcance de quem não tem
-- sessão.
--
-- Os 4 documentos do revisor (edital, manual, diretrizes, código de
-- ética) saem pela mesma função e ficam, portanto, legíveis sem sessão.
-- É decisão deliberada: são documentos públicos do congresso, e o que
-- vaza é o endereço do Drive, não o conteúdo (quem controla o acesso ao
-- arquivo é o compartilhamento do próprio Drive). Se algum dia um desses
-- links precisar de sessão, a função tem de ser partida em duas.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Os links que faltavam
-- ------------------------------------------------------------
-- `link_template_word` e `link_template_latex` já existiam desde a
-- 20260813120000 (o card "Links de Templates" do painel admin). Faltavam
-- os slides e as normas do lado do estudante, e os quatro documentos do
-- revisor. DEFAULT '' e NOT NULL: campo vazio é o estado normal de quem
-- ainda não configurou, e a interface desabilita o botão nesse caso —
-- NULL não acrescentaria nada e só criaria um segundo "vazio".
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS link_template_slides      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS link_normas_formatacao    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS link_edital_congresso     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS link_manual_revisor       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS link_diretrizes_avaliacao TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS link_codigo_etica         TEXT NOT NULL DEFAULT '';

-- ------------------------------------------------------------
-- 2. A janela pública: só os links, nada mais
-- ------------------------------------------------------------
-- SECURITY DEFINER para atravessar a policy de SELECT da tabela (que
-- exige sessão com e-mail confirmado) sem afrouxá-la. A lista de colunas
-- é escrita à mão de propósito: `SELECT *` aqui passaria a vazar
-- qualquer coluna futura de `configuracoes` para o mundo. Acrescentar
-- uma coluna a esta função é decisão de exposição pública.
CREATE OR REPLACE FUNCTION public.links_downloads()
RETURNS TABLE(
  link_template_word        text,
  link_template_latex       text,
  link_template_slides      text,
  link_normas_formatacao    text,
  link_edital_congresso     text,
  link_manual_revisor       text,
  link_diretrizes_avaliacao text,
  link_codigo_etica         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.link_template_word,
         c.link_template_latex,
         c.link_template_slides,
         c.link_normas_formatacao,
         c.link_edital_congresso,
         c.link_manual_revisor,
         c.link_diretrizes_avaliacao,
         c.link_codigo_etica
  FROM public.configuracoes c WHERE c.id;
$$;

-- REVOKE de PUBLIC e GRANT explícito, na ordem — a regra da casa
-- (20260813150000): o projeto tem ALTER DEFAULT PRIVILEGES concedendo a
-- `anon`, então o grant abaixo não é redundante com o default, é o que
-- torna a exposição uma decisão registrada em vez de um acidente.
REVOKE ALL ON FUNCTION public.links_downloads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.links_downloads() TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. Confere na própria migration
-- ------------------------------------------------------------
-- Abrir a RPC não pode ter aberto a tabela junto, nem reaberto as
-- funções de prazo que a 20260813150000 fechou.
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.links_downloads()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon deveria executar links_downloads() e não executa';
  END IF;

  IF has_table_privilege('anon', 'public.configuracoes', 'SELECT') THEN
    RAISE EXCEPTION 'anon voltou a ler public.configuracoes';
  END IF;

  IF has_function_privilege('anon', 'public.prazo_submissoes()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon voltou a executar prazo_submissoes()';
  END IF;
END $$;
