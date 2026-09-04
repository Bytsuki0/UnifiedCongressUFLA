-- ============================================================
-- Cronograma vira LISTA — um item por período, sem calendário
-- ------------------------------------------------------------
-- A 20260829120000 modelou o cronograma como CALENDÁRIO: a organização
-- publicava meses, pintava dias avulsos e a marcação (cor/nome/descrição)
-- era compartilhada por esses dias. O cronograma passa a ser uma LISTA:
-- cada item tem nome, descrição, cor, data de início e data de término.
--
-- Esta migration NÃO cria tabela nova — ela conserta a que existe:
--
--   cronograma_eventos  ganha `data_inicio` e `data_fim`. Continua sendo
--                       a mesma tabela, com os mesmos ids, as mesmas
--                       policies e o mesmo histórico.
--   cronograma_dias     DROPADA. O período substitui o conjunto de dias:
--                       o intervalo [início, fim] diz a mesma coisa numa
--                       linha só, e é o que a lista mostra.
--   cronograma_meses    DROPADA. Meses eram abas do calendário, e a
--                       lista não tem abas. Era também o filtro do que
--                       ia ao ar — ver o aviso do item 4.
--
-- Some junto a RPC de escrita `salvar_marcacao_cronograma`: ela existia
-- porque marcação e dias eram DUAS tabelas e gravá-las com dois requests
-- deixava a porta aberta para "criou a cor, falhou os dias". Com uma
-- tabela só não há o que coordenar, e a escrita volta a ser INSERT /
-- UPDATE / DELETE direto sob RLS — o mesmo desenho de `arquivos_download`
-- (20260830120000), que é a feature irmã desta: tabela editada pela
-- organização, lida pelo visitante por uma RPC.
-- ============================================================

-- ------------------------------------------------------------
-- 1. As duas datas
-- ------------------------------------------------------------
-- Entram anuláveis para o backfill do item 2 poder rodar; o NOT NULL vem
-- depois, no item 3.
ALTER TABLE public.cronograma_eventos
  ADD COLUMN IF NOT EXISTS data_inicio DATE,
  ADD COLUMN IF NOT EXISTS data_fim    DATE;

-- `criado_por` era preenchido pela RPC (`auth.uid()`), que está saindo.
-- Como DEFAULT, o INSERT direto do cliente continua carimbando o autor
-- sem que o cliente precise informá-lo.
ALTER TABLE public.cronograma_eventos
  ALTER COLUMN criado_por SET DEFAULT auth.uid();

-- ------------------------------------------------------------
-- 2. Backfill: o conjunto de dias vira um período
-- ------------------------------------------------------------
-- Primeiro e último dia da marcação. Uma marcação com dias soltos (12 e
-- 20, sem os do meio) vira o período 12–20: é a informação que sobrevive
-- ao novo modelo, e é a leitura correta de "esse assunto vai do dia 12 ao
-- dia 20". Nada é inventado além disso.
--
-- Guardado por `to_regclass` para a migration continuar re-executável
-- depois que a tabela do item 4 já tiver sido dropada.
DO $$
BEGIN
  IF to_regclass('public.cronograma_dias') IS NOT NULL THEN
    UPDATE public.cronograma_eventos e
       SET data_inicio = d.primeiro,
           data_fim    = d.ultimo
      FROM (
        SELECT evento_id, MIN(dia) AS primeiro, MAX(dia) AS ultimo
          FROM public.cronograma_dias
         GROUP BY evento_id
      ) d
     WHERE d.evento_id = e.id
       AND e.data_inicio IS NULL;
  END IF;
END $$;

-- Marcação sem dia nenhum não tem data para herdar, e já era invisível em
-- toda tela (a RPC antiga exigia ao menos um dia; só um INSERT direto na
-- tabela produzia uma dessas). Não há o que preservar.
DELETE FROM public.cronograma_eventos WHERE data_inicio IS NULL;

-- ------------------------------------------------------------
-- 3. As datas passam a ser obrigatórias e ordenadas
-- ------------------------------------------------------------
ALTER TABLE public.cronograma_eventos
  ALTER COLUMN data_inicio SET NOT NULL,
  ALTER COLUMN data_fim    SET NOT NULL;

