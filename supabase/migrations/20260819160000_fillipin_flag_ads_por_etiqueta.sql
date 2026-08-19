-- Complementa 20260819150000_integracao_fillipin_departamento_video.sql:
-- o campo "ads" da demanda no Fillipin (que lá dispara atribuição automática
-- pra outra pessoa) agora reflete a etiqueta "ads" da tarefa, em vez de vir
-- sempre false. Basta adicionar a etiqueta "ads" na tarefa (Etiquetas, no
-- TaskPane) antes dela entrar no departamento Vídeo com prazo -- assim como
-- o responsável, precisa estar setada ANTES do disparo, já que
-- fillipin_sent_at só permite um envio por tarefa.

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
        'ads', v_ads
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
