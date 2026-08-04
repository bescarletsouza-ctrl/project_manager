
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'blue',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dept read" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "dept write" ON public.departments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients read" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "clients write" ON public.clients FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  job_title text,
  access_role text NOT NULL DEFAULT 'colaborador',
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  capacity_points integer NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read" ON public.members FOR SELECT TO authenticated USING (true);
CREATE POLICY "members write" ON public.members FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planejamento',
  priority text NOT NULL DEFAULT 'media',
  start_date date,
  due_date date,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects read" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects write" ON public.projects FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'backlog',
  priority text NOT NULL DEFAULT 'media',
  complexity integer NOT NULL DEFAULT 3,
  task_type text NOT NULL DEFAULT 'execucao',
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  reopen_count integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  block_reason text,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks read" ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks write" ON public.tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.task_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid REFERENCES public.members(id) ON DELETE SET NULL,
  changed_by_user uuid,
  entered_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz,
  duration_minutes integer
);
CREATE INDEX idx_tsh_task ON public.task_status_history(task_id);
GRANT SELECT, INSERT ON public.task_status_history TO authenticated;
GRANT ALL ON public.task_status_history TO service_role;
ALTER TABLE public.task_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history read" ON public.task_status_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "history insert" ON public.task_status_history FOR INSERT TO authenticated WITH CHECK (true);

-- Automatic status movement tracking (no timers, derived from movements)
CREATE OR REPLACE FUNCTION public.track_task_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_row public.task_status_history%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_status_history(task_id, from_status, to_status, entered_at, changed_by_user)
    VALUES (NEW.id, NULL, NEW.status, NEW.created_at, auth.uid());
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT * INTO last_row FROM public.task_status_history
      WHERE task_id = NEW.id AND exited_at IS NULL
      ORDER BY entered_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.task_status_history
        SET exited_at = now(),
            duration_minutes = GREATEST(0, (EXTRACT(EPOCH FROM (now() - last_row.entered_at)) / 60)::int)
        WHERE id = last_row.id;
    END IF;

    INSERT INTO public.task_status_history(task_id, from_status, to_status, entered_at, changed_by_user)
    VALUES (NEW.id, OLD.status, NEW.status, now(), auth.uid());

    IF NEW.status = 'em_andamento' AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;
    IF NEW.status = 'concluido' THEN
      NEW.completed_at := now();
    END IF;
    IF OLD.status = 'concluido' AND NEW.status <> 'concluido' THEN
      NEW.completed_at := NULL;
      NEW.reopen_count := OLD.reopen_count + 1;
    END IF;
    IF NEW.status IN ('em_revisao','aguardando_aprovacao') THEN
      NEW.review_count := OLD.review_count + 1;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tasks_insert AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.track_task_status();
CREATE TRIGGER trg_tasks_update BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.track_task_status();

-- ============ DEMO DATA ============
ALTER TABLE public.tasks DISABLE TRIGGER trg_tasks_insert;

INSERT INTO public.departments (id, name, color) VALUES
 ('11111111-0000-0000-0000-000000000001','Marketing','violet'),
 ('11111111-0000-0000-0000-000000000002','Comercial','emerald'),
 ('11111111-0000-0000-0000-000000000003','Audiovisual','amber'),
 ('11111111-0000-0000-0000-000000000004','Tecnologia','sky'),
 ('11111111-0000-0000-0000-000000000005','Eventos','rose');

INSERT INTO public.clients (id, name, contact_email) VALUES
 ('22222222-0000-0000-0000-000000000001','Grupo Aurora','contato@aurora.com'),
 ('22222222-0000-0000-0000-000000000002','Vertex Indústria','ops@vertex.com'),
 ('22222222-0000-0000-0000-000000000003','Casa Nova Varejo','projetos@casanova.com'),
 ('22222222-0000-0000-0000-000000000004','Instituto Horizonte','contato@horizonte.org');

INSERT INTO public.members (id, name, email, job_title, access_role, department_id, capacity_points) VALUES
 ('33333333-0000-0000-0000-000000000001','Ana Ribeiro','ana@empresa.com','Head de Marketing','gestor','11111111-0000-0000-0000-000000000001',24),
 ('33333333-0000-0000-0000-000000000002','Bruno Lima','bruno@empresa.com','Analista de Conteúdo','colaborador','11111111-0000-0000-0000-000000000001',20),
 ('33333333-0000-0000-0000-000000000003','Carla Menezes','carla@empresa.com','Designer','colaborador','11111111-0000-0000-0000-000000000003',18),
 ('33333333-0000-0000-0000-000000000004','Diego Souza','diego@empresa.com','Editor de Vídeo','colaborador','11111111-0000-0000-0000-000000000003',18),
 ('33333333-0000-0000-0000-000000000005','Elisa Prado','elisa@empresa.com','Líder Comercial','lider','11111111-0000-0000-0000-000000000002',22),
 ('33333333-0000-0000-0000-000000000006','Felipe Antunes','felipe@empresa.com','Executivo de Contas','colaborador','11111111-0000-0000-0000-000000000002',20),
 ('33333333-0000-0000-0000-000000000007','Gabriela Nunes','gabi@empresa.com','Tech Lead','lider','11111111-0000-0000-0000-000000000004',26),
 ('33333333-0000-0000-0000-000000000008','Henrique Dias','henrique@empresa.com','Desenvolvedor','colaborador','11111111-0000-0000-0000-000000000004',24),
 ('33333333-0000-0000-0000-000000000009','Isabela Costa','isabela@empresa.com','Produtora de Eventos','colaborador','11111111-0000-0000-0000-000000000005',20),
 ('33333333-0000-0000-0000-000000000010','João Vitor','joao@empresa.com','Analista de Operações','colaborador','11111111-0000-0000-0000-000000000005',20);

