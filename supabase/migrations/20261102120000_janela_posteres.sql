-- ============================================================
-- Janela de envio dos pôsteres
-- ------------------------------------------------------------
-- Pedido de 2026-11-02. A 20261027180000 abria o envio do pôster no
-- momento da divulgação dos resultados — e nunca mais fechava: a
-- organização não tinha como dizer "até quando". Agora o envio tem
-- janela própria, editada no card "Envio de Pôsteres" de
-- /admin/configuracoes, e deixa de depender da divulgação.
--
--   · DATE nas duas pontas, inclusivas, em America/Sao_Paulo
--     (`data_local()`) — o mesmo desenho do prazo de submissão.
--   · ⚠ O OPOSTO do prazo de submissão no vazio: sem as duas datas o
--     envio fica FECHADO. Lá "vazio = sem prazo" existe para a migration
--     não derrubar um fluxo no ar; aqui o pedido é justamente não deixar
--     o envio aberto para sempre. E só uma das duas não é aceita (CHECK):
--     "abre e nunca fecha" é o que esta migration veio tirar.
--   · As outras condições de `enviar_posteres` não mudam: dono, trabalho
--     em 'aprovado'/'aprovado_correcoes', exigência de pôster da
--     categoria, pasta `<uid>/`.
--   · A divulgação continua soltando os e-mails de resultado
--     (`resultados_devidos`); só deixou de abrir o pôster.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. As duas datas, na linha única de configurações
-- ------------------------------------------------------------
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS posteres_abertura DATE,
  ADD COLUMN IF NOT EXISTS posteres_encerramento DATE;

-- As duas juntas ou nenhuma, e na ordem certa. É o banco que recusa; a
-- tela só confere antes para dar a frase certa.
ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_janela_posteres;
ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_janela_posteres
  CHECK ((posteres_abertura IS NULL) = (posteres_encerramento IS NULL)
         AND (posteres_abertura IS NULL OR posteres_abertura <= posteres_encerramento));

COMMENT ON COLUMN public.configuracoes.posteres_abertura IS
  'Primeiro dia do envio de pôsteres (inclusivo, horário de Brasília). NULL junto com o encerramento = envio fechado.';
COMMENT ON COLUMN public.configuracoes.posteres_encerramento IS
  'Último dia do envio de pôsteres (inclusivo, horário de Brasília). NULL junto com a abertura = envio fechado.';

-- ------------------------------------------------------------
-- 2. "O envio está aberto?" — uma definição só
-- ------------------------------------------------------------
-- BETWEEN com ponta nula dá NULL, e o coalesce o fecha: sem janela, sem
-- envio. SECURITY DEFINER pelo mesmo motivo de `submissoes_abertas()`: a
-- policy de SELECT de `configuracoes` não é para o autor.
CREATE OR REPLACE FUNCTION public.posteres_abertos()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT public.data_local() BETWEEN c.posteres_abertura AND c.posteres_encerramento
       FROM public.configuracoes c WHERE c.id),
    false);
$$;
-- `FROM PUBLIC` não tira o grant direto do ALTER DEFAULT PRIVILEGES do
-- projeto (20260908120000): o REVOKE de anon é explícito.
REVOKE ALL ON FUNCTION public.posteres_abertos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.posteres_abertos() FROM anon;
GRANT EXECUTE ON FUNCTION public.posteres_abertos() TO authenticated;

