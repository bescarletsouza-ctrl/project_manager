-- 1. Backfill adicional de "unplanned": pega tarefas que ja ESTIVERAM numa
-- secao "Nao planejado" em algum momento (segundo o historico de mudanca de
-- secao em task_field_activity), mesmo que hoje estejam em outra secao. O
-- backfill anterior (migration 20260812120000) so olhava a secao ATUAL da
-- tarefa -- uma tarefa que ja tinha saido de "Nao planejado" antes daquele
-- backfill rodar nunca foi marcada.
UPDATE public.tasks t
SET unplanned = true
WHERE t.unplanned = false
  AND EXISTS (
    SELECT 1
    FROM public.task_field_activity a
    JOIN public.sections s
      ON s.id::text = a.old_value OR s.id::text = a.new_value
    WHERE a.task_id = t.id
      AND a.field = 'section_id'
      AND lower(trim(s.name)) IN ('não planejado', 'nao planejado')
  );

-- 2. Quem criou a tarefa. Backfill usa a primeira linha de
-- task_status_history (from_status IS NULL = criacao), que ja guarda
-- changed_by_user desde sempre. Daqui pra frente, o DEFAULT captura sozinho
-- via current_member_id() -- nao precisa mexer em nenhum fluxo de criacao
-- no app.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.members(id) ON DELETE SET NULL;

UPDATE public.tasks t
SET created_by = m.id
FROM public.task_status_history h
JOIN public.members m ON m.user_id = h.changed_by_user
WHERE h.task_id = t.id
  AND h.from_status IS NULL
  AND t.created_by IS NULL;

ALTER TABLE public.tasks ALTER COLUMN created_by SET DEFAULT public.current_member_id();

-- 3. Regra de negocio: toda movimentacao (mudanca de secao, ou conclusao) de
-- uma tarefa ainda aberta avisa quem criou a demanda e todo mundo marcado
-- (@) em comentarios dela -- alem de quem ja era avisado (responsavel) --
-- exceto quem fez a propria movimentacao. Redefine a funcao inteira (ja
-- existia, so tratava o responsavel); os demais blocos (assignee_id,
-- due_date, start_date, department_id, project_id, priority, complexity,
-- title -> task_field_activity) ficam identicos aos da migration anterior.
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

    -- Tarefa ainda aberta: avisa responsavel + quem criou + mencionados nos
    -- comentarios, exceto quem moveu.
    IF NEW.status NOT IN ('concluido', 'cancelado') THEN
      INSERT INTO public.notifications(member_id, kind, title, task_id, project_id, actor_member_id)
      SELECT DISTINCT alvo, 'secao', format('"%s" mudou de seção', NEW.title), NEW.id, NEW.project_id, public.current_member_id()
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

  -- Tarefa concluida: mesma regra (responsavel + criador + mencionados),
  -- exceto quem concluiu.
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    INSERT INTO public.notifications(member_id, kind, title, task_id, project_id, actor_member_id)
    SELECT DISTINCT alvo, 'concluida', format('"%s" foi concluída', NEW.title), NEW.id, NEW.project_id, public.current_member_id()
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
