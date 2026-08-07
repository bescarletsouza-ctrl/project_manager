-- Departamentos extras por pessoa: members.department_id continua sendo o
-- departamento PRINCIPAL (usado em Pessoas/Carga de Trabalho para agrupar e
-- somar capacidade, sem duplicar números). Esta tabela só adiciona a pessoa
-- ao ROSTER de outros departamentos — não afeta permissão nenhuma
-- (has_project_access continua baseada em ser gestor/responsável, não em
-- departamento).
CREATE TABLE public.member_departments (
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, department_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_departments TO authenticated;
GRANT ALL ON public.member_departments TO service_role;
ALTER TABLE public.member_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "member_departments read" ON public.member_departments FOR SELECT TO authenticated USING (true);
-- Mesmo padrão de "members write": só admin edita quem está em qual departamento.
CREATE POLICY "member_departments write" ON public.member_departments FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
