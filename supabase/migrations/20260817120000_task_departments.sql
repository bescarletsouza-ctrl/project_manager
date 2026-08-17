-- Departamentos extras de uma tarefa. tasks.department_id continua sendo o
-- departamento PRINCIPAL (permissões, relatórios que só olham um valor,
-- trigger de field-activity nada muda) — esta tabela só adiciona a tarefa a
-- departamentos ADICIONAIS, cada um com sua PRÓPRIA seção. Mesmo padrão de
-- task_projects (tarefa em vários projetos, seção por projeto).
--
-- Sem backfill: hoje nenhuma tarefa tem mais de um departamento.

CREATE TABLE public.task_departments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (task_id, department_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_departments TO authenticated;
GRANT ALL ON public.task_departments TO service_role;
ALTER TABLE public.task_departments ENABLE ROW LEVEL SECURITY;

-- Leitura aberta (mesmo padrão de task_projects — RLS de tasks já filtra o
-- que aparece). Escrita: quem pode escrever na tarefa (can_write_task já
-- existe, não depende de department_id — sem função nova de acesso).
CREATE POLICY "task_departments read" ON public.task_departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_departments write" ON public.task_departments FOR ALL TO authenticated
  USING (public.can_write_task(task_id))
  WITH CHECK (public.can_write_task(task_id));

CREATE INDEX task_departments_task_idx ON public.task_departments(task_id);
CREATE INDEX task_departments_department_idx ON public.task_departments(department_id);
