-- ============================================================
-- Avisos de login — o recado que a organização dá na entrada
-- ------------------------------------------------------------
-- Até aqui a organização só conseguia falar com quem já estava dentro
-- do sistema por telas que a pessoa precisava PROCURAR (o cronograma, os
-- templates, os anais). Não havia como dizer "a prorrogação saiu" ou
-- "o formulário de parecer mudou" a quem entra, no instante em que
-- entra. É o que esta migration cria: uma lista de avisos, cada um
-- endereçado a um conjunto de PAPÉIS, que aparecem em diálogo logo
-- depois do login de quem tem um daqueles papéis.
--
-- Mesmo desenho que `arquivos_download` (20260830120000), o cronograma
-- (20260903120000) e as vitrines (20260907120000) inauguraram: a
-- organização acrescenta e remove linhas numa tela de co-chairs, o
-- cliente lê por uma RPC SECURITY DEFINER, a tabela continua fechada
-- para `anon`.
--
-- Duas decisões que valem mais que o resto:
--
--  1. NÃO existe "aviso cadastrado mas desligado". Existir é estar no
--     ar; tirar do ar é EXCLUIR. É a mesma escolha do cronograma
--     (20260903120000), pelo mesmo motivo: um segundo estado ("existe
--     mas não aparece") é um estado que nenhuma outra tela conhece, e
--     que se descobre tarde — o aviso some para o usuário e continua
--     na lista de quem publica.
--
--  2. Não há registro de "quem já leu". O aviso reaparece a cada
--     login, de propósito — é um recado da organização, não uma caixa
--     de entrada. Uma tabela de leitura seria uma linha por usuário
--     por aviso, cresceria com o congresso inteiro e teria de ser
--     limpa junto com as contas (ver purge:contas). O "já vi este
--     nesta sessão", que evita o diálogo reabrir a cada F5, é do
--     NAVEGADOR (sessionStorage) e some quando a aba fecha — que é
--     exatamente o ciclo de "cada login".
--
-- O conteúdo tem duas formas, e elas são exclusivas: TEXTO (com um
-- subconjunto de marcação — negrito, itálico e lista) ou BANNER (uma
-- imagem só, no bucket privado `avisos`). Não é um campo que aceita os
-- dois: um aviso com texto E imagem obrigaria toda tela que o exibe a
-- decidir o que mostrar primeiro, e as telas discordariam.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Papéis efetivos de quem está logado
-- ------------------------------------------------------------
-- `get_my_roles()` devolve o que está em `user_roles` e nada mais —
-- inclusive `{}` para uma conta cadastrada fora do fluxo normal. O
-- frontend já resolve esse vazio como `externo` (ver `resolveMyRole` no
-- AuthContext: "sem papel resolvido, assume o menor privilégio"), e o
-- endereçamento do aviso PRECISA da mesma conta: sem isto, uma conta
-- sem papel nenhum não receberia nem o aviso dirigido a `externo`, que
-- é justamente o portal em que ela cai.
--
-- ⚠ Isto é o servidor decidindo a quem o aviso pertence. O papel que a
-- interface guarda é UM só (o de maior privilégio, por `ROLE_PRIORITY`),
-- e mandar esse papel no request faria um professor que também é
-- avaliador perder o aviso dos professores. Aqui a comparação é contra
-- o CONJUNTO inteiro — mesma regra de `confirmar_distribuicao` e de
-- `aplicar_anexos`: atributo de autorização nunca vem do corpo.
CREATE OR REPLACE FUNCTION public.papeis_efetivos()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
           -- Sem sessão não há papel nenhum — nem o de menor privilégio.
           -- Devolver {externo} aqui abriria os avisos de externo para
           -- `anon`; o vazio é o que faz o `&&` da RPC não casar nada.
           WHEN auth.uid() IS NULL THEN '{}'::text[]
           WHEN coalesce(array_length(r.papeis, 1), 0) = 0 THEN ARRAY['externo']
           ELSE r.papeis
         END
    FROM (
      SELECT coalesce(array_agg(ur.role), '{}'::text[]) AS papeis
        FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
    ) r;
$$;

-- ⚠ O REVOKE de `anon` NÃO é redundante com o de PUBLIC, e a primeira
-- tentativa de aplicar esta migration morreu exatamente aqui. O projeto
-- tem `ALTER DEFAULT PRIVILEGES` concedendo tudo a `anon`, então toda
-- função nova nasce com um GRANT **direto** para esse papel — e revogar
-- de PUBLIC não tira grant direto. É a mesma armadilha do
-- `REVOKE ALL ON public.avisos FROM anon` mais abaixo, e o precedente é
-- `email_confirmado()` (20260806140000), que já revoga das duas pontas.
REVOKE ALL ON FUNCTION public.papeis_efetivos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.papeis_efetivos() FROM anon;
GRANT EXECUTE ON FUNCTION public.papeis_efetivos() TO authenticated;

COMMENT ON FUNCTION public.papeis_efetivos() IS
  'Papéis do usuário logado, com o mesmo fallback do frontend: conta sem papel vale como externo.';

-- ------------------------------------------------------------
-- 2. `avisos`
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.avisos (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'texto'  → o recado está em `corpo`, com marcação leve
  -- 'banner' → o recado é a imagem em `imagem`
  --
  -- ⚠ O tipo NÃO é editável depois de criado, e a tela de co-chairs não
  -- o edita: trocar um banner para texto deixaria a imagem pendurada no
  -- bucket sem nada apontando para ela (o blob não sai por SQL). É a
  -- mesma razão pela qual `categoria_anexos.tipo` é imutável desde a
  -- 20260904120000.
  tipo   TEXT NOT NULL CHECK (tipo IN ('texto', 'banner')),

  -- Cabeçalho do diálogo. Obrigatório nos dois tipos: um pop-up sem
  -- título é uma caixa anônima no meio da tela, e o usuário não tem
  -- como saber de onde ela veio.
  titulo TEXT NOT NULL CHECK (btrim(titulo) <> ''),

  -- Texto com marcação leve (**negrito**, *itálico*, "- " para item de
  -- lista). Guardado como TEXTO, nunca como HTML: o cliente monta os
  -- elementos a partir desta string e não injeta marcação nenhuma no
  -- documento. Uma conta de co-chair comprometida que gravasse HTML
  -- aqui estaria escrevendo <script> na tela de TODO MUNDO no login —
  -- é o único ponto do sistema em que o texto de uma pessoa aparece no
  -- navegador de todas as outras sem que ninguém tenha clicado nada.
  corpo  TEXT NOT NULL DEFAULT '',

  -- Caminho do objeto no bucket privado `avisos`
  -- (ex.: "<uid>/1757—cartaz.png"). Nunca uma URL: o bucket é privado e
  -- o cliente assina na hora de exibir, como os PDFs dos trabalhos
  -- (`pdfStorage.ts`).
  imagem TEXT NOT NULL DEFAULT '',

  -- A quem o aviso se dirige. Um aviso sem destinatário não é um
  -- rascunho, é erro de preenchimento — não haveria login nenhum capaz
  -- de exibi-lo.
  papeis TEXT[] NOT NULL,

  -- Ordem do diálogo quando mais de um aviso alcança a mesma pessoa.
  -- `criado_em` desempata para a fila nunca embaralhar entre logins.
  ordem  INTEGER NOT NULL DEFAULT 0,

  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),

  -- Exclusividade das duas formas, no servidor. A tela também confere,
  -- para dar a frase certa; quem recusa é este CHECK.
  CONSTRAINT avisos_conteudo_check CHECK (
    (tipo = 'texto'  AND btrim(corpo)  <> '' AND imagem = '')
    OR
    (tipo = 'banner' AND btrim(imagem) <> '' AND corpo  = '')
  ),

  -- `<@` sozinho não bastaria: o array vazio é subconjunto de qualquer
  -- coisa e passaria.
  CONSTRAINT avisos_papeis_check CHECK (
    coalesce(array_length(papeis, 1), 0) >= 1
    AND papeis <@ ARRAY['estudante', 'externo', 'professor', 'avaliador', 'admin']::text[]
  )
);

