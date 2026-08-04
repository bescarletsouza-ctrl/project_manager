-- PORTFOLIOS
CREATE TABLE public.portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT 'blue',
  owner_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolios TO authenticated;
GRANT ALL ON public.portfolios TO service_role;
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portfolios read" ON public.portfolios FOR SELECT TO authenticated USING (true);
CREATE POLICY "portfolios write" ON public.portfolios FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- SECTIONS
CREATE TABLE public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sections_project_idx ON public.sections(project_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sections TO authenticated;
GRANT ALL ON public.sections TO service_role;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sections read" ON public.sections FOR SELECT TO authenticated USING (true);
CREATE POLICY "sections write" ON public.sections FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PROJECTS: portfolio + ordem + owner de visualizacao padrao
ALTER TABLE public.projects
  ADD COLUMN portfolio_id uuid REFERENCES public.portfolios(id) ON DELETE SET NULL,
  ADD COLUMN position integer NOT NULL DEFAULT 0,
  ADD COLUMN default_view text NOT NULL DEFAULT 'list',
  ADD COLUMN color text NOT NULL DEFAULT 'blue',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- TASKS: secao, subtarefa, marco, ordem
ALTER TABLE public.tasks
  ADD COLUMN section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  ADD COLUMN parent_task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  ADD COLUMN is_milestone boolean NOT NULL DEFAULT false,
  ADD COLUMN start_date date,
  ADD COLUMN position integer NOT NULL DEFAULT 0,
  ADD COLUMN completed boolean NOT NULL DEFAULT false;
CREATE INDEX tasks_section_idx ON public.tasks(section_id, position);
CREATE INDEX tasks_parent_idx ON public.tasks(parent_task_id);

-- MEMBERS: vinculo com conta de acesso
ALTER TABLE public.members
  ADD COLUMN user_id uuid,
  ADD COLUMN avatar_color text NOT NULL DEFAULT 'indigo';
CREATE UNIQUE INDEX members_user_id_key ON public.members(user_id) WHERE user_id IS NOT NULL;

-- DEPENDENCIAS
CREATE TABLE public.task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  blocked_by_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_dependencies_unique UNIQUE (task_id, blocked_by_task_id),
  CONSTRAINT task_dependencies_no_self CHECK (task_id <> blocked_by_task_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_dependencies TO authenticated;
GRANT ALL ON public.task_dependencies TO service_role;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deps read" ON public.task_dependencies FOR SELECT TO authenticated USING (true);
CREATE POLICY "deps write" ON public.task_dependencies FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CAMPOS PERSONALIZADOS
CREATE TABLE public.custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_fields_project_idx ON public.custom_fields(project_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_fields TO authenticated;
GRANT ALL ON public.custom_fields TO service_role;
ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fields read" ON public.custom_fields FOR SELECT TO authenticated USING (true);
CREATE POLICY "fields write" ON public.custom_fields FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.task_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_field_values_unique UNIQUE (task_id, field_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_field_values TO authenticated;
GRANT ALL ON public.task_field_values TO service_role;
ALTER TABLE public.task_field_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "field values read" ON public.task_field_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "field values write" ON public.task_field_values FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- COMENTARIOS
CREATE TABLE public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  author_user_id uuid,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_comments_task_idx ON public.task_comments(task_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments read" ON public.task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments insert" ON public.task_comments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "comments update own" ON public.task_comments FOR UPDATE TO authenticated USING (author_user_id = auth.uid()) WITH CHECK (author_user_id = auth.uid());
CREATE POLICY "comments delete own" ON public.task_comments FOR DELETE TO authenticated USING (author_user_id = auth.uid());

CREATE TABLE public.comment_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.task_comments(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comment_mentions_unique UNIQUE (comment_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comment_mentions TO authenticated;
GRANT ALL ON public.comment_mentions TO service_role;
ALTER TABLE public.comment_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mentions read" ON public.comment_mentions FOR SELECT TO authenticated USING (true);
CREATE POLICY "mentions write" ON public.comment_mentions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CAIXA DE ENTRADA
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid REFERENCES public.members(id) ON DELETE CASCADE,
  recipient_user_id uuid,
  kind text NOT NULL DEFAULT 'atividade',
  title text NOT NULL,
  body text,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_member_idx ON public.notifications(member_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications read" ON public.notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "notifications insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notifications update" ON public.notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "notifications delete" ON public.notifications FOR DELETE TO authenticated USING (true);

-- updated_at helper
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_portfolios_touch BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_sections_touch BEFORE UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_projects_touch BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_comments_touch BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seções padrão para projetos existentes (Asana: To do / Doing / Done)
INSERT INTO public.sections (project_id, name, color, position)
SELECT p.id, s.name, s.color, s.position
FROM public.projects p
CROSS JOIN (VALUES ('A fazer','slate',0),('Em andamento','blue',1),('Em revisão','amber',2),('Concluído','emerald',3)) AS s(name,color,position);

-- Vincula tarefas existentes a uma seção coerente
UPDATE public.tasks t SET section_id = s.id
FROM public.sections s
WHERE s.project_id = t.project_id
  AND t.section_id IS NULL
  AND s.name = CASE
    WHEN t.status = 'concluido' THEN 'Concluído'
    WHEN t.status IN ('em_revisao','aguardando_aprovacao') THEN 'Em revisão'
    WHEN t.status = 'em_andamento' THEN 'Em andamento'
    ELSE 'A fazer'
  END;

UPDATE public.tasks SET completed = true WHERE status = 'concluido';
