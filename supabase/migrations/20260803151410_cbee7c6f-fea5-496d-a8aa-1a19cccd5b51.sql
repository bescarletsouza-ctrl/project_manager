-- 1. Tarefas em múltiplos projetos
CREATE TABLE public.task_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (task_id, project_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_projects TO authenticated;
GRANT ALL ON public.task_projects TO service_role;
ALTER TABLE public.task_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_projects read" ON public.task_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_projects write" ON public.task_projects FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX task_projects_project_idx ON public.task_projects(project_id);
CREATE INDEX task_projects_task_idx ON public.task_projects(task_id);

INSERT INTO public.task_projects (task_id, project_id, section_id, position)
SELECT t.id, t.project_id, t.section_id, t.position
FROM public.tasks t
WHERE t.project_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2. Sprint nas tarefas
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS sprint text;

-- 3. Configuração por projeto
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS default_assignee_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_due_days integer,
  ADD COLUMN IF NOT EXISTS visible_columns text[] NOT NULL DEFAULT ARRAY['assignee','due_date','status']::text[];

-- 4. Automações
CREATE TABLE public.automations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'task_created',
  trigger_value text,
  action_type text NOT NULL DEFAULT 'set_status',
  action_value text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT ALL ON public.automations TO service_role;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automations read" ON public.automations FOR SELECT TO authenticated USING (true);
CREATE POLICY "automations write" ON public.automations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_automations_touch BEFORE UPDATE ON public.automations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();