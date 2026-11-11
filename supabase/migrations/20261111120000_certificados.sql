-- ============================================================
-- Certificados
-- ============================================================
-- A organização sobe um PNG por USO em /co-chairs/certificados, posiciona
-- caixas de texto com variáveis ({titulo}, {autores}, {nome}…) e cada
-- destinatário baixa o seu no próprio portal. O PNG final é desenhado no
-- NAVEGADOR (canvas), sob demanda: nada gerado é guardado.
--
-- Seis usos:
--   base      todo trabalho aprovado / aprovado com correções (um por trabalho)
--   primeiro, segundo, terceiro   o pódio de cada categoria (um por trabalho)
--   revisao   quem emitiu ao menos um parecer            (um por pessoa)
--   avaliacao quem deu ao menos uma nota ao vivo         (um por pessoa)
--
-- LIBERAÇÃO (decisão do usuário):
--   · só sai o que um co-chair PUBLICOU;
--   · publicado antes da data (`configuracoes.certificados_liberacao`)
--     espera por ela; publicado depois sai na hora;
--   · mudar a data NUNCA recolhe o que já saiu — `liberado_em` é a trava;
--   · publicado e ainda não liberado segue a data nova.
--
-- O certificado de professor nunca cita o trabalho: a revisão é às cegas, e
-- um arquivo com nome + título revelaria o revisor a quem o recebesse.

-- ------------------------------------------------------------
-- 1. A data da liberação
-- ------------------------------------------------------------
-- TIMESTAMP sem fuso, lido como Brasília só no servidor — o mesmo desenho
-- de `resultados_divulgacao`. NULL = nada é liberado pela data.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS certificados_liberacao timestamp;

COMMENT ON COLUMN public.configuracoes.certificados_liberacao IS
  'Momento em que os certificados PUBLICADOS ficam disponíveis, hora de Brasília (sem fuso). NULL = nada sai.';

CREATE OR REPLACE FUNCTION public.certificados_data_chegou()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT now() >= (c.certificados_liberacao AT TIME ZONE 'America/Sao_Paulo')
       FROM public.configuracoes c
      WHERE c.id),
    false);
$$;
REVOKE ALL ON FUNCTION public.certificados_data_chegou() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.certificados_data_chegou() FROM anon;
GRANT EXECUTE ON FUNCTION public.certificados_data_chegou() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. O bucket — modelos e fontes
-- ------------------------------------------------------------
-- `modelos/<uso>-<epoch>.png` e `fontes/<nome>.<ext>`. As fontes NÃO têm
-- tabela: a lista é o conteúdo da pasta (mesmo desenho do bucket
-- `programacao`). Leitura para todo autenticado confirmado: quem baixa o
-- certificado precisa assinar a URL do modelo e das fontes para desenhar.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificados', 'certificados', false, 20971520,
        ARRAY['image/png', 'font/ttf', 'font/otf', 'font/woff2'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "certificados read"         ON storage.objects;
DROP POLICY IF EXISTS "certificados staff write"  ON storage.objects;
DROP POLICY IF EXISTS "certificados staff delete" ON storage.objects;

CREATE POLICY "certificados read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'certificados' AND public.email_confirmado());
-- Sem policy de UPDATE: o upload nunca sobrescreve (nome novo a cada envio).
CREATE POLICY "certificados staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificados' AND public.is_event_staff() AND public.email_confirmado());
CREATE POLICY "certificados staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'certificados' AND public.is_event_staff() AND public.email_confirmado());

-- ------------------------------------------------------------
-- 3. Os modelos — um por uso
-- ------------------------------------------------------------
-- `caixas` = [{ x, y, l, a, texto, fonte, tamanho, cor, alinhamento }], com
-- posição, medidas e tamanho de fonte em FRAÇÃO da imagem: a prévia e o
-- arquivo final desenham igual em qualquer escala.
CREATE TABLE IF NOT EXISTS public.certificado_modelos (
  uso           text PRIMARY KEY
                CHECK (uso IN ('base', 'primeiro', 'segundo', 'terceiro', 'revisao', 'avaliacao')),
  imagem        text NOT NULL CHECK (btrim(imagem) <> ''),
  largura       integer NOT NULL CHECK (largura > 0),
  altura        integer NOT NULL CHECK (altura > 0),
  caixas        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(caixas) = 'array'),
  publicado_em  timestamptz,
  -- A trava: preenchido, o certificado saiu e não volta.
  liberado_em   timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certificado_modelos_liberado_check
    CHECK (liberado_em IS NULL OR publicado_em IS NOT NULL)
);