INSERT INTO public.projects (id, name, description, client_id, department_id, manager_id, status, priority, start_date, due_date, tags) VALUES
 ('44444444-0000-0000-0000-000000000001','Campanha Aurora 2026','Campanha integrada de lançamento da nova linha.','22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','em_andamento','alta', now()::date - 40, now()::date + 20, ARRAY['campanha','lancamento']),
 ('44444444-0000-0000-0000-000000000002','Portal Vertex','Novo portal institucional e área do cliente.','22222222-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000004','33333333-0000-0000-0000-000000000007','em_risco','urgente', now()::date - 60, now()::date + 5, ARRAY['web','produto']),
 ('44444444-0000-0000-0000-000000000003','Expansão Comercial Casa Nova','Estruturação do funil e materiais de vendas.','22222222-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000005','em_andamento','media', now()::date - 25, now()::date + 35, ARRAY['vendas']),
 ('44444444-0000-0000-0000-000000000004','Congresso Horizonte','Produção completa do congresso anual.','22222222-0000-0000-0000-000000000004','11111111-0000-0000-0000-000000000005','33333333-0000-0000-0000-000000000009','atrasado','alta', now()::date - 70, now()::date - 5, ARRAY['evento']),
 ('44444444-0000-0000-0000-000000000005','Série Documental Aurora','Produção audiovisual em 4 episódios.','22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000003','33333333-0000-0000-0000-000000000003','concluido','media', now()::date - 120, now()::date - 15, ARRAY['video']);

DO $seed$
DECLARE
  i int;
  s text;
  statuses text[] := ARRAY['backlog','a_fazer','em_andamento','em_revisao','aguardando_aprovacao','bloqueado','concluido','cancelado'];
  prios text[] := ARRAY['baixa','media','alta','urgente'];
  types text[] := ARRAY['execucao','criacao','revisao','planejamento','suporte'];
  weights int[] := ARRAY[1,2,3,5,8];
  proj uuid; dep uuid; cli uuid; mem uuid;
  t_created timestamptz; t_started timestamptz; t_done timestamptz;
  tid uuid; cx int; reopens int; reviews int;
BEGIN
  PERFORM setseed(0.42);
  FOR i IN 1..60 LOOP
    s := statuses[1 + floor(random()*8)::int];
    SELECT id INTO proj FROM public.projects ORDER BY md5(id::text || i::text) LIMIT 1;
    SELECT department_id, client_id INTO dep, cli FROM public.projects WHERE id = proj;
    SELECT id INTO mem FROM public.members ORDER BY md5(id::text || (i*7)::text) LIMIT 1;
    t_created := now() - (random()*70 + 3) * interval '1 day';
    cx := weights[1 + floor(random()*5)::int];
    reopens := CASE WHEN random() < 0.18 THEN 1 + floor(random()*2)::int ELSE 0 END;
    reviews := CASE WHEN random() < 0.5 THEN 1 + floor(random()*3)::int ELSE 0 END;

    t_started := NULL; t_done := NULL;
    IF s <> 'backlog' AND s <> 'a_fazer' AND s <> 'cancelado' THEN
      t_started := t_created + (random()*3 + 0.2) * interval '1 day';
    END IF;
    IF s = 'concluido' THEN
      t_done := COALESCE(t_started, t_created) + (random()*10 + 0.5) * interval '1 day';
    END IF;

    tid := gen_random_uuid();
    INSERT INTO public.tasks (id, title, description, project_id, department_id, client_id, assignee_id, status, priority, complexity, task_type, due_date, started_at, completed_at, reopen_count, review_count, block_reason, created_at, updated_at)
    VALUES (
      tid,
      (ARRAY['Briefing','Roteiro','Peça gráfica','Landing page','Relatório','Aprovação de arte','Edição de vídeo','Proposta comercial','Checklist operacional','Integração de API','Plano de mídia','Cobertura do evento'])[1 + floor(random()*12)::int] || ' #' || i,
      'Demanda gerada automaticamente para demonstração do sistema.',
      proj, dep, cli, mem, s,
      prios[1 + floor(random()*4)::int],
      cx,
      types[1 + floor(random()*5)::int],
      (t_created + (random()*20 + 2) * interval '1 day')::date,
      t_started, t_done, reopens, reviews,
      CASE WHEN s = 'bloqueado' THEN 'Aguardando material do cliente' ELSE NULL END,
      t_created, COALESCE(t_done, t_started, t_created)
    );

    INSERT INTO public.task_status_history (task_id, from_status, to_status, changed_by, entered_at, exited_at, duration_minutes)
    VALUES (tid, NULL, 'backlog', mem, t_created, COALESCE(t_started, t_created + interval '6 hours'),
      (EXTRACT(EPOCH FROM (COALESCE(t_started, t_created + interval '6 hours') - t_created))/60)::int);

    IF t_started IS NOT NULL THEN
      INSERT INTO public.task_status_history (task_id, from_status, to_status, changed_by, entered_at, exited_at, duration_minutes)
      VALUES (tid, 'backlog', 'em_andamento', mem, t_started, t_done,
        CASE WHEN t_done IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM (t_done - t_started))/60)::int END);
    END IF;

    IF t_done IS NOT NULL THEN
      INSERT INTO public.task_status_history (task_id, from_status, to_status, changed_by, entered_at)
      VALUES (tid, 'em_andamento', 'concluido', mem, t_done);
    END IF;
  END LOOP;
END
$seed$;

ALTER TABLE public.tasks ENABLE TRIGGER trg_tasks_insert;
