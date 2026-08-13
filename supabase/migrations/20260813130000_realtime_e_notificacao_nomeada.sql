-- 1. Habilita Realtime (postgres_changes) nas tabelas que o front passa a
-- assinar -- sem isso o supabase-js nao entrega evento nenhum, mesmo com o
-- client escutando. RLS de cada tabela ja e aberta pra "authenticated" (ver
-- migrations anteriores), entao nao precisa mexer em policy. Idempotente:
-- ALTER PUBLICATION ... ADD TABLE da erro se a tabela ja estiver la, entao
-- so adiciona quando ainda nao esta -- seguro rodar esta migration de novo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_projects'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_projects;
  END IF;
END $$;

-- 2. Notificacao nomeada: titulo passa a dizer QUEM fez a movimentacao e,
-- no caso de mudanca de secao, PRA ONDE foi. Redefine a funcao inteira (so
-- os dois INSERT INTO notifications mudam -- os blocos de
-- task_field_activity ficam identicos a migration anterior).
CREATE OR REPLACE FUNCTION public.track_task_field_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ator_nome text;
  secao_nome text;
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'assignee_id', OLD.assignee_id::text, NEW.assignee_id::text, auth.uid());
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'due_date', OLD.due_date::text, NEW.due_date::text, auth.uid());
  END IF;
  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'start_date', OLD.start_date::text, NEW.start_date::text, auth.uid());
  END IF;
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'department_id', OLD.department_id::text, NEW.department_id::text, auth.uid());
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'project_id', OLD.project_id::text, NEW.project_id::text, auth.uid());
  END IF;

  IF NEW.section_id IS DISTINCT FROM OLD.section_id THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'section_id', OLD.section_id::text, NEW.section_id::text, auth.uid());

    IF NEW.status NOT IN ('concluido', 'cancelado') THEN
      SELECT name INTO ator_nome FROM public.members WHERE id = public.current_member_id();
      SELECT name INTO secao_nome FROM public.sections WHERE id = NEW.section_id;

      INSERT INTO public.notifications(member_id, kind, title, task_id, project_id, actor_member_id)
      SELECT DISTINCT alvo,
        'secao',
        format('%s moveu "%s" para %s',
          coalesce(ator_nome, 'Alguém'), NEW.title, coalesce(secao_nome, 'sem seção')),
        NEW.id, NEW.project_id, public.current_member_id()
      FROM (
        SELECT NEW.assignee_id AS alvo
        UNION
        SELECT NEW.created_by
        UNION
        SELECT cm.member_id
        FROM public.comment_mentions cm
        JOIN public.task_comments tc ON tc.id = cm.comment_id
        WHERE tc.task_id = NEW.id
      ) alvos
      WHERE alvo IS NOT NULL
        AND alvo IS DISTINCT FROM public.current_member_id();
    END IF;
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'priority', OLD.priority, NEW.priority, auth.uid());
  END IF;
  IF NEW.complexity IS DISTINCT FROM OLD.complexity THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'complexity', OLD.complexity::text, NEW.complexity::text, auth.uid());
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    INSERT INTO public.task_field_activity(task_id, field, old_value, new_value, changed_by_user)
    VALUES (NEW.id, 'title', OLD.title, NEW.title, auth.uid());
  END IF;

  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    SELECT name INTO ator_nome FROM public.members WHERE id = public.current_member_id();

    INSERT INTO public.notifications(member_id, kind, title, task_id, project_id, actor_member_id)
    SELECT DISTINCT alvo,
      'concluida',
      format('%s concluiu "%s"', coalesce(ator_nome, 'Alguém'), NEW.title),
      NEW.id, NEW.project_id, public.current_member_id()
    FROM (
      SELECT NEW.assignee_id AS alvo
      UNION
      SELECT NEW.created_by
      UNION
      SELECT cm.member_id
      FROM public.comment_mentions cm
      JOIN public.task_comments tc ON tc.id = cm.comment_id
      WHERE tc.task_id = NEW.id
    ) alvos
    WHERE alvo IS NOT NULL
      AND alvo IS DISTINCT FROM public.current_member_id();
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_field_activity ON public.tasks;
CREATE TRIGGER trg_tasks_field_activity AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.track_task_field_changes();
