-- As automacoes de departamento ("quando status muda, mover pra secao X")
-- rodam hoje inteiramente no browser (runAutomations em
-- src/lib/automations.ts, chamado pelos hooks de mutation da UI) -- nunca
-- foram pensadas pra rodar a partir de uma UPDATE feita fora do app. Como
-- fillipin_status_webhook atualiza tasks.status direto via SQL, a automacao
-- de "mover para secao" configurada no departamento nunca disparava: o
-- status batia, mas o card ficava parado na secao antiga.
--
-- Replica em SQL só a fatia relevante da regra (trigger_type=status_changed,
-- action_type=move_section, container = departamento principal da tarefa) --
-- mesma logica de public.automations que o client usa, sem tocar no motor
-- em si nem nas automacoes de projeto/departamento secundario, que não se
-- aplicam aqui (Fillipin só mexe no departamento principal da tarefa).

CREATE OR REPLACE FUNCTION public.fillipin_status_webhook(
  chave text,
  task_id uuid,
  status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task_id uuid := task_id;
  v_status_in text := status;
  v_secret text;
  v_new_status text;
  v_status_label text;
  v_title text;
  v_assignee uuid;
  v_created_by uuid;
  v_project uuid;
  v_department_id uuid;
  v_old_status text;
  v_target_section uuid;
BEGIN
  SELECT value INTO v_secret FROM public._app_secrets WHERE key = 'fillipin_webhook_secret';
  IF v_secret IS NULL OR chave IS DISTINCT FROM v_secret THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chave invalida');
  END IF;

  v_new_status := CASE v_status_in
    WHEN 'em_revisao' THEN 'aguardando_aprovacao'
    WHEN 'entregue' THEN 'concluido'
    ELSE NULL
  END;

  IF v_new_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status nao mapeado: ' || coalesce(v_status_in, 'null'));
  END IF;

  SELECT t.title, t.assignee_id, t.created_by, t.project_id, t.department_id, t.status
    INTO v_title, v_assignee, v_created_by, v_project, v_department_id, v_old_status
  FROM public.tasks t WHERE t.id = v_task_id;

  IF v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tarefa nao encontrada');
  END IF;

  IF v_old_status = v_new_status THEN
    RETURN jsonb_build_object('ok', true, 'info', 'status ja estava atualizado');
  END IF;

  UPDATE public.tasks SET status = v_new_status WHERE id = v_task_id;

  -- Automacao de departamento configurada para esse status: mesma regra que
  -- o painel de automacoes aplicaria (departamento = principal da tarefa,
  -- trigger_value nulo = qualquer status, ou igual ao novo status).
  IF v_department_id IS NOT NULL THEN
    SELECT action_value::uuid INTO v_target_section
    FROM public.automations
    WHERE active = true
      AND department_id = v_department_id
      AND trigger_type = 'status_changed'
      AND action_type = 'move_section'
      AND (trigger_value IS NULL OR trigger_value = v_new_status)
    ORDER BY created_at
    LIMIT 1;

    IF v_target_section IS NOT NULL THEN
      UPDATE public.tasks SET section_id = v_target_section WHERE id = v_task_id;
    END IF;
  END IF;

  IF v_new_status <> 'concluido' THEN
    v_status_label := CASE v_new_status
      WHEN 'aguardando_aprovacao' THEN 'Aguardando aprovação'
      ELSE v_new_status
    END;

    INSERT INTO public.notifications(member_id, kind, title, task_id, project_id)
    SELECT DISTINCT alvo, 'status',
      format('Fillipin moveu "%s" para %s', v_title, v_status_label),
      v_task_id, v_project
    FROM (
      SELECT v_assignee AS alvo
      UNION
      SELECT v_created_by
      UNION
      SELECT cm.member_id
      FROM public.comment_mentions cm
      JOIN public.task_comments tc ON tc.id = cm.comment_id
      WHERE tc.task_id = v_task_id
    ) alvos
    WHERE alvo IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fillipin_status_webhook(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fillipin_status_webhook(text, uuid, text) TO anon, authenticated;
