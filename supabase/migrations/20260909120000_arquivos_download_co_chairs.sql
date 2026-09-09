-- ============================================================
-- Arquivos para download — a escrita passa para a organização
-- ------------------------------------------------------------
-- A 20260830120000 criou `arquivos_download` com a escrita restrita ao
-- ADMIN, e o motivo estava escrito lá: a tela que editava a lista era
-- /admin/configuracoes, do lado do admin, como o resto de
-- `configuracoes`. O comentário dela já previa este dia — "e se um dia
-- co-chair publicar, é a policy que muda, não o cliente".
--
-- É o que muda aqui. O painel saiu de /admin/configuracoes e virou tela
-- própria em /co-chairs/downloads, junto do cronograma, das categorias
-- e das vitrines: quem publica modelo de artigo e manual do revisor é a
-- organização do congresso, não quem administra contas e papéis. A
-- regra do projeto é que a policy acompanha ONDE A TELA MORA — foi o
-- que decidiu `arquivos_download` ser do admin (tela em
-- /admin/configuracoes) e `anais`/`pitches`/`cronograma_eventos` serem
-- de `is_event_staff()` (telas em /co-chairs).
--
-- `is_event_staff()` é admin OU avaliador, então o admin NÃO perde
-- acesso: o conjunto só cresce. O que muda é o co-chair passar a
-- alcançar a lista pela API, e não apenas pela tela.
--
-- O que NÃO muda:
--   * a leitura pública continua em `arquivos_download_publicos()`;
--   * o SELECT autenticado continua aberto a quem confirmou o e-mail
--     (a tela precisa dos ids para editar e apagar);
--   * a tabela continua fechada para `anon` (REVOKE da 20260830120000,
--     que o ALTER DEFAULT PRIVILEGES do projeto torna necessário).
-- ============================================================

-- ------------------------------------------------------------
-- 1. A policy de escrita
-- ------------------------------------------------------------
-- FOR ALL, como antes: as três escritas da tela (INSERT no botão
-- ADICIONAR, UPDATE na edição, DELETE no REMOVER) são a mesma alçada, e
-- parti-las em três policies só multiplicaria o lugar onde esquecer o
-- `email_confirmado()`.
DROP POLICY IF EXISTS "arquivos_download write" ON public.arquivos_download;
CREATE POLICY "arquivos_download write" ON public.arquivos_download FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

-- ------------------------------------------------------------
-- 2. Confere na própria migration
-- ------------------------------------------------------------
-- Os três canários abaixo quebram a migration se ela não fizer o que
-- diz. O segundo é o que importa: uma policy que ganhasse
-- `is_event_staff()` sem PERDER `is_app_admin()` (por um OR distraído,
-- ou por sobrar a policy antiga com outro nome) passaria no primeiro
-- teste e continuaria trancando o co-chair — porque o `AND` do
-- `is_app_admin()` é que o barrava.
DO $$
DECLARE
  v_qual  TEXT;
  v_check TEXT;
  v_n     INTEGER;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'arquivos_download' AND cmd = 'ALL';

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'esperava exatamente 1 policy de escrita em arquivos_download, achei %', v_n;
  END IF;

  SELECT qual, with_check INTO v_qual, v_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'arquivos_download' AND cmd = 'ALL';

  IF v_qual NOT LIKE '%is_event_staff%' OR v_check NOT LIKE '%is_event_staff%' THEN
    RAISE EXCEPTION 'a escrita de arquivos_download não passou para is_event_staff()';
  END IF;

  IF v_qual LIKE '%is_app_admin%' OR v_check LIKE '%is_app_admin%' THEN
    RAISE EXCEPTION 'is_app_admin() sobrou na escrita de arquivos_download — o co-chair continua barrado';
  END IF;

  -- O gate de e-mail confirmado não pode ter caído junto na troca.
  IF v_qual NOT LIKE '%email_confirmado%' OR v_check NOT LIKE '%email_confirmado%' THEN
    RAISE EXCEPTION 'a escrita de arquivos_download perdeu o gate email_confirmado()';
  END IF;

  -- E a tabela segue fechada para quem não tem sessão.
  IF has_table_privilege('anon', 'public.arquivos_download', 'SELECT') THEN
    RAISE EXCEPTION 'anon consegue ler public.arquivos_download direto';
  END IF;
END $$;
