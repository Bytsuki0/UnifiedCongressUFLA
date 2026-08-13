-- ============================================================
-- Prazo de submissão + edição do próprio trabalho
-- ------------------------------------------------------------
-- O painel /admin/configuracoes mostrava "Abertura de Submissões" e
-- "Encerramento" desde sempre, mas os campos eram estado local do React:
-- o botão SALVAR só emitia um toast e nenhuma data era conferida em
-- lugar nenhum. Esta migration transforma aquilo numa regra de verdade,
-- no servidor.
--
-- Regra final:
--   · Enviar trabalho novo    -> só dentro da janela de submissão.
--   · Editar trabalho próprio -> só enquanto 'pendente' E dentro da
--                                janela (RPC `editar_submissao`).
--   · Aprovado com correções  -> editável SEMPRE, inclusive depois do
--                                prazo. É a exceção pedida, e ela sai de
--                                graça: `enviar_correcao` liga o GUC
--                                `app.decisao_automatica`, e o trigger
--                                devolve cedo quando ele está ligado.
--   · Organização (staff)     -> nunca é barrada pelo prazo.
--
-- Onde a trava mora: no trigger `protect_trabalhos_fields`, não numa
-- policy. Policy recusada vira "new row violates row-level security
-- policy", que não diz nada ao autor; o trigger devolve a frase certa.
-- Os dois são igualmente do servidor — o cliente não escapa de nenhum.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Configurações do congresso (linha única)
-- ------------------------------------------------------------
-- `id BOOLEAN PRIMARY KEY CHECK (id)` é o truque de singleton: só o
-- valor `true` passa no CHECK, então a tabela não comporta uma segunda
-- linha nem por engano. Sem policy de INSERT/DELETE, ninguém duplica
-- nem apaga a linha — só o UPDATE do admin existe.
CREATE TABLE IF NOT EXISTS public.configuracoes (
  id                      BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),

  -- NULL = "sem prazo definido". Ver `submissoes_abertas()`: a ausência
  -- de data NÃO fecha as submissões. Fechar por omissão derrubaria todo
  -- o fluxo de envio no instante em que esta migration subisse.
  submissoes_abertura     DATE,
  submissoes_encerramento DATE,

  -- Os demais parâmetros do painel. São GRAVADOS aqui para que o botão
  -- "SALVAR CONFIGURAÇÕES" pare de mentir, mas hoje só o prazo tem
  -- regra de servidor aplicando-o. Quem for usar um destes campos
  -- precisa escrever a trava junto.
  parecer_min_caracteres  INTEGER     NOT NULL DEFAULT 1000,
  max_coautores           INTEGER     NOT NULL DEFAULT 5,
  alerta_horas            INTEGER     NOT NULL DEFAULT 48,
  edital                  TEXT        NOT NULL DEFAULT '',
  link_template_word      TEXT        NOT NULL DEFAULT '',
  link_template_latex     TEXT        NOT NULL DEFAULT '',

  atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por          UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT configuracoes_janela_coerente
    CHECK (submissoes_abertura IS NULL
           OR submissoes_encerramento IS NULL
           OR submissoes_abertura <= submissoes_encerramento)
);

-- A linha nasce com as datas em NULL de propósito: sem prazo até que o
-- admin defina um. Ver comentário acima.
INSERT INTO public.configuracoes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "configuracoes select" ON public.configuracoes;
CREATE POLICY "configuracoes select" ON public.configuracoes FOR SELECT TO authenticated
  USING (public.email_confirmado());

DROP POLICY IF EXISTS "configuracoes update" ON public.configuracoes;
CREATE POLICY "configuracoes update" ON public.configuracoes FOR UPDATE TO authenticated
  USING (public.is_app_admin() AND public.email_confirmado())
  WITH CHECK (public.is_app_admin() AND public.email_confirmado());

GRANT SELECT, UPDATE ON public.configuracoes TO authenticated;

-- Carimbo de quem mexeu. `atualizado_por` não vem do cliente.
CREATE OR REPLACE FUNCTION public.configuracoes_carimbo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.id             := true;
  NEW.atualizado_em  := now();
  NEW.atualizado_por := coalesce(auth.uid(), OLD.atualizado_por);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_configuracoes_carimbo ON public.configuracoes;
CREATE TRIGGER trg_configuracoes_carimbo
  BEFORE UPDATE ON public.configuracoes
  FOR EACH ROW EXECUTE FUNCTION public.configuracoes_carimbo();

-- ------------------------------------------------------------
-- 2. A data que vale para o prazo
-- ------------------------------------------------------------
-- O banco roda em UTC e o congresso é em Lavras (UTC-3). Sem converter,
-- um prazo que termina "dia 31" fecharia às 21h do dia 30 no horário de
-- quem está submetendo — uma hora antes da meia-noite que a pessoa vê
-- na tela do painel.
CREATE OR REPLACE FUNCTION public.data_local()
RETURNS date
LANGUAGE sql STABLE
AS $$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date;
$$;
REVOKE ALL ON FUNCTION public.data_local() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.data_local() TO authenticated;

-- As submissões estão abertas?
--
-- Datas inclusivas nas duas pontas: um encerramento em 31/05 aceita
-- envio durante todo o dia 31.
--
-- SECURITY DEFINER porque o trigger precisa ler `configuracoes` em nome
-- de qualquer autor, e a policy de SELECT exige e-mail confirmado.
CREATE OR REPLACE FUNCTION public.submissoes_abertas()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT (c.submissoes_abertura IS NULL OR public.data_local() >= c.submissoes_abertura)
        AND (c.submissoes_encerramento IS NULL OR public.data_local() <= c.submissoes_encerramento)
       FROM public.configuracoes c WHERE c.id),
    -- Sem linha de configuração: sem prazo. Igual ao comportamento que
    -- existia antes desta migration.
    true);
