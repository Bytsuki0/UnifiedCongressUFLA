-- ============================================================
-- Liberação de e-mail: limites mais apertados
-- ============================================================
--
-- Substitui a função de 20260808220000 mudando SÓ a política de limite.
-- O resto do corpo é idêntico — está repetido aqui porque
-- `CREATE OR REPLACE FUNCTION` exige o corpo inteiro, e migration aplicada
-- não se edita.
--
-- 1. Limite por IP: 10 → **5 por 10 minutos**.
--
-- 2. Limite NOVO, por e-mail alvo: **5 remoções por hora**, e ele é
--    consumido apenas quando uma remoção realmente acontece.
--
-- Por que o segundo limite existe: o limite por IP não protege ninguém de
-- um atacante decidido, porque IP se troca. O ataque que sobra é bem
-- específico e é o único com dano real — escolher UMA vítima e apagar a
-- conta pendente dela repetidamente, para que o link de confirmação morra
-- antes de ela clicar, deixando-a sem conseguir se cadastrar nunca. Esse
-- ataque é definido pelo e-mail alvo, não pela origem, então é no e-mail
-- que o limite morde.
--
-- Por que ele é consumido só na remoção: assim uma conta CONFIRMADA pode
-- ser consultada à vontade sem gastar a cota de ninguém (a resposta é um
-- 'confirmado' que não muda nada), e a cota fica reservada para o que de
-- fato destrói estado. Um cadastro legítimo repetido gasta 1 por tentativa
-- real, e 5 por hora sobra para quem só está se atrapalhando.
--
-- Enumeração (decisão consciente, registrada): a RPC continua distinguindo
-- 'inexistente' de 'confirmado'. O GoTrue já responde "User already
-- registered" no signup, então a existência da conta nunca foi segredo; o
-- que se acrescenta é o bit "confirmada ou não". Uniformizar as respostas
-- não fecharia o canal — o efeito destrutivo já separa os estados — e
-- custaria a mensagem correta para quem só esqueceu que já tem conta.

CREATE OR REPLACE FUNCTION public.liberar_email_nao_confirmado(p_email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  v_ip    TEXT;
  v_id    UUID;
  v_conf  TIMESTAMPTZ;
BEGIN
  -- Nunca lança: como `confirmar_email`, todo desfecho é um valor que a
  -- tela sabe traduzir. Erro de verdade fica reservado para falha de rede.
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RETURN 'invalido';
  END IF;

  v_ip := coalesce(
    nullif(split_part(coalesce(current_setting('request.headers', true), '{}')::json->>'x-forwarded-for', ',', 1), ''),
    'unknown'
  );
  IF NOT public.consume_rate_limit('liberar_email:' || v_ip, 5, 600) THEN
    RETURN 'muitas_tentativas';
  END IF;

  SELECT u.id, p.email_confirmado_em
    INTO v_id, v_conf
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
   WHERE lower(u.email) = v_email;

  IF v_id IS NULL THEN
    -- O e-mail está livre: quem chamou errou o diagnóstico, não há o que fazer.
    RETURN 'inexistente';
  END IF;

  -- Confirmada = posse provada = intocável. É o caso do dono legítimo que
  -- esqueceu que já tem conta: a tela manda entrar, não cadastrar de novo.
  --
  -- Conta sem linha em `profiles` cai aqui como NÃO confirmada, e é o certo:
  -- sem perfil o `handle_new_user` falhou, `email_confirmado()` devolve false
  -- e a conta já não alcança nada — liberar o e-mail é o único desfecho útil.
  IF v_conf IS NOT NULL THEN
    RETURN 'confirmado';
  END IF;

  -- Não deveria existir (o gate barra `trabalhos insert`), mas se existir,
  -- a conta deixou de ser descartável e ninguém apaga submissão por engano.
  IF EXISTS (SELECT 1 FROM public.trabalhos t WHERE t.owner_id = v_id) THEN
    RETURN 'tem_dados';
  END IF;

  -- Daqui para baixo HÁ remoção. O limite por e-mail alvo é consumido só
  -- neste ponto: é o que impede apagar a conta pendente da mesma vítima
  -- repetidamente, de IPs diferentes, até ela desistir.
  IF NOT public.consume_rate_limit('liberar_email_alvo:' || v_email, 5, 3600) THEN
    RETURN 'muitas_tentativas';
  END IF;

  -- Fichas legadas ligadas por e-mail, escritas pelo próprio handle_new_user.
  -- Recortadas por user_id (não por e-mail): só sai o que ESTA conta criou.
  -- `avaliadores` fica de fora DE PROPÓSITO — aquela linha é da organização,
  -- não do cadastro, e um sequestrador não pode apagar revisor cadastrado.
  DELETE FROM public.estudantes  WHERE user_id = v_id;
  DELETE FROM public.professores WHERE user_id = v_id;

  -- O CASCADE de auth.users leva profiles, user_roles e tokens_email — os
  -- links pendentes daquela conta morrem junto, que é o desejado.
  DELETE FROM auth.users WHERE id = v_id;

  RETURN 'liberado';
END; $$;

COMMENT ON FUNCTION public.liberar_email_nao_confirmado(text) IS
  'Apaga a conta NÃO confirmada dona do e-mail, liberando-o para um novo cadastro. '
  'Retorna liberado|confirmado|inexistente|tem_dados|muitas_tentativas|invalido. '
  'Limites: 5 chamadas/10 min por IP e 5 REMOÇÕES/hora por e-mail alvo. '
  'Confirmar o e-mail é o que torna a posse definitiva.';

REVOKE ALL ON FUNCTION public.liberar_email_nao_confirmado(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liberar_email_nao_confirmado(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_corpo TEXT;
BEGIN
  IF NOT has_function_privilege('anon', 'public.liberar_email_nao_confirmado(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'liberar_email_nao_confirmado precisa seguir executável por anon.';
  END IF;

  SELECT prosrc INTO v_corpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'liberar_email_nao_confirmado';

  IF position('liberar_email_alvo:' IN v_corpo) = 0 THEN
    RAISE EXCEPTION 'o limite por e-mail alvo não entrou na função.';
  END IF;
  IF position(', 5, 600)' IN v_corpo) = 0 THEN
    RAISE EXCEPTION 'o limite por IP não ficou em 5/10 min.';
  END IF;

  RAISE NOTICE 'OK: limites da liberação = 5/10min por IP e 5/hora por e-mail alvo.';
END $$;
