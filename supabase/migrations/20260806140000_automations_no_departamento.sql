-- Automações no departamento — mesma estrutura de projeto.
-- automations.project_id vira nullable, ganha department_id.
-- CHECK garante que cada regra pertence a UM container (projeto XOR
-- departamento) — não faz sentido rodar a mesma automação em dois lados,
-- e RLS/filtros do cliente ficam mais previsíveis.

ALTER TABLE public.automations
  ALTER COLUMN project_id DROP NOT NULL,
  ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE;

ALTER TABLE public.automations
  ADD CONSTRAINT automations_container_ck
  CHECK (
    (project_id IS NOT NULL AND department_id IS NULL) OR
    (project_id IS NULL AND department_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS automations_department_idx
  ON public.automations(department_id);