ALTER TABLE public.certificado_modelos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "certificado_modelos select" ON public.certificado_modelos;
CREATE POLICY "certificado_modelos select" ON public.certificado_modelos FOR SELECT TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado());
DROP POLICY IF EXISTS "certificado_modelos insert" ON public.certificado_modelos;
CREATE POLICY "certificado_modelos insert" ON public.certificado_modelos FOR INSERT TO authenticated
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());
DROP POLICY IF EXISTS "certificado_modelos update" ON public.certificado_modelos;
CREATE POLICY "certificado_modelos update" ON public.certificado_modelos FOR UPDATE TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

-- ⚠ Grant por COLUNA: a tela grava a arte e as caixas; `publicado_em` e
-- `liberado_em` só mudam pelas RPCs. Sem isso um UPDATE direto pela API
-- recolheria um certificado já liberado (ou liberaria um antes da data).
-- Sem DELETE: apagar um modelo liberado seria recolhê-lo; troca-se a arte.
REVOKE ALL ON public.certificado_modelos FROM anon, authenticated;
GRANT SELECT ON public.certificado_modelos TO authenticated;
GRANT INSERT (uso, imagem, largura, altura, caixas) ON public.certificado_modelos TO authenticated;
GRANT UPDATE (imagem, largura, altura, caixas, atualizado_em) ON public.certificado_modelos TO authenticated;