$$;
REVOKE ALL ON FUNCTION public.submissoes_abertas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submissoes_abertas() TO authenticated;

-- O que a interface precisa saber sobre o prazo, numa ida só. `aberto`
-- é calculado NO SERVIDOR: o relógio do navegador não decide prazo.
CREATE OR REPLACE FUNCTION public.prazo_submissoes()
RETURNS TABLE(abertura date, encerramento date, aberto boolean, hoje date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.submissoes_abertura,
         c.submissoes_encerramento,
         public.submissoes_abertas(),
         public.data_local()
  FROM public.configuracoes c WHERE c.id;
$$;
REVOKE ALL ON FUNCTION public.prazo_submissoes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prazo_submissoes() TO authenticated;

-- ------------------------------------------------------------
-- 3. O prazo entra no trigger de proteção do trabalho
-- ------------------------------------------------------------
-- Reescrita da versão de 20260806120000, com um bloco a mais. O resto
-- é idêntico — está repetido porque CREATE OR REPLACE substitui o corpo
-- inteiro, e migration aplicada não se edita.
CREATE OR REPLACE FUNCTION public.protect_trabalhos_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Contexto de servidor (service_role/migrações) — não interfere.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Escrita automática do banco (aplicar_decisao / enviar_correcao).
  -- É AQUI que mora a exceção do "aprovado com correções": aquela RPC
  -- liga este GUC, então a rodada de correção nunca chega no teste de
  -- prazo logo abaixo.
  IF coalesce(current_setting('app.decisao_automatica', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Janela de submissão. A organização passa sempre: ela cadastra e
  -- ajusta trabalho fora do prazo por ofício.
  IF NOT public.is_event_staff() AND NOT public.submissoes_abertas() THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'O prazo de submissão está encerrado.'
        USING ERRCODE = 'check_violation';
    ELSE
      RAISE EXCEPTION 'O prazo de submissão está encerrado — o trabalho não pode mais ser editado.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_event_staff() THEN
      NEW.owner_id := auth.uid();
      NEW.status   := 'pendente';
    ELSIF NEW.owner_id IS NULL THEN
      NEW.owner_id := auth.uid();
    END IF;
  ELSE
    IF NOT public.is_event_staff() THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Somente a organização pode alterar o status do trabalho.';
      END IF;
      NEW.owner_id := OLD.owner_id;
      -- Autoria e categoria são imutáveis para o autor: definem os
      -- conflitos de interesse e os critérios já aplicados.
      NEW.orientador_email := OLD.orientador_email;
      NEW.coautores        := OLD.coautores;
      NEW.autores          := OLD.autores;
      NEW.categoria_id     := OLD.categoria_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_trabalhos ON public.trabalhos;
CREATE TRIGGER trg_protect_trabalhos
  BEFORE INSERT OR UPDATE ON public.trabalhos
  FOR EACH ROW EXECUTE FUNCTION public.protect_trabalhos_fields();

-- ------------------------------------------------------------
-- 4. Edição do próprio trabalho, dentro do prazo
-- ------------------------------------------------------------
-- Irmã de `enviar_correcao`, com o gatilho trocado: aquela exige
-- 'aprovado_correcoes' e ignora o prazo; esta exige 'pendente' e o
-- prazo aberto.
--
-- Mesmo conjunto de campos das duas: título, resumo e PDF. Autoria e
-- categoria continuam travadas mesmo com o prazo aberto, e não por
-- descuido — `distribuir_revisores` roda no INSTANTE da submissão, então
-- quando esta RPC é chamada os revisores JÁ foram escolhidos a partir do
-- orientador e dos coautores (é assim que o conflito de interesse é
-- barrado), e os critérios do parecer saem da categoria. Trocar qualquer
-- um dos dois depois da distribuição invalidaria em silêncio a checagem
-- de conflito. Abrir esses campos exige refazer a distribuição junto.
--
-- Sem `set_config('app.decisao_automatica')` de propósito: esta escrita
-- é do autor, não do banco, e deve continuar passando pelo trigger de
-- proteção — inclusive pelo teste de prazo.
CREATE OR REPLACE FUNCTION public.editar_submissao(
  _trabalho_id uuid,
  _titulo      text,
  _resumo      text,
  _pdf_url     text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t          public.trabalhos%ROWTYPE;
  v_pdf_novo text := nullif(trim(coalesce(_pdf_url, '')), '');
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
  IF coalesce(trim(_titulo), '') = '' OR coalesce(trim(_resumo), '') = '' THEN
    RAISE EXCEPTION 'Título e resumo são obrigatórios.';
  END IF;
  -- O PDF novo tem que estar na pasta do próprio autor, a mesma regra
  -- que a política de Storage aplica no upload.
  IF v_pdf_novo IS NOT NULL AND split_part(v_pdf_novo, '/', 1) <> auth.uid()::text THEN
    RAISE EXCEPTION 'Caminho de PDF inválido.';
  END IF;

  UPDATE public.trabalhos
     SET titulo  = trim(_titulo),
         resumo  = trim(_resumo),
         pdf_url = coalesce(v_pdf_novo, pdf_url)
   WHERE id = _trabalho_id;

  -- Caminho do arquivo substituído (NULL quando o PDF não mudou), para
  -- o cliente apagar o antigo do Storage.
  RETURN CASE
    WHEN v_pdf_novo IS NOT NULL AND t.pdf_url IS DISTINCT FROM v_pdf_novo THEN t.pdf_url
    ELSE NULL
  END;
END; $$;
REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_submissao(uuid, text, text, text) TO authenticated;
