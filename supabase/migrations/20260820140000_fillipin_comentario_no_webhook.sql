-- fillipin_status_webhook ganha um parametro opcional `comentario`: quando
-- o responsavel finaliza a demanda no Fillipin e escreve um comentario, ele
-- sobe pra tarefa correspondente aqui como um comentario normal.
--
-- Parametro NOVO com DEFAULT null -- chamada existente do Felipe (so
-- chave/task_id/status) continua funcionando sem mudanca nenhuma do lado
-- dele; so passa a incluir comentario quando quiser.
--
-- Texto vem de fora (nao confiavel) e o corpo do comentario e renderizado
-- como HTML puro no app (RichTextView) -- por isso escapa &, <, >, aspas
-- antes de gravar, senao um comentario malicioso no Fillipin vira XSS pra
-- quem abrir a tarefa aqui.
--
-- O insert do comentario roda ANTES do "ja estava atualizado" virar early
-- return -- senao um comentario mandado numa chamada onde o status nao
-- mudou (ex.: alguem manda o mesmo status de novo so pra anexar uma nota)
-- seria silenciosamente perdido.

CREATE OR REPLACE FUNCTION public.fillipin_status_webhook(
  chave text,
  task_id uuid,
  status text,
  comentario text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task_id uuid := task_id;
  v_status_in text := status;
  v_comentario text := comentario;
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
  v_comment_html text;
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

  -- Comentario entra sempre que vier preenchido, independente do status ter
  -- mudado ou nao -- nunca fica silenciosamente de fora.
  IF v_comentario IS NOT NULL AND length(trim(v_comentario)) > 0 THEN
    v_comment_html := replace(replace(replace(replace(replace(
      trim(v_comentario),
      '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
    v_comment_html := regexp_replace(v_comment_html, E'\r?\n', '<br/>', 'g');

    -- Atribuído ao responsável (assignee) da tarefa -- é a melhor referência
    -- real de "quem" no Fillipin, já que não existe usuário do Fillipin
    -- aqui dentro. O prefixo deixa claro que veio de fora, não digitado
    -- direto no Alana.
    INSERT INTO public.task_comments(task_id, author_member_id, author_user_id, body)
    VALUES (v_task_id, v_assignee, NULL, '<p><strong>💬 Comentário do Fillipin:</strong></p><p>' || v_comment_html || '</p>');
  END IF;

  IF v_old_status = v_new_status THEN
    RETURN jsonb_build_object('ok', true, 'info', 'status ja estava atualizado');
  END IF;

  UPDATE public.tasks SET status = v_new_status WHERE id = v_task_id;

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

REVOKE ALL ON FUNCTION public.fillipin_status_webhook(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fillipin_status_webhook(text, uuid, text, text) TO anon, authenticated;

-- A assinatura antiga (3 parametros) fica orfa depois do CREATE OR REPLACE
-- acima criar a versao de 4 -- sem overload, chamada com so 3 args (chave,
-- task_id, status) ainda bate nessa mesma funcao porque comentario tem
-- DEFAULT. Remove a entrada de 3-arg antiga do catalogo pra nao duplicar
-- func_name na hora de conceder permissao de novo (idempotente).
DROP FUNCTION IF EXISTS public.fillipin_status_webhook(text, uuid, text);
