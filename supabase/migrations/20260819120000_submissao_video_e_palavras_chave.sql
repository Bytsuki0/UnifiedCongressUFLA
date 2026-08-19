-- ============================================================
-- Submissão: vídeo do YouTube, palavras-chave e tipo de resumo
-- ------------------------------------------------------------
-- O formulário do estudante parou de pedir o RESUMO digitado — ele vive
-- no PDF — e passou a pedir três coisas novas:
--
--   · palavras_chave  -> lista de termos, obrigatória.
--   · video_url       -> link do vídeo no YouTube, obrigatório.
--   · tipo_resumo     -> 'simples' | 'estendido', o que o autor declara
--                        ter submetido no lugar do texto do resumo.
--
-- A coluna `resumo` NÃO é removida: os trabalhos já submetidos têm
-- texto ali e a organização ainda o lê. Ela apenas deixa de ser
-- obrigatória, que é o que destrava o INSERT sem o campo.
--
-- As duas RPCs de escrita do autor (`editar_submissao` e
-- `enviar_correcao`) trocam o parâmetro `_resumo` pelos três novos. Sem
-- isso os campos seriam gravados na submissão e nunca mais poderiam ser
-- corrigidos: a policy `trabalhos update` só deixa o autor escrever
-- direto enquanto o status é 'pendente', e a rodada de correção acontece
-- em 'aprovado_correcoes', que só as RPCs SECURITY DEFINER alcançam.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Colunas novas
-- ------------------------------------------------------------
-- Os DEFAULTs não são conveniência: `ADD COLUMN ... NOT NULL` sem valor
-- padrão falha numa tabela que já tem linhas.
ALTER TABLE public.trabalhos
  ADD COLUMN IF NOT EXISTS palavras_chave TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS video_url      TEXT,
  ADD COLUMN IF NOT EXISTS tipo_resumo    TEXT NOT NULL DEFAULT 'simples';

ALTER TABLE public.trabalhos
  DROP CONSTRAINT IF EXISTS trabalhos_tipo_resumo_valido;
ALTER TABLE public.trabalhos
  ADD CONSTRAINT trabalhos_tipo_resumo_valido
  CHECK (tipo_resumo IN ('simples', 'estendido'));

COMMENT ON COLUMN public.trabalhos.palavras_chave IS
  'Termos livres informados pelo autor, na ordem em que os digitou.';
COMMENT ON COLUMN public.trabalhos.video_url IS
  'Link do vídeo de apresentação no YouTube. NULL nas submissões anteriores a esta migration.';
COMMENT ON COLUMN public.trabalhos.tipo_resumo IS
  'O que o autor declara ter submetido: resumo simples ou estendido.';

-- ------------------------------------------------------------
-- 2. `resumo` deixa de ser obrigatório
-- ------------------------------------------------------------
-- Só a obrigatoriedade sai. O conteúdo já gravado permanece.
ALTER TABLE public.trabalhos ALTER COLUMN resumo DROP NOT NULL;

-- ------------------------------------------------------------
-- 3. RPCs do autor com assinatura nova
-- ------------------------------------------------------------
-- DROP antes de CREATE, obrigatoriamente: acrescentar parâmetros com
-- DEFAULT cria uma SOBRECARGA em vez de substituir, e a chamada antiga
-- de 4 argumentos ficaria ambígua entre as duas versões.
--
-- O DROP também leva junto os GRANT/REVOKE de cada função — por isso
-- eles são refeitos por inteiro no fim de cada bloco, incluindo o
-- `REVOKE ... FROM anon` que 20260813150000 aplicou em
-- `editar_submissao`.
DROP FUNCTION IF EXISTS public.editar_submissao(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.enviar_correcao(uuid, text, text, text);

-- ---- editar_submissao (era 20260813120000) ------------------
-- Corpo idêntico ao anterior, exceto pela validação e pelo UPDATE.
-- Continua SEM `set_config('app.decisao_automatica')`: esta escrita é do
-- autor, não do banco, e deve seguir passando pelo trigger de proteção
-- — inclusive pelo teste de prazo.
CREATE FUNCTION public.editar_submissao(
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
  -- ARRAY(SELECT ...) preserva a ordem em que o autor digitou; um
  -- array_agg(DISTINCT ...) a embaralharia.
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
  IF NOT public.submissoes_abertas() THEN
    RAISE EXCEPTION 'O prazo de submissão está encerrado — o trabalho não pode mais ser editado.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' THEN
    RAISE EXCEPTION 'O título é obrigatório.';
  END IF;
  IF coalesce(array_length(v_kw, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma palavra-chave.';
  END IF;
  -- Conferência grosseira de domínio: a extração do id do vídeo é do
  -- cliente, aqui só se barra o link que claramente não é do YouTube.
  IF v_video IS NULL
     OR v_video !~* '^https?://(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/' THEN
    RAISE EXCEPTION 'Informe um link válido de vídeo do YouTube.';
  END IF;
  IF _tipo_resumo NOT IN ('simples', 'estendido') THEN
    RAISE EXCEPTION 'Tipo de resumo inválido.';
  END IF;
  -- O PDF novo tem que estar na pasta do próprio autor, a mesma regra
  -- que a política de Storage aplica no upload.
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

  -- Caminho do arquivo substituído (NULL quando o PDF não mudou), para
  -- o cliente apagar o antigo do Storage.
  RETURN CASE
    WHEN v_pdf_novo IS NOT NULL AND t.pdf_url IS DISTINCT FROM v_pdf_novo THEN t.pdf_url
    ELSE NULL
  END;
END; $$;

REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text) TO authenticated;

-- ---- enviar_correcao (era 20260806120000/20260806140000) ----
-- Irmã da anterior, com o gatilho trocado: exige 'aprovado_correcoes' e
-- IGNORA o prazo (o GUC `app.decisao_automatica` faz o trigger devolver
-- cedo). É a exceção do "aprovado com correções", que segue corrigível
-- depois do encerramento.
CREATE FUNCTION public.enviar_correcao(
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

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET titulo                = trim(_titulo),
         palavras_chave        = v_kw,
         video_url             = v_video,
         tipo_resumo           = _tipo_resumo,
         pdf_url               = coalesce(v_pdf_novo, pdf_url),
         status                = 'aprovado',
         correcoes_enviadas_em = now()
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  -- Caminho do arquivo substituído (NULL quando o PDF não mudou).
  RETURN CASE
    WHEN v_pdf_novo IS NOT NULL AND t.pdf_url IS DISTINCT FROM v_pdf_novo THEN t.pdf_url
    ELSE NULL
  END;
END; $$;

REVOKE ALL ON FUNCTION public.enviar_correcao(uuid, text, text[], text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_correcao(uuid, text, text[], text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_correcao(uuid, text, text[], text, text, text) TO authenticated;
