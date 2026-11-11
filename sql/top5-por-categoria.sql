-- Top 5 de cada categoria: título, autores e nota final.
-- Colar no SQL Editor do Supabase. Só leitura (SELECT), não altera nada.
--
-- Nota final = metade da REVISÃO + metade da AVALIAÇÃO AO VIVO, as duas de 1 a 5
-- (a metade que não existe vale 0). Mesma conta de rankingPorCategoria
-- (src/lib/avaliacaoEvento.ts), que monta /co-chairs/resultados-evento:
--   revisão  = média de todos os itens[].nota dos pareceres da RODADA CORRENTE
--   ao vivo  = média das médias de cada avaliador (avaliacoes_evento.media)
--   desempate: maior nota AO VIVO, depois mais avaliações ao vivo, depois o título.
--   (a mesma ordem de ranking_evento(), migration 20261111120000)
WITH revisao AS (
  SELECT t.id, avg((i.item->>'nota')::numeric) AS media
    FROM public.trabalhos t
    JOIN public.pareceres pa ON pa.trabalho_id = t.id AND pa.rodada = t.rodada
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(pa.itens) = 'array' THEN pa.itens ELSE '[]'::jsonb END
    ) AS i(item)
   WHERE i.item->>'nota' ~ '^[0-9]+(\.[0-9]+)?$'
   GROUP BY t.id
), ao_vivo AS (
  SELECT trabalho_id AS id, avg(media) AS media, count(*) AS avaliacoes
    FROM public.avaliacoes_evento
   GROUP BY trabalho_id
), ranking AS (
  SELECT coalesce(c.nome, '(sem categoria)')                      AS categoria,
         t.titulo,
         t.autores,
         round(r.media, 2)                                         AS nota_revisao,
         round(v.media, 2)                                         AS nota_ao_vivo,
         coalesce(v.avaliacoes, 0)                                 AS avaliacoes_ao_vivo,
         round((coalesce(r.media, 0) + coalesce(v.media, 0)) / 2, 2) AS nota_final,
         row_number() OVER (
           PARTITION BY t.categoria_id
           ORDER BY coalesce(r.media, 0) + coalesce(v.media, 0) DESC,
                    coalesce(v.media, 0) DESC,
                    coalesce(v.avaliacoes, 0) DESC,
                    t.titulo
         )                                                         AS posicao
    FROM public.trabalhos t
    LEFT JOIN public.categorias c ON c.id = t.categoria_id
    LEFT JOIN revisao r ON r.id = t.id
    LEFT JOIN ao_vivo v ON v.id = t.id
   WHERE t.status IN ('aprovado', 'aprovado_correcoes')  -- STATUS_APRESENTAVEIS
)
SELECT categoria, posicao, titulo, autores,
       nota_final, nota_revisao, nota_ao_vivo, avaliacoes_ao_vivo
  FROM ranking
 WHERE posicao <= 5
 ORDER BY categoria, posicao;
