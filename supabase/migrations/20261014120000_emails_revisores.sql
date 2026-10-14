-- ============================================================
-- E-mails aos revisores pela conta congressoparaiso@ufla.br
-- ------------------------------------------------------------
-- O Brevo continua mandando SÓ a verificação de e-mail e a redefinição de
-- senha. Tudo o que é dirigido a REVISOR passa a sair da conta oficial da
-- UFLA, por um Apps Script (fonte em apps-script/emails-revisores.gs):
--
--   · designação — quando um co-chair clica "Enviar e-mails aos revisores"
--     em /co-chairs/atribuicoes (nunca no ato da associação);
--   · lembrete   — `alerta_horas` antes do fim do prazo das avaliações;
--   · atraso     — uma vez, quando o prazo vence.
--
-- Quem BUSCA é o Apps Script: a cada minuto ele chama a Edge Function
-- `emails-revisores`, que pede a `emails_devidos()` o que está devido. O
-- Supabase nunca chama o Google — assim não existe endpoint público capaz de
-- mandar e-mail arbitrário em nome da conta, e nada depende de a UFLA liberar
-- web app do Apps Script para "qualquer pessoa".
--
-- A regra (quem recebe o quê, e quando) mora AQUI. A Edge Function só monta
-- o texto e transporta; o Apps Script só envia.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. O prazo das avaliações
-- ------------------------------------------------------------
-- NULL = sem prazo = sem lembrete nem atraso — o mesmo "vazio não fecha nada"
-- do prazo de submissão. Por isso aplicar esta migration não dispara e-mail
-- nenhum: a coluna nasce vazia.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS revisoes_encerramento DATE;

COMMENT ON COLUMN public.configuracoes.revisoes_encerramento IS
  'Último dia para registrar parecer (inclusivo, horário de Brasília). '
  'Só move os e-mails de lembrete e de atraso; não trava parecer nenhum.';

-- `alerta_horas` existe desde a 20260813120000, gravado e lido por ninguém.
-- Agora ele abre a janela do lembrete, e zero horas seria uma janela vazia.
-- Valor inválido que já estivesse gravado nunca fez nada: volta ao padrão.
INSERT INTO public.configuracoes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
UPDATE public.configuracoes SET alerta_horas = 48 WHERE alerta_horas < 1;

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_alerta_horas_check;
ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_alerta_horas_check CHECK (alerta_horas >= 1);

-- ------------------------------------------------------------
-- 2. O estado do envio, por associação
-- ------------------------------------------------------------
-- `lembrete_prazo` e `atraso_prazo` guardam a DATA do prazo para a qual o
-- aviso saiu, não um booleano: prorrogar o prazo muda a data, e o ciclo
-- lembrete/atraso volta a valer para a nova sem ninguém precisar limpar nada.
ALTER TABLE public.trabalho_revisores
  ADD COLUMN IF NOT EXISTS aviso_solicitado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aviso_enviado_em    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lembrete_prazo      DATE,
  ADD COLUMN IF NOT EXISTS atraso_prazo        DATE;

COMMENT ON COLUMN public.trabalho_revisores.aviso_solicitado_em IS
  'Quando um co-chair liberou o e-mail de designação (solicitar_avisos_atribuicao).';
COMMENT ON COLUMN public.trabalho_revisores.aviso_enviado_em IS
  'Quando o e-mail de designação saiu da fila (emails_devidos). NULL = ainda não saiu.';
COMMENT ON COLUMN public.trabalho_revisores.lembrete_prazo IS
  'Prazo para o qual o lembrete já saiu. Diferente do prazo vigente = lembrete devido.';
COMMENT ON COLUMN public.trabalho_revisores.atraso_prazo IS
  'Prazo para o qual o aviso de atraso já saiu (uma vez por prazo).';

