CREATE TABLE public.project_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'blue',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_statuses TO authenticated;
GRANT ALL ON public.project_statuses TO service_role;

ALTER TABLE public.project_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project statuses read" ON public.project_statuses FOR SELECT TO authenticated USING (true);
CREATE POLICY "project statuses write" ON public.project_statuses FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_project_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.task_status_history DROP CONSTRAINT IF EXISTS task_status_history_task_id_fkey;
ALTER TABLE public.task_status_history ADD CONSTRAINT task_status_history_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;