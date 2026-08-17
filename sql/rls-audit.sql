-- Etapa 4 do plano de deploy — auditoria de RLS.
--
-- Sem backend próprio, o RLS é a ÚNICA barreira entre um visitante anônimo
-- e os dados de submissão. Este arquivo é a metade estática da verificação;
-- a metade dinâmica é scripts/rls-probe.js, que ataca o banco com a mesma
-- chave pública que qualquer visitante tem.
--
-- Como rodar: cole no SQL Editor do dashboard do Supabase e leia consulta
-- por consulta. Não há psql nesta máquina de desenvolvimento.
--
-- Critério de aprovação: consultas 1, 4, 5 e 6 devem retornar ZERO linhas.
-- A consulta 2 é para leitura humana linha a linha (não é automatizável) e
-- a 3 é informativa.

-- ---------------------------------------------------------------------
-- 1. Tabelas sem RLS habilitado. DEVE retornar zero linhas.
--    Uma policy numa tabela com RLS desligado não faz absolutamente nada.
-- ---------------------------------------------------------------------
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false
ORDER BY tablename;

-- ---------------------------------------------------------------------
-- 2. Todas as policies, para revisão humana linha a linha.
--    Ler `qual` (USING) e `with_check` (WITH CHECK) de cada uma e confirmar
--    que dizem o que a intenção declarada diz. Ler não é testar — a
--    consulta 2 não substitui o rls-probe.js.
-- ---------------------------------------------------------------------
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ---------------------------------------------------------------------
-- 3. Tabelas com RLS ligado e NENHUMA policy — trancadas para todo mundo.
--    Seguro, mas normalmente é um engano que vale conhecer.
--    Esperado neste projeto: tokens_email (acesso só via SECURITY DEFINER),
--    rate_limits e _migrations. Qualquer outra tabela aqui é suspeita.
-- ---------------------------------------------------------------------
SELECT t.tablename
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname AND p.tablename = t.tablename
WHERE t.schemaname = 'public' AND t.rowsecurity = true
GROUP BY t.tablename
HAVING count(p.policyname) = 0
ORDER BY t.tablename;

-- ---------------------------------------------------------------------
-- 4. GRANTs de tabela ainda concedidos a `anon`. DEVE retornar zero linhas.
--
--    Específico deste projeto: as migrations antigas faziam
--    `GRANT ... TO anon, authenticated` em quase tudo, e o
--    security_hardening revogou em massa. Esta consulta é a prova de que
--    a revogação pegou — e o alarme se uma migration nova reintroduzir o
--    GRANT sem perceber.
--
--    Exceções legítimas: NENHUMA. As duas tabelas de leitura pública
--    (minicourses, schedule) são liberadas por POLICY `TO anon`, não por
--    GRANT direto — o GRANT vem do papel `anon` herdar de PUBLIC apenas
--    onde a policy permite.
-- ---------------------------------------------------------------------
SELECT table_name, privilege_type, grantee
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
ORDER BY table_name, privilege_type;

-- ---------------------------------------------------------------------
-- 5. Funções SECURITY DEFINER executáveis por `anon`.
--    DEVE retornar apenas as liberadas por desenho:
--      · confirmar_email(text)      — o link de verificação abre sem sessão
--      · verify_certificate(text)   — validação pública de certificado
--      · minicourse_occupancy()     — vagas na página pública
--      · links_downloads()          — links de download da landing e do
--                                     /login, que não têm sessão; devolve
--                                     só as colunas de link, nunca a linha
--                                     de `configuracoes` inteira
--
--    Uma função SECURITY DEFINER roda com os privilégios do dono e ignora
--    o RLS. Uma função nova nesta lista é um bypass completo do RLS aberto
--    à internet — o risco mais alto do modelo sem backend.
-- ---------------------------------------------------------------------
SELECT p.proname AS funcao,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef IS TRUE
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY p.proname;

-- ---------------------------------------------------------------------
-- 6. Buckets de Storage públicos. DEVE retornar zero linhas.
--    Um bucket público serve os PDFs por URL direta e ignora o RLS de
--    storage.objects por completo (SEC-05).
-- ---------------------------------------------------------------------
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE public IS TRUE;

-- ---------------------------------------------------------------------
-- 7. Configuração dos buckets, para conferência a olho.
--    O bucket de PDFs deve ter public = false, file_size_limit = 10485760
--    e allowed_mime_types = {application/pdf}. Os limites do bucket são a
--    barreira real — a validação no cliente é só conforto de UX.
-- ---------------------------------------------------------------------
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY name;
