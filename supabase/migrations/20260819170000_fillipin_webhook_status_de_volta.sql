-- Fecha o ciclo com o Fillipin: quando a demanda muda de status LÁ, o
-- Fillipin chama esta RPC pra refletir a mudança AQUI, em qualquer projeto/
-- departamento, e gerar notificação na Caixa de Entrada -- exatamente como
-- pedido: em_revisao -> aguardando_aprovacao, entregue -> concluido.
--
-- Correlação: passamos a mandar `external_id` (o id da tarefa aqui no Alana)
-- no POST de criação da demanda (send_fillipin_demand, alterado abaixo). O
-- Fillipin guarda esse id e devolve ele como `task_id` na chamada do webhook.
--
-- Autenticação: RPC exposta via PostgREST (precisa do header `apikey` do
-- Supabase, que não é segredo -- é o mesmo publishable key do front). A
-- autenticação de verdade é o parâmetro `chave`, validado contra
-- public._app_secrets, no mesmo padrão da fillipin_api_key. Depois de aplicar
-- esta migration, rodar uma vez no SQL editor:
--   insert into public._app_secrets(key, value)
--   values ('fillipin_webhook_secret', 'COLOQUE_AQUI_O_SEGREDO_GERADO');
--
-- 'concluido' já dispara notificação (kind='concluida') sozinho via o
-- trigger trg_tasks_field_activity (track_task_field_changes) que já existe
-- em public.tasks -- não duplicamos aqui. 'aguardando_aprovacao' não tem
-- notificação automática nenhuma hoje (só section change e conclusão têm),
-- então essa função insere manualmente, no mesmo formato usado em
-- notifyStatusMilestone() do app (kind='status').

-- 1. Passa a mandar o id da tarefa junto com a demanda, pra correlacionar a
-- volta.
CREATE OR REPLACE FUNCTION public.send_fillipin_demand()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dept_name text;
  v_api_key text;
  v_assignee_email text;
  v_assignee_name text;
  v_prioridade text;
  v_ads boolean;
  v_request_id bigint;
BEGIN
  IF NEW.fillipin_sent_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.due_date IS NULL OR NEW.department_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_dept_name FROM public.departments WHERE id = NEW.department_id;
  IF v_dept_name IS NULL OR unaccent(lower(trim(v_dept_name))) <> 'video' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT value INTO v_api_key FROM public._app_secrets WHERE key = 'fillipin_api_key';
    IF v_api_key IS NULL THEN
      RAISE EXCEPTION 'fillipin_api_key nao configurada em public._app_secrets';
    END IF;

    SELECT email, name INTO v_assignee_email, v_assignee_name
      FROM public.members WHERE id = NEW.assignee_id;

    v_prioridade := CASE NEW.priority
      WHEN 'baixa' THEN 'BAIXA'
      WHEN 'media' THEN 'NORMAL'
      WHEN 'alta' THEN 'ALTA'
      WHEN 'urgente' THEN 'URGENTE'
      ELSE NULL
    END;

    v_ads := EXISTS (
      SELECT 1 FROM unnest(coalesce(NEW.tags, '{}')) t WHERE lower(trim(t)) = 'ads'
    );

    SELECT net.http_post(
      url := 'https://www.fillipin.com.br/api/external-demands',
      headers := jsonb_build_object(
        'X-Api-Key', v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_strip_nulls(jsonb_build_object(
        'titulo', NEW.title,
        'descricao', coalesce(NEW.description, ''),
        'prazo', to_char(NEW.due_date, 'YYYY-MM-DD'),
        'responsavel', coalesce(v_assignee_email, v_assignee_name),
        'prioridade', v_prioridade,
        'ads', v_ads,
        'external_id', NEW.id::text
      ))
    ) INTO v_request_id;

    UPDATE public.tasks
      SET fillipin_sent_at = now(),
          fillipin_request_id = v_request_id,
          fillipin_sync_error = NULL
      WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.tasks
      SET fillipin_sent_at = now(),
          fillipin_sync_error = SQLERRM
      WHERE id = NEW.id;
  END;

  RETURN NEW;
END;
$$;

-- 2. RPC que o Fillipin chama de volta quando o status da demanda muda.
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
  -- task_id/status colidem com colunas de mesmo nome em outras tabelas
  -- (task_comments.task_id, notifications.task_id) usadas dentro da funcao;
  -- o Postgres recusa a query com "column reference is ambiguous" se a
  -- gente referenciar o parametro puro nesses pontos. Isola em variavel v_
  -- logo de cara e nunca mais toca no parametro cru dai pra frente.
  v_task_id uuid := task_id;
  v_status_in text := status;
  v_secret text;
  v_new_status text;
  v_status_label text;
  v_title text;
  v_assignee uuid;
  v_created_by uuid;
  v_project uuid;
  v_old_status text;
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

  SELECT t.title, t.assignee_id, t.created_by, t.project_id, t.status
    INTO v_title, v_assignee, v_created_by, v_project, v_old_status
  FROM public.tasks t WHERE t.id = v_task_id;

  IF v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tarefa nao encontrada');
  END IF;

  IF v_old_status = v_new_status THEN
    RETURN jsonb_build_object('ok', true, 'info', 'status ja estava atualizado');
  END IF;

  UPDATE public.tasks SET status = v_new_status WHERE id = v_task_id;

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
