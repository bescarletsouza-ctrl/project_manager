-- Cadastro de etiquetas: registradas separadamente (só admin cria/edita/exclui,
-- mesmo padrão de departamentos/clientes) e só selecionadas dentro da tarefa —
-- não dá pra digitar uma etiqueta nova direto na demanda.
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT 'blue',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags read" ON public.tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "tags write" ON public.tags FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- tasks.tags continua um text[] com o NOME da etiqueta (não muda a coluna nem
-- os dados existentes) — o cadastro novo só passa a ser a fonte de opções do
-- seletor. Preenche com o que já está em uso pra não perder nada.
INSERT INTO public.tags (name)
SELECT DISTINCT trim(tag)
FROM public.tasks, unnest(tags) AS tag
WHERE trim(tag) <> ''
ON CONFLICT (name) DO NOTHING;
