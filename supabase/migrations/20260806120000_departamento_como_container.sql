-- Departamento como container próprio de tarefas + seções.
-- Antes: sections.project_id NOT NULL — seção só existia dentro de projeto.
-- Depois: sections pode pertencer a projeto OU a departamento (nunca aos dois).
-- Tasks já tinha project_id e department_id nullable; nada muda ali.

ALTER TABLE public.sections
  ALTER COLUMN project_id DROP NOT NULL,
  ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE;

-- Uma seção pertence a UM container (projeto OU departamento). Impede
-- estados incoerentes tipo "seção órfã" ou "seção duplicada".
ALTER TABLE public.sections
  ADD CONSTRAINT sections_container_ck
  CHECK (
    (project_id IS NOT NULL AND department_id IS NULL) OR
    (project_id IS NULL AND department_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS sections_department_idx
  ON public.sections(department_id, position);
