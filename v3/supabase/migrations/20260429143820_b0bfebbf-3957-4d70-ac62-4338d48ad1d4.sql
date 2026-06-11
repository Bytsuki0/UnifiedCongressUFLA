ALTER TABLE public.categorias ADD CONSTRAINT categorias_nome_unique UNIQUE (nome);
ALTER TABLE public.avaliadores ADD CONSTRAINT avaliadores_email_unique UNIQUE (email);

UPDATE public.trabalhos
SET categoria_id = (SELECT id FROM public.categorias ORDER BY nome LIMIT 1)
WHERE categoria_id IS NULL;

ALTER TABLE public.trabalhos ALTER COLUMN categoria_id SET NOT NULL;