COMMENT ON TABLE public.avisos IS
  'Avisos exibidos em diálogo no login, endereçados por papel. Existir é estar no ar: tirar do ar é excluir.';

CREATE INDEX IF NOT EXISTS avisos_ordem_idx  ON public.avisos (ordem, criado_em);
-- GIN para o `&&` da RPC: a lista é curta hoje, mas o operador de
-- sobreposição é o único predicado da leitura e roda em todo login.
CREATE INDEX IF NOT EXISTS avisos_papeis_idx ON public.avisos USING GIN (papeis);

-- ------------------------------------------------------------
-- 3. RLS
-- ------------------------------------------------------------
-- Escrita para `is_event_staff()`, e não para o admin: a tela mora em
-- /co-chairs, junto do cronograma, dos anais e dos pitches. O que decide
-- a policy é onde a tela mora — `arquivos_download` é do admin porque a
-- tela dele fica em /admin/configuracoes.
ALTER TABLE public.avisos ENABLE ROW LEVEL SECURITY;

-- O SELECT direto na tabela é da ORGANIZAÇÃO — é o que a tela de gestão
-- usa, e só ela precisa ver `papeis`/`ordem`. Quem está logado lê pela
-- RPC, que já recorta pelos papéis de quem chamou: sem isto, qualquer
-- conta poderia listar os avisos endereçados aos outros papéis
-- (inclusive um recado interno dirigido só a `admin`).
DROP POLICY IF EXISTS "avisos select" ON public.avisos;
CREATE POLICY "avisos select" ON public.avisos FOR SELECT TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "avisos write" ON public.avisos;
CREATE POLICY "avisos write" ON public.avisos FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.avisos TO authenticated;
GRANT ALL ON public.avisos TO service_role;