-- O que a tela do autor precisa saber, numa ida só (espelho de
-- `prazo_submissoes()`). `aberto` vem DAQUI: o relógio do navegador não
-- decide prazo.
CREATE OR REPLACE FUNCTION public.prazo_posteres()
RETURNS TABLE(abertura date, encerramento date, aberto boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.posteres_abertura, c.posteres_encerramento, public.posteres_abertos()
  FROM public.configuracoes c WHERE c.id;
$$;
REVOKE ALL ON FUNCTION public.prazo_posteres() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prazo_posteres() FROM anon;
GRANT EXECUTE ON FUNCTION public.prazo_posteres() TO authenticated;

-- ------------------------------------------------------------
-- 3. `enviar_posteres` passa a olhar a janela
-- ------------------------------------------------------------
-- A da 20261027180000 com UMA troca: `resultados_divulgados()` virou
-- `posteres_abertos()`. O resto é palavra por palavra.
CREATE OR REPLACE FUNCTION public.enviar_posteres(_trabalho_id uuid, _anexos jsonb)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t        public.trabalhos%ROWTYPE;
  v_uid    uuid := auth.uid();
  v_lista  jsonb := coalesce(_anexos, '[]'::jsonb);
  d        RECORD;
  v_valor  text;
  v_atual  text;
  v_orfaos text[] := '{}'::text[];
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF jsonb_typeof(v_lista) <> 'array' THEN
    RAISE EXCEPTION 'Lista de anexos inválida.';
  END IF;

  -- Trabalho alheio responde igual a trabalho inexistente.
  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND OR t.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;

  IF NOT public.posteres_abertos() THEN
    RAISE EXCEPTION 'O envio de pôsteres está fechado.';
  END IF;

  IF t.status NOT IN ('aprovado', 'aprovado_correcoes') THEN
    RAISE EXCEPTION 'Só trabalhos aprovados enviam pôster.';
  END IF;

  -- Todo item tem de ser exigência de PÔSTER da categoria do trabalho: o
  -- cliente informa a escolha, jamais os atributos dela.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_lista) AS e
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categoria_anexos ca
      WHERE ca.id = nullif(e->>'anexo_id', '')::uuid
        AND ca.categoria_id = t.categoria_id
        AND ca.poster
    )
  ) THEN
    RAISE EXCEPTION 'A categoria deste trabalho não pede esse pôster.';
  END IF;

  FOR d IN
    SELECT ca.id, ca.titulo, ca.ordem
    FROM public.categoria_anexos ca
    WHERE ca.categoria_id = t.categoria_id
      AND ca.poster
    ORDER BY ca.ordem, ca.criado_em
  LOOP
    SELECT nullif(btrim(e->>'valor'), '') INTO v_valor
    FROM jsonb_array_elements(v_lista) AS e
    WHERE nullif(e->>'anexo_id', '')::uuid = d.id
    LIMIT 1;
    CONTINUE WHEN v_valor IS NULL;

    -- A mesma regra de pasta da policy de Storage e de `aplicar_anexos`.
    IF split_part(v_valor, '/', 1) <> v_uid::text THEN
      RAISE EXCEPTION 'Caminho de PDF inválido em "%".', d.titulo;
    END IF;

    SELECT ta.valor INTO v_atual
    FROM public.trabalho_anexos ta
    WHERE ta.trabalho_id = _trabalho_id AND ta.anexo_id = d.id;
    IF v_atual IS NOT NULL AND v_atual <> v_valor THEN
      v_orfaos := v_orfaos || v_atual;
    END IF;

    -- `criado_em` acompanha o arquivo: para o pôster, a data que interessa
    -- à organização é a do arquivo em vigor.
    INSERT INTO public.trabalho_anexos (trabalho_id, anexo_id, tipo, titulo, ordem, poster, valor)
    VALUES (_trabalho_id, d.id, 'pdf', d.titulo, d.ordem, true, v_valor)
    ON CONFLICT (trabalho_id, anexo_id) DO UPDATE
      SET tipo      = EXCLUDED.tipo,
          titulo    = EXCLUDED.titulo,
          ordem     = EXCLUDED.ordem,
          poster    = true,
          valor     = EXCLUDED.valor,
          criado_em = now();
  END LOOP;

  RETURN v_orfaos;
END; $$;
REVOKE ALL ON FUNCTION public.enviar_posteres(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_posteres(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_posteres(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 4. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_corpo text;
BEGIN
  SELECT p.prosrc INTO v_corpo FROM pg_proc p
   WHERE p.oid = 'public.enviar_posteres(uuid, jsonb)'::regprocedure;
  IF position('posteres_abertos' IN v_corpo) = 0 THEN
    RAISE EXCEPTION 'enviar_posteres não confere a janela de envio.';
  END IF;
  -- Os dois portões juntos fechariam o envio sempre que a janela começasse
  -- antes da divulgação — o oposto do pedido.
  IF position('resultados_divulgados' IN v_corpo) > 0 THEN
    RAISE EXCEPTION 'enviar_posteres voltou a depender da divulgação dos resultados.';
  END IF;
  IF position('aprovado_correcoes' IN v_corpo) = 0 THEN
    RAISE EXCEPTION 'enviar_posteres deixou de conferir que o trabalho foi aprovado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuracoes_janela_posteres'
       AND conrelid = 'public.configuracoes'::regclass
  ) THEN
    RAISE EXCEPTION 'Falta o CHECK da janela dos pôsteres.';
  END IF;

  IF has_function_privilege('anon', 'public.enviar_posteres(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.prazo_posteres()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.posteres_abertos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa uma função dos pôsteres — o REVOKE explícito não pegou.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.prazo_posteres()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.enviar_posteres(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE nas funções dos pôsteres: o autor não veria nem mandaria o pôster.';
  END IF;

  RAISE NOTICE 'OK: o pôster tem janela própria, fechada quando vazia.';
END $$;