-- ------------------------------------------------------------
-- 3. "Ainda deve o parecer" — uma definição só
-- ------------------------------------------------------------
-- Usada pelo botão e pelos três tipos de e-mail. Associação da rodada
-- CORRENTE (a de uma rodada vencida não cobra ninguém), trabalho ainda em
-- avaliação (se o número de revisores baixou e o trabalho já foi para o
-- parecer editorial, o 3º parecer deixou de fazer falta) e nenhum parecer
-- deste revisor nesta rodada.
--
-- Argumentos escalares, e não a linha inteira: função com um argumento do
-- tipo de uma tabela vira "coluna computada" daquela tabela no PostgREST.
CREATE OR REPLACE FUNCTION public._parecer_pendente(
  _trabalho_id   uuid,
  _revisor_email text,
  _rodada        integer
)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.trabalhos t
            WHERE t.id = _trabalho_id
              AND t.rodada = _rodada
              AND t.status IN ('pendente', 'em_avaliacao'))
     AND NOT EXISTS (
           SELECT 1 FROM public.pareceres p
            WHERE p.trabalho_id = _trabalho_id
              AND p.rodada = _rodada
              AND lower(p.revisor_email) = lower(_revisor_email));
$$;
-- Interna: só as funções SECURITY DEFINER abaixo a chamam.
REVOKE ALL ON FUNCTION public._parecer_pendente(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._parecer_pendente(uuid, text, integer) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 4. O botão de Atribuições
-- ------------------------------------------------------------
-- Só LIBERA: marca as associações que ainda devem parecer e nunca foram
-- avisadas. Quem envia é o Apps Script, no minuto seguinte. Associação
-- criada depois do clique espera o próximo clique — é o co-chair quem
-- decide quando a distribuição está pronta para ser anunciada.
CREATE OR REPLACE FUNCTION public.solicitar_avisos_atribuicao()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revisores integer;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  WITH marcadas AS (
    UPDATE public.trabalho_revisores tr
       SET aviso_solicitado_em = now()
     WHERE tr.aviso_solicitado_em IS NULL
       AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
    RETURNING lower(tr.revisor_email) AS email
  )
  SELECT count(DISTINCT m.email) INTO v_revisores FROM marcadas m;

  -- Revisores, não associações: é quantos e-mails vão sair.
  RETURN v_revisores;
END; $$;
REVOKE ALL ON FUNCTION public.solicitar_avisos_atribuicao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solicitar_avisos_atribuicao() FROM anon;
GRANT EXECUTE ON FUNCTION public.solicitar_avisos_atribuicao() TO authenticated;

-- ------------------------------------------------------------
-- 5. A fila — o que o Apps Script busca (pela Edge Function)
-- ------------------------------------------------------------
-- Um e-mail por (tipo, revisor), listando os títulos. Cada linha devolvida
-- já sai MARCADA: o UPDATE ... RETURNING é a reserva, e a condição de
-- "ainda devido" fica no WHERE do próprio UPDATE — duas buscas simultâneas
-- não pegam a mesma associação (a segunda reavalia a linha e a pula).
--
-- Só cobra quem SABIA: lembrete só para quem foi avisado da designação antes
-- de a janela do lembrete abrir; atraso só para quem foi avisado antes de o
-- prazo vencer. Sem isso, um revisor associado tarde receberia "você está
-- atrasado" um minuto depois do e-mail que o designou.
--
-- ponytail: reserva antes de enviar. Se a Edge Function ou o Apps Script
-- morrer entre a reserva e o envio, aquele lote (no máximo `_limite`
-- revisores) se perde em silêncio; o que FALHA no envio volta por
-- `devolver_emails`. Se acontecer, o caminho é reserva + confirmação em
-- duas fases.
CREATE OR REPLACE FUNCTION public.emails_devidos(_limite integer DEFAULT 20)
RETURNS TABLE(
  tipo          text,
  revisor_email text,
  revisor_nome  text,
  associacoes   uuid[],
  titulos       text[],
  prazo         date
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
-- Os nomes do RETURNS TABLE também são variáveis aqui dentro e colidem com
-- colunas de trabalho_revisores (revisor_email, revisor_nome, tipo): toda
-- coluna abaixo vai qualificada pelo alias.
DECLARE
  v_resta  integer := least(greatest(coalesce(_limite, 20), 1), 50);
  v_prazo  date;
  v_horas  integer;
  v_fim    timestamptz;
  v_janela timestamptz;
  v_emails text[];
BEGIN
  SELECT c.revisoes_encerramento, c.alerta_horas
    INTO v_prazo, v_horas
    FROM public.configuracoes c
   WHERE c.id;

  -- Fim do último dia do prazo em Lavras: ponta inclusiva, como o prazo de
  -- submissão. Sem converter, o prazo "até dia 30" acabaria às 21h do dia 30.
  -- NULL quando não há prazo — e aí só a designação sai.
  v_fim    := (v_prazo + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_janela := v_fim - make_interval(hours => v_horas);

  -- a) Designação: o co-chair liberou e o e-mail ainda não saiu.
  SELECT array_agg(s.email) INTO v_emails FROM (
    SELECT DISTINCT lower(tr.revisor_email) AS email
      FROM public.trabalho_revisores tr
     WHERE tr.aviso_solicitado_em IS NOT NULL
       AND tr.aviso_enviado_em IS NULL
       AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
     ORDER BY 1
     LIMIT v_resta
  ) s;

  IF v_emails IS NOT NULL THEN
    RETURN QUERY
      WITH m AS (
        UPDATE public.trabalho_revisores tr
           SET aviso_enviado_em = now()
         WHERE lower(tr.revisor_email) = ANY (v_emails)
           AND tr.aviso_solicitado_em IS NOT NULL
           AND tr.aviso_enviado_em IS NULL
           AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
        RETURNING tr.id, lower(tr.revisor_email) AS email, tr.revisor_nome AS nome, tr.trabalho_id
      )
      SELECT 'atribuicao'::text, m.email, max(m.nome), array_agg(m.id),
             array_agg(t.titulo ORDER BY t.titulo), v_prazo
        FROM m JOIN public.trabalhos t ON t.id = m.trabalho_id
       GROUP BY m.email;
    v_resta := v_resta - cardinality(v_emails);
  END IF;

  IF v_prazo IS NULL OR v_resta <= 0 THEN
    RETURN;
  END IF;

  -- b) Lembrete: dentro da janela [fim − alerta_horas, fim), uma vez por prazo.
  IF now() >= v_janela AND now() < v_fim THEN
    SELECT array_agg(s.email) INTO v_emails FROM (
      SELECT DISTINCT lower(tr.revisor_email) AS email
        FROM public.trabalho_revisores tr
       WHERE tr.aviso_enviado_em < v_janela
         AND tr.lembrete_prazo IS DISTINCT FROM v_prazo
         AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
       ORDER BY 1
       LIMIT v_resta
    ) s;

    IF v_emails IS NOT NULL THEN
      RETURN QUERY
        WITH m AS (
          UPDATE public.trabalho_revisores tr
             SET lembrete_prazo = v_prazo
           WHERE lower(tr.revisor_email) = ANY (v_emails)
             AND tr.aviso_enviado_em < v_janela
             AND tr.lembrete_prazo IS DISTINCT FROM v_prazo
             AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
          RETURNING tr.id, lower(tr.revisor_email) AS email, tr.revisor_nome AS nome, tr.trabalho_id
        )
        SELECT 'lembrete'::text, m.email, max(m.nome), array_agg(m.id),
               array_agg(t.titulo ORDER BY t.titulo), v_prazo
          FROM m JOIN public.trabalhos t ON t.id = m.trabalho_id
         GROUP BY m.email;
    END IF;
  END IF;

  -- c) Atraso: o prazo venceu e o parecer não veio. Uma vez por prazo.
  IF now() >= v_fim THEN
    SELECT array_agg(s.email) INTO v_emails FROM (
      SELECT DISTINCT lower(tr.revisor_email) AS email
        FROM public.trabalho_revisores tr
       WHERE tr.aviso_enviado_em < v_fim
         AND tr.atraso_prazo IS DISTINCT FROM v_prazo
         AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
       ORDER BY 1
       LIMIT v_resta
    ) s;

    IF v_emails IS NOT NULL THEN
      RETURN QUERY
        WITH m AS (
          UPDATE public.trabalho_revisores tr
             SET atraso_prazo = v_prazo
           WHERE lower(tr.revisor_email) = ANY (v_emails)
             AND tr.aviso_enviado_em < v_fim
             AND tr.atraso_prazo IS DISTINCT FROM v_prazo
             AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
          RETURNING tr.id, lower(tr.revisor_email) AS email, tr.revisor_nome AS nome, tr.trabalho_id
        )
        SELECT 'atraso'::text, m.email, max(m.nome), array_agg(m.id),
               array_agg(t.titulo ORDER BY t.titulo), v_prazo
          FROM m JOIN public.trabalhos t ON t.id = m.trabalho_id
         GROUP BY m.email;
    END IF;
  END IF;
