-- ============================================================
-- Liberar e-mail preso por conta NÃO confirmada
-- ============================================================
--
-- Problema que esta migration fecha:
--
--   Qualquer pessoa podia digitar o e-mail de outra no /cadastro e nunca
--   confirmar. A conta ficava lá, e o GoTrue passava a responder
--   "User already registered" para o DONO do endereço — que ficava sem
--   conseguir se cadastrar, para sempre, sem nada a fazer sozinho.
--   Sequestro de cadastro: barato de executar, permanente, e o alvo é
--   justamente quem tem direito ao endereço.
--
-- A regra passa a ser: **um e-mail só fica realmente ocupado quando a posse
-- da caixa é provada** — isto é, quando o link de confirmação é clicado.
-- Enquanto a conta não confirmou, ela não pertence a ninguém: o cadastro
-- seguinte com o mesmo e-mail apaga a pendente e cria a sua no lugar.
--
-- Por que apagar é seguro (e não destrói dado de ninguém):
--   · conta não confirmada não passa pelo gate de `email_confirmado()` —
--     não submete trabalho, não se inscreve, não emite certificado;
--   · a partir desta migration ela também não grava mais no Storage
--     (resíduo §2.5 das notas, fechado abaixo na parte 2);
--   · ainda assim a função RECUSA a liberação se houver trabalho da conta
--     (`tem_dados`) — cinto e suspensório: nunca apagamos submissão.
--
-- Por que NÃO é "tomar posse" da conta pendente (trocar a senha e reusar o
-- id): se o invasor definisse a senha e o dono clicasse no link que está na
-- caixa DELE, a conta seria confirmada com a senha do invasor. Apagar e
-- recriar não tem essa aresta — o id é outro, a senha é a de quem cadastrou
-- por último, e o link antigo morre junto com o token (CASCADE).
--
-- Enumeração: o GoTrue já entrega "User already registered" hoje, então a
-- existência da conta não é segredo novo. O que esta função acrescenta é o
-- estado "confirmada ou não" — contido por limite de 10 chamadas / 10 min
-- por IP, o mesmo mecanismo de `verify_certificate` (SEC-08).

-- ------------------------------------------------------------
-- 1. A função
-- ------------------------------------------------------------
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
  IF NOT public.consume_rate_limit('liberar_email:' || v_ip, 10, 600) THEN
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
  'Confirmar o e-mail é o que torna a posse definitiva.';

-- `anon` é o papel de quem está no /cadastro (sem sessão); `authenticated`
-- entra porque a página pode estar aberta com sessão de outra conta.
REVOKE ALL ON FUNCTION public.liberar_email_nao_confirmado(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liberar_email_nao_confirmado(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 2. Resíduo §2.5 fechado: conta não confirmada não grava no Storage
-- ------------------------------------------------------------
-- Até aqui `pdfs owner insert` era a única policy de escrita sem gate — o
-- ramo é só "minha própria pasta", então o gate parcial da Etapa 1 seria um
-- no-op e ficou de fora. Agora ele deixou de ser inofensivo: se a conta
-- pendente pode subir arquivo, liberar o e-mail deixaria blob órfão em
-- bucket privado, sem dono e sem linha em `trabalhos` que o alcance.
--
-- Com o gate, o upload passa a exigir e-mail confirmado — que é a mesma
-- exigência de `trabalhos insert`, onde o arquivo ia ser referenciado.
DROP POLICY IF EXISTS "pdfs owner insert" ON storage.objects;
CREATE POLICY "pdfs owner insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'Pdfs'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.email_confirmado()
  );

-- ------------------------------------------------------------
-- 3. Conferência (aborta a migration se algo não bater)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_grant_anon BOOLEAN;
  v_policy     TEXT;
BEGIN
  v_grant_anon := has_function_privilege('anon', 'public.liberar_email_nao_confirmado(text)', 'EXECUTE');
  IF NOT v_grant_anon THEN
    RAISE EXCEPTION 'liberar_email_nao_confirmado precisa ser executável por anon (o /cadastro não tem sessão).';
  END IF;

  SELECT with_check INTO v_policy
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'pdfs owner insert';
  IF v_policy IS NULL OR position('email_confirmado' IN v_policy) = 0 THEN
    RAISE EXCEPTION 'pdfs owner insert ficou sem o gate de e-mail confirmado.';
  END IF;

  RAISE NOTICE 'OK: liberar_email_nao_confirmado criada e pdfs owner insert gateada.';
END $$;