-- "Está liberado?" — uma definição só, usada pelo portal e pela fila.
CREATE OR REPLACE FUNCTION public._certificado_liberado(_publicado timestamptz, _liberado timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _publicado IS NOT NULL
     AND (_liberado IS NOT NULL OR public.certificados_data_chegou());
$$;
REVOKE ALL ON FUNCTION public._certificado_liberado(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._certificado_liberado(timestamptz, timestamptz) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 4. O ranking — agora em SQL, e fonte única
-- ------------------------------------------------------------
-- Era `rankingPorCategoria` no cliente. O pódio congelado precisa da conta
-- no servidor, e duas contas discordariam: a tela de resultados passou a
-- ler esta função.
--
-- Pontos = metade da REVISÃO (média dos itens[].nota dos pareceres da
-- rodada corrente) + metade do AO VIVO (média das médias de cada
-- avaliador); a metade que não existe vale 0.
-- ⚠ Desempate: maior nota AO VIVO → mais avaliações ao vivo → título.
CREATE OR REPLACE FUNCTION public.ranking_evento()
RETURNS TABLE(
  trabalho_id  uuid,
  categoria_id uuid,
  titulo       text,
  autores      text,
  revisao      numeric,
  evento       numeric,
  avaliacoes   integer,
  pontos       numeric,
  posicao      integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH rev AS (
    SELECT pa.trabalho_id AS id, avg((i.item->>'nota')::numeric) AS media
      FROM public.trabalhos t
      JOIN public.pareceres pa ON pa.trabalho_id = t.id AND pa.rodada = t.rodada
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(pa.itens) = 'array' THEN pa.itens ELSE '[]'::jsonb END
      ) AS i(item)
     WHERE i.item->>'nota' ~ '^[0-9]+(\.[0-9]+)?$'
     GROUP BY pa.trabalho_id
  ), vivo AS (
    SELECT ae.trabalho_id AS id, avg(ae.media) AS media, count(*)::integer AS n
      FROM public.avaliacoes_evento ae
     GROUP BY ae.trabalho_id
  )
  SELECT t.id, t.categoria_id, t.titulo, t.autores,
         r.media, v.media, coalesce(v.n, 0),
         (coalesce(r.media, 0) + coalesce(v.media, 0)) / 2,
         row_number() OVER (
           PARTITION BY t.categoria_id
           ORDER BY coalesce(r.media, 0) + coalesce(v.media, 0) DESC,
                    coalesce(v.media, 0) DESC,
                    coalesce(v.n, 0) DESC,
                    t.titulo, t.id
         )::integer
    FROM public.trabalhos t
    LEFT JOIN rev  r ON r.id = t.id
    LEFT JOIN vivo v ON v.id = t.id
   WHERE t.status IN ('aprovado', 'aprovado_correcoes')
     AND public.is_event_staff() AND public.email_confirmado();
$$;
REVOKE ALL ON FUNCTION public.ranking_evento() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ranking_evento() FROM anon;
GRANT EXECUTE ON FUNCTION public.ranking_evento() TO authenticated;

-- ------------------------------------------------------------
-- 5. O pódio congelado
-- ------------------------------------------------------------
-- O ranking se move enquanto há nota entrando; o certificado de colocação
-- não pode. `congelar_podio()` copia o top 3 de cada categoria, e só ela
-- grava aqui. `categoria_nome` é CÓPIA: renomear ou apagar a categoria não
-- muda certificado emitido.
CREATE TABLE IF NOT EXISTS public.certificado_podio (
  categoria_id   uuid NOT NULL,
  posicao        smallint NOT NULL CHECK (posicao BETWEEN 1 AND 3),
  trabalho_id    uuid NOT NULL REFERENCES public.trabalhos(id) ON DELETE CASCADE,
  categoria_nome text NOT NULL,
  congelado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (categoria_id, posicao)
);
ALTER TABLE public.certificado_podio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "certificado_podio select" ON public.certificado_podio;
CREATE POLICY "certificado_podio select" ON public.certificado_podio FOR SELECT TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado());
REVOKE ALL ON public.certificado_podio FROM anon, authenticated;
GRANT SELECT ON public.certificado_podio TO authenticated;

CREATE OR REPLACE FUNCTION public.congelar_podio()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT (public.is_event_staff() AND public.email_confirmado()) THEN
    RAISE EXCEPTION 'Apenas a organização congela o pódio.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.certificado_podio WHERE true;
  -- Trabalho sem ponto nenhum não sobe ao pódio só por ser o único da categoria.
  INSERT INTO public.certificado_podio (categoria_id, posicao, trabalho_id, categoria_nome)
  SELECT r.categoria_id, r.posicao, r.trabalho_id, c.nome
    FROM public.ranking_evento() r
    JOIN public.categorias c ON c.id = r.categoria_id
   WHERE r.posicao <= 3 AND r.pontos > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.congelar_podio() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.congelar_podio() FROM anon;
GRANT EXECUTE ON FUNCTION public.congelar_podio() TO authenticated;

-- ------------------------------------------------------------
-- 6. Quem recebe o quê — uma definição só
-- ------------------------------------------------------------
-- A prévia dos co-chairs, o download de cada pessoa e a fila de e-mail
-- passam por aqui: o que a prévia mostra é o que sai.
-- `chave` distingue os certificados de uma mesma pessoa num mesmo uso (o
-- id do trabalho; para professor, o id dele).
CREATE OR REPLACE FUNCTION public._certificados(_uso text)
RETURNS TABLE(user_id uuid, chave text, variaveis jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.owner_id, t.id::text,
         jsonb_build_object(
           'titulo',     t.titulo,
           'autores',    t.autores,
           'categoria',  coalesce(c.nome, ''),
           'orientador', coalesce(t.orientador_nome, ''))
    FROM public.trabalhos t
    LEFT JOIN public.categorias c ON c.id = t.categoria_id
   WHERE _uso = 'base'
     AND t.owner_id IS NOT NULL
     AND t.status IN ('aprovado', 'aprovado_correcoes')
  UNION ALL
  SELECT t.owner_id, t.id::text,
         jsonb_build_object(
           'titulo',     t.titulo,
           'autores',    t.autores,
           'categoria',  p.categoria_nome,
           'orientador', coalesce(t.orientador_nome, ''),
           'colocacao',  p.posicao || 'º')
    FROM public.certificado_podio p
    JOIN public.trabalhos t ON t.id = p.trabalho_id
   WHERE p.posicao = CASE _uso WHEN 'primeiro' THEN 1 WHEN 'segundo' THEN 2 WHEN 'terceiro' THEN 3 END
     AND t.owner_id IS NOT NULL
  UNION ALL
  SELECT u.id, u.id::text,
         jsonb_build_object(
           'nome',       coalesce(nullif(btrim(pf.nome), ''), x.nome, ''),
           'quantidade', x.n::text)
    FROM (SELECT lower(pa.revisor_email) AS email,
                 count(DISTINCT pa.trabalho_id) AS n,
                 max(pa.revisor_nome) AS nome
            FROM public.pareceres pa
           GROUP BY 1) x
    JOIN auth.users u ON lower(u.email) = x.email
    LEFT JOIN public.profiles pf ON pf.id = u.id
   WHERE _uso = 'revisao'
  UNION ALL
  SELECT a.avaliador_id, a.avaliador_id::text,
         jsonb_build_object(
           'nome',       coalesce(nullif(btrim(pf.nome), ''), ''),
           'quantidade', a.n::text)
    FROM (SELECT ae.avaliador_id, count(*) AS n
            FROM public.avaliacoes_evento ae
           GROUP BY 1) a
    LEFT JOIN public.profiles pf ON pf.id = a.avaliador_id
   WHERE _uso = 'avaliacao';
$$;
REVOKE ALL ON FUNCTION public._certificados(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._certificados(text) FROM anon, authenticated;

-- A prévia: todos os destinatários de um uso, publicado ou não.
CREATE OR REPLACE FUNCTION public.previa_certificados(_uso text)
RETURNS TABLE(chave text, variaveis jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.chave, c.variaveis
    FROM public._certificados(_uso) c
   WHERE public.is_event_staff() AND public.email_confirmado()
   ORDER BY coalesce(c.variaveis->>'titulo', c.variaveis->>'nome'), c.chave;
$$;
REVOKE ALL ON FUNCTION public.previa_certificados(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.previa_certificados(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.previa_certificados(text) TO authenticated;

-- O portal: só os de quem chama, e só de modelo LIBERADO.
CREATE OR REPLACE FUNCTION public.meus_certificados()
RETURNS TABLE(
  uso       text,
  chave     text,
  variaveis jsonb,
  imagem    text,
  largura   integer,
  altura    integer,
  caixas    jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.uso, c.chave, c.variaveis, m.imagem, m.largura, m.altura, m.caixas
    FROM public.certificado_modelos m
   CROSS JOIN LATERAL public._certificados(m.uso) c
   WHERE c.user_id = auth.uid()
     AND public.email_confirmado()
     AND public._certificado_liberado(m.publicado_em, m.liberado_em)
   ORDER BY m.uso, c.variaveis->>'titulo';
$$;
REVOKE ALL ON FUNCTION public.meus_certificados() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meus_certificados() FROM anon;
GRANT EXECUTE ON FUNCTION public.meus_certificados() TO authenticated;

-- ------------------------------------------------------------
-- 7. Publicar, despublicar e a trava da data
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publicar_certificado(_uso text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_event_staff() AND public.email_confirmado()) THEN
    RAISE EXCEPTION 'Apenas a organização publica certificados.' USING ERRCODE = '42501';
  END IF;

  -- Certificado de colocação sem pódio não teria destinatário.
  IF _uso IN ('primeiro', 'segundo', 'terceiro')
     AND NOT EXISTS (SELECT 1 FROM public.certificado_podio) THEN
    PERFORM public.congelar_podio();
  END IF;

  -- Depois da data, publicar é liberar na hora — e travar.
  UPDATE public.certificado_modelos m
     SET publicado_em = coalesce(m.publicado_em, now()),
         liberado_em  = coalesce(m.liberado_em,
                                 CASE WHEN public.certificados_data_chegou() THEN now() END)
   WHERE m.uso = _uso;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Envie o modelo antes de publicar.';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.publicar_certificado(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publicar_certificado(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.publicar_certificado(text) TO authenticated;

-- Só enquanto não saiu: depois de liberado não há volta.
CREATE OR REPLACE FUNCTION public.despublicar_certificado(_uso text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_event_staff() AND public.email_confirmado()) THEN
    RAISE EXCEPTION 'Apenas a organização despublica certificados.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.certificado_modelos m
     SET publicado_em = NULL
   WHERE m.uso = _uso
     AND NOT public._certificado_liberado(m.publicado_em, m.liberado_em);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este certificado já foi liberado e não pode ser recolhido.';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.despublicar_certificado(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.despublicar_certificado(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.despublicar_certificado(text) TO authenticated;

-- ⚠ "Mudar a data não recolhe o que já saiu": se a data ANTIGA já tinha
-- passado, os publicados são travados ANTES de a nova valer. É trigger, e
-- não código do SALVAR do admin, para valer também no UPDATE direto.
CREATE OR REPLACE FUNCTION public.trava_certificados_liberados()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.certificados_liberacao IS NOT NULL
     AND now() >= (OLD.certificados_liberacao AT TIME ZONE 'America/Sao_Paulo') THEN
    UPDATE public.certificado_modelos m
       SET liberado_em = OLD.certificados_liberacao AT TIME ZONE 'America/Sao_Paulo'
     WHERE m.publicado_em IS NOT NULL
       AND m.liberado_em IS NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_trava_certificados ON public.configuracoes;
CREATE TRIGGER trg_trava_certificados
  BEFORE UPDATE ON public.configuracoes
  FOR EACH ROW
  WHEN (OLD.certificados_liberacao IS DISTINCT FROM NEW.certificados_liberacao)
  EXECUTE FUNCTION public.trava_certificados_liberados();

-- ------------------------------------------------------------
-- 8. O e-mail de aviso
-- ------------------------------------------------------------
-- Irmã de `envios_resultados`. Um e-mail por pessoa por LEVA: `usos` guarda
-- o que aquele e-mail avisou, e a pessoa só volta à fila quando um uso que
-- nenhum envio dela cobre for liberado (ex.: o modelo dos professores
-- publicado depois dos demais).
CREATE TABLE IF NOT EXISTS public.envios_certificados (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sem FK: purgar a conta não apaga o histórico do envio.
  user_id      uuid NOT NULL,
  email        text NOT NULL,
  nome         text,
  usos         text[] NOT NULL,
  status       text NOT NULL DEFAULT 'reservado'
               CHECK (status IN ('reservado', 'enviado', 'falha')),
  erro         text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS envios_certificados_user_idx
  ON public.envios_certificados (user_id);

ALTER TABLE public.envios_certificados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "envios_certificados select" ON public.envios_certificados;
CREATE POLICY "envios_certificados select" ON public.envios_certificados FOR SELECT TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado());
REVOKE ALL ON public.envios_certificados FROM anon, authenticated;
GRANT SELECT ON public.envios_certificados TO authenticated;

-- Buscar é RESERVAR, como nas outras filas. Não há índice único que caiba
-- em "um por leva", então a exclusão é um advisory lock: duas buscas
-- simultâneas entram em fila em vez de reservar a mesma pessoa.
CREATE OR REPLACE FUNCTION public.certificados_devidos(_limite integer DEFAULT 20)
RETURNS TABLE(envio_id uuid, para text, para_nome text, avisados text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_limite integer := least(greatest(coalesce(_limite, 20), 1), 50);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('certificados_devidos'));

  RETURN QUERY
  WITH devido AS (
    SELECT c.user_id, array_agg(DISTINCT m.uso ORDER BY m.uso) AS usos
      FROM public.certificado_modelos m
     CROSS JOIN LATERAL public._certificados(m.uso) c
     WHERE public._certificado_liberado(m.publicado_em, m.liberado_em)
       AND NOT EXISTS (
             SELECT 1 FROM public.envios_certificados e
              WHERE e.user_id = c.user_id
                AND e.status IN ('reservado', 'enviado')
                AND m.uso = ANY (e.usos))
     GROUP BY c.user_id
    HAVING (SELECT count(*) FROM public.envios_certificados e
             WHERE e.user_id = c.user_id AND e.status = 'falha') < 3
     ORDER BY c.user_id
     LIMIT v_limite
  ), novos AS (
    INSERT INTO public.envios_certificados AS e (user_id, email, nome, usos)
    SELECT d.user_id, lower(u.email), nullif(btrim(pf.nome), ''), d.usos
      FROM devido d
      JOIN auth.users u ON u.id = d.user_id
      LEFT JOIN public.profiles pf ON pf.id = d.user_id
     WHERE u.email IS NOT NULL
    RETURNING e.id, e.email, e.nome, e.usos
  )
  SELECT n.id, n.email, n.nome, n.usos FROM novos n ORDER BY n.email;
END; $$;
REVOKE ALL ON FUNCTION public.certificados_devidos(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.certificados_devidos(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.certificados_devidos(integer) TO service_role;

-- ------------------------------------------------------------
-- 9. `concluir_envios` fecha os quatro registros
-- ------------------------------------------------------------
-- O corpo é o da 20261104120000, palavra por palavra; o que entra é o
-- último UPDATE. Falha de certificado não precisa de devolução: a linha
-- vira 'falha', deixa de cobrir os usos, e a fila a pega de novo (até a 3ª).
CREATE OR REPLACE FUNCTION public.concluir_envios(_resultados jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  r   record;
BEGIN
  FOR r IN
    UPDATE public.envios_revisores en
       SET status       = CASE WHEN x.erro IS NULL THEN 'enviado' ELSE 'falha' END,
           erro         = x.erro,
           concluido_em = now()
      FROM (SELECT (j->>'id')::uuid AS id,
                   nullif(left(j->>'erro', 500), '') AS erro
              FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) j) x
     WHERE en.id = x.id
       AND en.status = 'reservado'
    RETURNING en.tipo, en.associacoes, en.status
  LOOP
    v_n := v_n + 1;
    CONTINUE WHEN r.status = 'enviado';

    IF r.tipo = 'atribuicao' THEN
      -- `aviso_enviado_em IS NOT NULL`: se o co-chair reenviou enquanto este
      -- envio estava no ar, a associação já está de volta à fila — não a tira.
      UPDATE public.trabalho_revisores tr
         SET aviso_solicitado_em = NULL, aviso_enviado_em = NULL
       WHERE tr.id = ANY (r.associacoes)
         AND tr.aviso_enviado_em IS NOT NULL;
    ELSIF r.tipo = 'lembrete' THEN
      UPDATE public.trabalho_revisores tr SET lembrete_prazo = NULL
       WHERE tr.id = ANY (r.associacoes);
    ELSE
      UPDATE public.trabalho_revisores tr SET atraso_prazo = NULL
       WHERE tr.id = ANY (r.associacoes);
    END IF;
  END LOOP;

  -- Os resultados aos autores (migration 20261027120000).
  WITH x AS (
    SELECT (j->>'id')::uuid AS id,
           nullif(left(j->>'erro', 500), '') AS erro
      FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) j
  ), fechados AS (
    UPDATE public.envios_resultados er
       SET status       = CASE WHEN x.erro IS NULL THEN 'enviado' ELSE 'falha' END,
           erro         = x.erro,
           concluido_em = now()
      FROM x
     WHERE er.id = x.id
       AND er.status = 'reservado'
    RETURNING er.id
  )
  SELECT v_n + count(*) INTO v_n FROM fechados;

  -- O cronograma de apresentações (migration 20261104120000).
  WITH x AS (
    SELECT (j->>'id')::uuid AS id,
           nullif(left(j->>'erro', 500), '') AS erro
      FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) j
  ), fechados AS (
    UPDATE public.envios_apresentacoes ea
       SET status       = CASE WHEN x.erro IS NULL THEN 'enviado' ELSE 'falha' END,
           erro         = x.erro,
           concluido_em = now()
      FROM x
     WHERE ea.id = x.id
       AND ea.status = 'reservado'
    RETURNING ea.trabalhos_ids, ea.status, ea.criado_em
  ), devolvidos AS (
    -- Comando de escrita no WITH roda inteiro mesmo sem ser lido abaixo.
    UPDATE public.apresentacoes a
       SET aviso_reservado_em = NULL
      FROM fechados f
     WHERE f.status = 'falha'
       AND a.trabalho_id = ANY (f.trabalhos_ids)
       AND a.aviso_reservado_em = f.criado_em
    RETURNING a.id
  )
  SELECT v_n + count(*) INTO v_n FROM fechados;

  -- Os avisos de certificado (migration 20261111120000).
  WITH x AS (
    SELECT (j->>'id')::uuid AS id,
           nullif(left(j->>'erro', 500), '') AS erro
      FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) j
  ), fechados AS (
    UPDATE public.envios_certificados ec
       SET status       = CASE WHEN x.erro IS NULL THEN 'enviado' ELSE 'falha' END,
           erro         = x.erro,
           concluido_em = now()
      FROM x
     WHERE ec.id = x.id
       AND ec.status = 'reservado'
    RETURNING ec.id
  )
  SELECT v_n + count(*) INTO v_n FROM fechados;

  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.concluir_envios(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.concluir_envios(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concluir_envios(jsonb) TO service_role;

-- ------------------------------------------------------------
-- 10. Canários
-- ------------------------------------------------------------
DO $$
DECLARE
  v_src    text;
  v_sobrou text;
  f        text;
BEGIN
  -- anon não executa nada daqui (o ALTER DEFAULT PRIVILEGES do projeto
  -- concede grant DIRETO; só o REVOKE explícito o tira).
  FOREACH f IN ARRAY ARRAY[
    'public.certificados_data_chegou()', 'public._certificado_liberado(timestamptz, timestamptz)',
    'public.ranking_evento()', 'public.congelar_podio()', 'public._certificados(text)',
    'public.previa_certificados(text)', 'public.meus_certificados()',
    'public.publicar_certificado(text)', 'public.despublicar_certificado(text)',
    'public.certificados_devidos(integer)', 'public.concluir_envios(jsonb)']
  LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon executa % — o REVOKE explícito não pegou.', f;
    END IF;
  END LOOP;

  -- As internas e a fila não são de usuário.
  IF has_function_privilege('authenticated', 'public._certificados(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.certificados_devidos(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '_certificados / certificados_devidos abertas a authenticated: qualquer conta listaria todos os destinatários.';
  END IF;

  -- Tabelas fechadas para anon; pódio e envios sem escrita nenhuma.
  IF has_table_privilege('anon', 'public.certificado_modelos', 'SELECT')
     OR has_table_privilege('anon', 'public.certificado_podio', 'SELECT')
     OR has_table_privilege('anon', 'public.envios_certificados', 'SELECT') THEN
    RAISE EXCEPTION 'anon ficou com grant de tabela nos certificados.';
  END IF;
  SELECT string_agg(pol.tablename || '.' || pol.policyname, ', ') INTO v_sobrou
    FROM pg_policies pol
   WHERE pol.schemaname = 'public'
     AND pol.tablename IN ('certificado_podio', 'envios_certificados')
     AND pol.cmd <> 'SELECT';
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'Pódio/envios de certificado ganharam policy de escrita: %.', v_sobrou;
  END IF;

  -- A trava da liberação não é gravável pela API.
  IF has_column_privilege('authenticated', 'public.certificado_modelos', 'liberado_em', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.certificado_modelos', 'publicado_em', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.certificado_modelos', 'publicado_em', 'INSERT')
     OR has_table_privilege('authenticated', 'public.certificado_modelos', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated grava publicado_em/liberado_em (ou apaga modelo) direto — só as RPCs podem.';
  END IF;

  -- O portal só entrega o que foi liberado, e só a quem chama.
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.meus_certificados()'::regprocedure;
  IF position('_certificado_liberado' IN v_src) = 0 OR position('auth.uid()' IN v_src) = 0 THEN
    RAISE EXCEPTION 'meus_certificados perdeu o recorte de liberado ou o de dono.';
  END IF;

  -- O certificado de professor não cita trabalho (revisão às cegas).
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public._certificados(text)'::regprocedure;
  IF position('''aprovado_correcoes''' IN v_src) = 0 THEN
    RAISE EXCEPTION '_certificados perdeu o recorte de trabalho aprovado.';
  END IF;

  -- O desempate pela nota ao vivo, e as quatro filas no fechamento.
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.ranking_evento()'::regprocedure;
  IF position('coalesce(v.media, 0) DESC' IN v_src) = 0 THEN
    RAISE EXCEPTION 'ranking_evento perdeu o desempate pela nota ao vivo.';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.concluir_envios(jsonb)'::regprocedure;
  IF position('envios_revisores' IN v_src) = 0
     OR position('envios_resultados' IN v_src) = 0
     OR position('envios_apresentacoes' IN v_src) = 0
     OR position('envios_certificados' IN v_src) = 0 THEN
    RAISE EXCEPTION 'concluir_envios deixou de fechar uma das quatro filas.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'certificados' AND public = false) THEN
    RAISE EXCEPTION 'o bucket certificados precisa existir e ser PRIVADO';
  END IF;

  RAISE NOTICE 'OK: certificados só liberados pelo servidor, pódio congelado, fila só para service_role.';
END $$;