-- Fim antes do início produziria um item que a lista não sabe desenhar e
-- que nenhuma tela conseguiria explicar. A trava é do SERVIDOR de
-- propósito: a validação da tela é cortesia, esta é a que vale.
-- DROP antes do ADD porque `ADD CONSTRAINT` não aceita IF NOT EXISTS.
ALTER TABLE public.cronograma_eventos
  DROP CONSTRAINT IF EXISTS cronograma_eventos_periodo_check;
ALTER TABLE public.cronograma_eventos
  ADD  CONSTRAINT cronograma_eventos_periodo_check CHECK (data_fim >= data_inicio);

-- A lista é sempre lida em ordem cronológica.
CREATE INDEX IF NOT EXISTS cronograma_eventos_periodo_idx
  ON public.cronograma_eventos (data_inicio, data_fim);

COMMENT ON TABLE public.cronograma_eventos IS
  'Itens do cronograma: nome, descrição, cor e o período [data_inicio, data_fim].';

-- ------------------------------------------------------------
-- 4. Fora o que era do calendário
-- ------------------------------------------------------------
-- ⚠ MUDANÇA DE VISIBILIDADE: `cronograma_meses` era, além das abas, o
-- filtro do que o visitante enxergava — marcação em mês não publicado
-- ficava escondida sem ser apagada. A lista não tem esse meio-termo: o
-- que está cadastrado está publicado, e tirar do ar é excluir o item.
-- Um item que estava escondido por causa do mês passa a aparecer; a tela
-- de co-chairs mostra todos, então o que não deve ir ao ar sai por lá.
--
-- As policies, os grants e o índice de cada tabela caem junto com ela.
DROP TABLE IF EXISTS public.cronograma_dias;
DROP TABLE IF EXISTS public.cronograma_meses;

DROP FUNCTION IF EXISTS public.cronograma_publico_dias();
DROP FUNCTION IF EXISTS public.cronograma_publico_meses();
DROP FUNCTION IF EXISTS public.salvar_marcacao_cronograma(uuid, text, text, text, date[]);

-- ------------------------------------------------------------
-- 5. A janela pública
-- ------------------------------------------------------------
-- Uma RPC no lugar das duas: sem meses para publicar, não há segunda
-- consulta. `anon` continua sem grant NENHUM na tabela — quem entra na
-- landing lê por aqui, e só isto.
--
-- A ordem é `data_inicio, data_fim, titulo`, e não uma coluna `ordem`:
-- cronologia é a única ordem que faz sentido numa lista de datas e, por
-- não ser configurável, não pode ser configurada errado. (Mesmo motivo
-- do `ORDER BY ano, mes` que a migration anterior usava nos meses.)
CREATE OR REPLACE FUNCTION public.cronograma_publico()
RETURNS TABLE(
  id          uuid,
  titulo      text,
  descricao   text,
  cor         text,
  data_inicio date,
  data_fim    date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.titulo, e.descricao, e.cor, e.data_inicio, e.data_fim
    FROM public.cronograma_eventos e
   ORDER BY e.data_inicio, e.data_fim, e.titulo;
$$;

REVOKE ALL ON FUNCTION public.cronograma_publico() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cronograma_publico() TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. Fechar `anon` na tabela (de novo)
-- ------------------------------------------------------------
-- O ALTER DEFAULT PRIVILEGES do projeto concede a `anon` no CREATE, não
-- no ALTER, então as colunas novas não reabriram nada — mas reafirmar é
-- barato e é o que o bloco do item 7 confere.
REVOKE ALL ON public.cronograma_eventos FROM anon;

-- ------------------------------------------------------------
-- 7. Confere na própria migration
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.cronograma_dias')  IS NOT NULL
     OR to_regclass('public.cronograma_meses') IS NOT NULL THEN
    RAISE EXCEPTION 'as tabelas do calendário antigo continuam de pé';
  END IF;

  IF NOT has_function_privilege('anon', 'public.cronograma_publico()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon deveria ler o cronograma público e não lê';
  END IF;

  IF has_table_privilege('anon', 'public.cronograma_eventos', 'SELECT') THEN
    RAISE EXCEPTION 'anon ficou com grant de tabela no cronograma';
  END IF;

  -- O período é regra de servidor: sem este CHECK, um cliente com bug
  -- grava fim < início e a lista passa a mentir.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cronograma_eventos'::regclass
       AND conname  = 'cronograma_eventos_periodo_check'
  ) THEN
    RAISE EXCEPTION 'o CHECK do período não foi criado';
  END IF;
END $$;
