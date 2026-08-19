-- Toda tarefa que entra (ou já nasce) no departamento "Vídeo" com prazo
-- definido dispara uma demanda no sistema Fillipin (produção do time de
-- vídeo), via POST https://www.fillipin.com.br/api/external-demands.
--
-- Segue o mesmo padrão do e-mail por notificação
-- (20260817130000_email_por_notificacao.sql): trigger AFTER INSERT/UPDATE em
-- public.tasks, chamando a API externa via pg_net, com a API key guardada em
-- public._app_secrets (sem policy de RLS -- só quem bypassa RLS enxerga).
--
-- Depois de aplicar esta migration, rodar uma vez no SQL editor:
--   insert into public._app_secrets(key, value)
--   values ('fillipin_api_key', 'ftk_sua_chave_aqui');
--
-- Guarda-de-envio-único: fillipin_sent_at é marcado (sucesso OU erro) assim
-- que a tarefa entra nas condições de disparo, pra nunca reenviar a mesma
-- tarefa em edições seguintes e pra nunca entrar em loop de retrigger (o
-- UPDATE que marca esse campo dispara o trigger de novo, e a nova chamada já
-- encontra o campo preenchido e retorna na hora). Erros ficam visíveis em
-- fillipin_sync_error; se precisar reenviar manualmente depois de corrigir
-- algo (ex.: API key errada), zere fillipin_sent_at na tarefa.
--
-- Departamento é resolvido pelo nome (não existe slug em public.departments),
-- comparando sem acento/caixa contra 'vídeo' -- nome confirmado com o usuário
-- em 2026-08-19. Se o departamento for renomeado, ajustar o match abaixo.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS fillipin_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS fillipin_request_id bigint,
  ADD COLUMN IF NOT EXISTS fillipin_sync_error text;

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
        'ads', false
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

DROP TRIGGER IF EXISTS trg_tasks_send_fillipin_demand ON public.tasks;
CREATE TRIGGER trg_tasks_send_fillipin_demand
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.send_fillipin_demand();
