-- Atividade genérica de campo (responsável, prazo, departamento, seção,
-- prioridade, projeto, início, complexidade, título) — separado do
-- task_status_history existente, que continua só para status (não mexe nele,
-- é usado em cycle time/lead time/tempo por status nos relatórios).
--
-- Trigger em vez de instrumentar cada tela: a lista de lugares que editam
-- uma tarefa só cresce (Lista, Card, menu de contexto, atribuição em lote,
-- TaskPane, automações, drag-and-drop, redistribuição de carga de trabalho —
-- ver sessão de atribuição/notificação de 2026-08-07) e qualquer novo
-- caminho que apareça depois passa a registrar sozinho, sem precisar lembrar
-- de instrumentar mais um lugar.
CREATE TABLE public.task_field_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by_user uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_field_activity_task ON public.task_field_activity(task_id, created_at);
GRANT SELECT, INSERT ON public.task_field_activity TO authenticated;
GRANT ALL ON public.task_field_activity TO service_role;
ALTER TABLE public.task_field_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "field activity read" ON public.task_field_activity FOR SELECT TO authenticated USING (true);
CREATE POLICY "field activity insert" ON public.task_field_activity FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.track_task_field_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- Quem está designado sente a mudança de etapa — avisa, exceto quando
    -- foi a própria pessoa quem moveu.
    IF NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM public.current_member_id() THEN
      INSERT INTO public.notifications(member_id, kind, title, task_id, project_id, actor_member_id)
      VALUES (
        NEW.assignee_id,
        'secao',
        format('"%s" mudou de seção', NEW.title),
        NEW.id,
        NEW.project_id,
        public.current_member_id()
      );
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

  -- Tarefa concluída avisa quem está designado, exceto quando foi a própria
  -- pessoa quem concluiu.
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido'
     AND NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM public.current_member_id() THEN
    INSERT INTO public.notifications(member_id, kind, title, task_id, project_id, actor_member_id)
    VALUES (
      NEW.assignee_id,
      'concluida',
      format('"%s" foi concluída', NEW.title),
      NEW.id,
      NEW.project_id,
      public.current_member_id()
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_field_activity ON public.tasks;
CREATE TRIGGER trg_tasks_field_activity AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.track_task_field_changes();