-- O projeto tem ALTER DEFAULT PRIVILEGES concedendo tudo a `anon`, então
-- este REVOKE não é redundante com o RLS.
REVOKE ALL ON public.avisos FROM anon;

-- ------------------------------------------------------------
-- 4. A leitura de quem entra
-- ------------------------------------------------------------
-- SECURITY DEFINER porque a policy de SELECT acima é só da organização:
-- o recorte de quem vê o quê é ESTE `&&`, e não o RLS. Por isso a função
-- não devolve `papeis` — o destinatário não tem o que fazer com a lista
-- de quem mais recebeu o mesmo recado.
--
-- Sem sessão não sai nada: `papeis_efetivos()` devolve `{}` para
-- `auth.uid() IS NULL`, e `&&` contra o vazio é sempre falso. O GRANT
-- também é só de `authenticated`, mas quem garante é o predicado.
--
-- Não há gate de e-mail confirmado aqui, de propósito: quem não
-- confirmou fica em /verifique-email e não chega a ver o diálogo, e um
-- recado da organização não é dado protegido — trancá-lo recriaria o
-- problema do `emailConfirmado === null` sem proteger nada.
CREATE OR REPLACE FUNCTION public.meus_avisos()
RETURNS TABLE(
  id     uuid,
  tipo   text,
  titulo text,
  corpo  text,
  imagem text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.tipo, a.titulo, a.corpo, a.imagem
    FROM public.avisos a
   WHERE a.papeis && public.papeis_efetivos()
   ORDER BY a.ordem, a.criado_em;
$$;

-- Ver o aviso em `papeis_efetivos()`: sem o REVOKE de `anon` esta função
-- nasce executável sem sessão. O predicado dela já devolveria vazio
-- (`papeis_efetivos()` é `{}` sem `auth.uid()`), mas uma RPC alcançável
-- por `anon` é superfície que não precisa existir — e o canário do fim
-- desta migration recusa a gravar sem isto.
REVOKE ALL ON FUNCTION public.meus_avisos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meus_avisos() FROM anon;
GRANT EXECUTE ON FUNCTION public.meus_avisos() TO authenticated;

-- ------------------------------------------------------------
-- 5. Bucket dos banners
-- ------------------------------------------------------------
-- PRIVADO, como todos os outros (SEC-05): a imagem sai por URL assinada
-- na hora de exibir. Um bucket público seria um endereço eterno e
-- adivinhável para um cartaz que a organização pode querer tirar do ar.
--
-- `allowed_mime_types` é a trava de verdade contra subir um HTML ou um
-- SVG (que carrega script) fazendo-se passar por imagem — o `accept` do
-- <input type="file"> é sugestão de interface, não recusa.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avisos', 'avisos', false, 5242880,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura: qualquer conta autenticada. O recorte de QUEM vê o aviso é da
-- RPC; aqui basta que o destinatário consiga assinar a imagem. Fechar a
-- leitura por papel obrigaria a repetir o `&&` da RPC dentro da policy
-- do Storage, com `name` como única pista — e a divergência entre as
-- duas cópias apareceria como um banner quebrado.
DROP POLICY IF EXISTS "avisos read"         ON storage.objects;
DROP POLICY IF EXISTS "avisos staff write"  ON storage.objects;
DROP POLICY IF EXISTS "avisos staff update" ON storage.objects;
DROP POLICY IF EXISTS "avisos staff delete" ON storage.objects;

CREATE POLICY "avisos read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avisos');
CREATE POLICY "avisos staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avisos' AND public.is_event_staff());
CREATE POLICY "avisos staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avisos' AND public.is_event_staff());
CREATE POLICY "avisos staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avisos' AND public.is_event_staff());

-- ------------------------------------------------------------
-- 6. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_recusou BOOLEAN;
BEGIN
  IF has_table_privilege('anon', 'public.avisos', 'SELECT') THEN
    RAISE EXCEPTION 'anon ficou com grant de tabela em avisos — o REVOKE não pegou';
  END IF;

  -- Foi este canário que reprovou a primeira tentativa de aplicar a
  -- migration: `REVOKE ... FROM PUBLIC` não tira o grant DIRETO que o
  -- `ALTER DEFAULT PRIVILEGES` do projeto dá a `anon`. Vale para as duas
  -- funções, e as duas são conferidas.
  IF has_function_privilege('anon', 'public.meus_avisos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode executar meus_avisos()';
  END IF;

  IF has_function_privilege('anon', 'public.papeis_efetivos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode executar papeis_efetivos()';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.meus_avisos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated deveria executar meus_avisos() e não executa';
  END IF;

  -- As três travas que a tela não pode ser a única a aplicar. Cada bloco
  -- tenta gravar o que NÃO pode existir; se o INSERT passar, a linha é
  -- desfeita e a migration quebra aqui — e não meses depois, com um
  -- pop-up em branco na tela de todo mundo.

  -- (a) aviso de texto sem corpo
  BEGIN
    INSERT INTO public.avisos (tipo, titulo, corpo, papeis)
    VALUES ('texto', '__canario__', '   ', ARRAY['estudante']);
    v_recusou := false;
  EXCEPTION WHEN check_violation THEN
    v_recusou := true;
  END;
  IF NOT v_recusou THEN
    DELETE FROM public.avisos WHERE titulo = '__canario__';
    RAISE EXCEPTION 'avisos aceitou um aviso de texto sem corpo — avisos_conteudo_check não está de pé';
  END IF;

  -- (b) aviso sem destinatário
  BEGIN
    INSERT INTO public.avisos (tipo, titulo, corpo, papeis)
    VALUES ('texto', '__canario__', 'x', ARRAY[]::text[]);
    v_recusou := false;
  EXCEPTION WHEN check_violation THEN
    v_recusou := true;
  END;
  IF NOT v_recusou THEN
    DELETE FROM public.avisos WHERE titulo = '__canario__';
    RAISE EXCEPTION 'avisos aceitou um aviso sem papel — avisos_papeis_check não está de pé';
  END IF;

  -- (c) papel fora dos cinco do sistema ('participant' é do /congresso,
  --     que está congelado e não tem portal para exibir aviso nenhum)
  BEGIN
    INSERT INTO public.avisos (tipo, titulo, corpo, papeis)
    VALUES ('texto', '__canario__', 'x', ARRAY['estudante', 'participant']);
    v_recusou := false;
  EXCEPTION WHEN check_violation THEN
    v_recusou := true;
  END;
  IF NOT v_recusou THEN
    DELETE FROM public.avisos WHERE titulo = '__canario__';
    RAISE EXCEPTION 'avisos aceitou um papel fora da lista — avisos_papeis_check não está de pé';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avisos' AND public = false) THEN
    RAISE EXCEPTION 'o bucket avisos precisa existir e ser PRIVADO';
  END IF;
END $$;