END; $$;
-- Só a Edge Function (service_role) busca a fila: buscar é reservar.
REVOKE ALL ON FUNCTION public.emails_devidos(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.emails_devidos(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emails_devidos(integer) TO service_role;

-- ------------------------------------------------------------
-- 6. O que não saiu volta para a fila
-- ------------------------------------------------------------
-- O Apps Script devolve as associações cujo envio falhou (cota do dia,
-- instabilidade do Google); a próxima busca, um minuto depois, as pega de novo.
CREATE OR REPLACE FUNCTION public.devolver_emails(_tipo text, _associacoes uuid[])
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF _tipo = 'atribuicao' THEN
    UPDATE public.trabalho_revisores tr SET aviso_enviado_em = NULL
     WHERE tr.id = ANY (_associacoes);
  ELSIF _tipo = 'lembrete' THEN
    UPDATE public.trabalho_revisores tr SET lembrete_prazo = NULL
     WHERE tr.id = ANY (_associacoes);
  ELSIF _tipo = 'atraso' THEN
    UPDATE public.trabalho_revisores tr SET atraso_prazo = NULL
     WHERE tr.id = ANY (_associacoes);
  ELSE
    RAISE EXCEPTION 'Tipo de e-mail desconhecido: %.', coalesce(_tipo, 'nulo');
  END IF;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.devolver_emails(text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.devolver_emails(text, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.devolver_emails(text, uuid[]) TO service_role;

-- ------------------------------------------------------------
-- 7. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sobrou text;
  v_check  boolean;
BEGIN
  -- `REVOKE ... FROM PUBLIC` não tira o grant DIRETO que o ALTER DEFAULT
  -- PRIVILEGES do projeto dá a anon/authenticated (20260908120000).
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_sobrou
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('emails_devidos', 'devolver_emails', '_parecer_pendente')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'Ficou executável pela API: %. Buscar a fila é reservá-la.', v_sobrou;
  END IF;

  IF NOT has_function_privilege('service_role', 'public.emails_devidos(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.devolver_emails(text, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role sem EXECUTE na fila: a Edge Function não conseguiria buscar nem devolver.';
  END IF;

  IF has_function_privilege('anon', 'public.solicitar_avisos_atribuicao()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa solicitar_avisos_atribuicao.';
  END IF;

  IF position('America/Sao_Paulo' IN (
       SELECT p.prosrc FROM pg_proc p
        WHERE p.oid = 'public.emails_devidos(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'emails_devidos deixou de fechar o prazo no fuso de Lavras.';
  END IF;

  -- O CHECK é quem manda. O UPDATE roda num subbloco: se o CHECK recusar,
  -- o subbloco desfaz; se aceitar, o RAISE de baixo derruba a migration.
  BEGIN
    UPDATE public.configuracoes SET alerta_horas = 0 WHERE id;
    v_check := false;
  EXCEPTION WHEN check_violation THEN
    v_check := true;
  END;
  IF NOT v_check THEN
    RAISE EXCEPTION 'O CHECK de alerta_horas caiu: 0 hora foi aceito.';
  END IF;

  RAISE NOTICE 'OK: fila de e-mails só para service_role, prazo em America/Sao_Paulo, alerta_horas >= 1.';
END $$;
