-- Toda notificação que cai na Caixa de Entrada (`public.notifications`) passa
-- a gerar também um e-mail via Resend, na hora, com o mesmo conteúdo que
-- aparece na tela (título, corpo, projeto, tipo) e um link que abre a tarefa
-- correspondente direto em /caixa-de-entrada?task=<id>.
--
-- Não instrumenta os pontos que criam notificação (createNotifications no
-- client + os triggers de tasks) -- todos já convergem para um INSERT em
-- notifications, então um único trigger AFTER INSERT nessa tabela cobre
-- qualquer regra existente ou futura, sem duplicar lógica.
--
-- A API key do Resend fica em public._app_secrets (RLS ligado, sem nenhuma
-- policy -- só quem bypassa RLS, ex. o dono da tabela, consegue ler; anon/
-- authenticated não enxergam nada). Tentamos o Vault do Supabase primeiro,
-- mas vault.decrypted_secrets voltava NULL de dentro da function SECURITY
-- DEFINER mesmo com o secret existindo e com search_path incluindo
-- vault/pgsodium -- não valia continuar caçando a causa às cegas.
--
-- Depois de aplicar esta migration, rodar uma vez no SQL editor:
--   insert into public._app_secrets(key, value) values ('resend_api_key', 're_sua_chave_aqui');
-- Se o secret não existir ainda, a função simplesmente não envia e-mail
-- (não quebra o INSERT da notificação). Qualquer erro na chamada ao Resend
-- também é engolido pelo mesmo motivo.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public._app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE public._app_secrets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.send_notification_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_api_key text;
  v_email text;
  v_name text;
  v_project text;
  v_kind_label text;
  v_link text;
  v_html text;
BEGIN
  SELECT value INTO v_api_key FROM public._app_secrets WHERE key = 'resend_api_key';
  IF v_api_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT email, name INTO v_email, v_name FROM public.members WHERE id = NEW.member_id;
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_project FROM public.projects WHERE id = NEW.project_id;

  v_kind_label := CASE NEW.kind
    WHEN 'atribuicao' THEN 'Atribuição'
    WHEN 'mencao' THEN 'Menção'
    WHEN 'comentario' THEN 'Comentário'
    WHEN 'status' THEN 'Status'
    WHEN 'prazo' THEN 'Prazo'
    WHEN 'dependencia' THEN 'Dependência'
    WHEN 'atividade' THEN 'Atividade'
    WHEN 'secao' THEN 'Seção'
    WHEN 'concluida' THEN 'Concluída'
    ELSE NEW.kind
  END;

  v_link := 'https://project-manager-kappa-three.vercel.app/caixa-de-entrada'
    || CASE WHEN NEW.task_id IS NOT NULL THEN '?task=' || NEW.task_id::text ELSE '' END;

  v_html := '<div style="font-family:sans-serif;font-size:14px;color:#111;max-width:480px">'
    || '<p style="display:inline-block;background:#f1f1f1;border-radius:6px;padding:2px 8px;font-size:12px;color:#555;margin:0 0 12px">'
    || v_kind_label || '</p>'
    || '<p style="font-size:15px;font-weight:600;margin:0 0 6px">' || NEW.title || '</p>'
    || CASE WHEN NEW.body IS NOT NULL THEN '<p style="color:#444;margin:0 0 12px">' || NEW.body || '</p>' ELSE '' END
    || '<p style="color:#888;font-size:12px;margin:0 0 16px">' || coalesce(v_project, '') || '</p>'
    || '<a href="' || v_link || '" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px">Abrir tarefa</a>'
    || '</div>';

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Alana <notifications@alana.dtsgroup.com.br>',
      'to', v_email,
      'subject', NEW.title,
      'html', v_html
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_send_email ON public.notifications;
CREATE TRIGGER trg_notifications_send_email AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.send_notification_email();
