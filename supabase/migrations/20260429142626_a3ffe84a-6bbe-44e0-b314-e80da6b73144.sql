
-- Tabela de categorias
CREATE TABLE public.categorias (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de avaliadores
CREATE TABLE public.avaliadores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  instituicao TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de trabalhos
CREATE TABLE public.trabalhos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL,
  resumo TEXT NOT NULL,
  autores TEXT NOT NULL,
  categoria_id UUID REFERENCES public.categorias(id) ON DELETE SET NULL,
  data_submissao DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilita RLS
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trabalhos ENABLE ROW LEVEL SECURITY;

-- Políticas abertas (sprint inicial sem auth)
CREATE POLICY "público pode ver categorias" ON public.categorias FOR SELECT USING (true);
CREATE POLICY "público pode inserir categorias" ON public.categorias FOR INSERT WITH CHECK (true);
CREATE POLICY "público pode atualizar categorias" ON public.categorias FOR UPDATE USING (true);
CREATE POLICY "público pode deletar categorias" ON public.categorias FOR DELETE USING (true);

CREATE POLICY "público pode ver avaliadores" ON public.avaliadores FOR SELECT USING (true);
CREATE POLICY "público pode inserir avaliadores" ON public.avaliadores FOR INSERT WITH CHECK (true);
CREATE POLICY "público pode atualizar avaliadores" ON public.avaliadores FOR UPDATE USING (true);
CREATE POLICY "público pode deletar avaliadores" ON public.avaliadores FOR DELETE USING (true);

CREATE POLICY "público pode ver trabalhos" ON public.trabalhos FOR SELECT USING (true);
CREATE POLICY "público pode inserir trabalhos" ON public.trabalhos FOR INSERT WITH CHECK (true);
CREATE POLICY "público pode atualizar trabalhos" ON public.trabalhos FOR UPDATE USING (true);
CREATE POLICY "público pode deletar trabalhos" ON public.trabalhos FOR DELETE USING (true);

-- Categorias iniciais
INSERT INTO public.categorias (nome) VALUES
  ('Pesquisa'),
  ('BIC Jr.'),
  ('Ensino'),
  ('Extensão');
