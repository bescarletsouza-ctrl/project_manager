-- Anexos em comentários de tarefa.
--
-- Cria o bucket "task-attachments" (privado, ver policies abaixo), uma
-- tabela que aponta para cada arquivo carregado, e as políticas RLS
-- correspondentes — herdando o acesso da tarefa via can_write_task /
-- has_task_access (definidos em 20260804130000_controle_de_acesso.sql).
--
-- Convenção do caminho no Storage: <task_id>/<uuid>-<arquivo>
-- Assim quem tem acesso à tarefa cai naturalmente na pasta certa.

-- ---------- tabela ----------
CREATE TABLE public.task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.task_comments(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by_member uuid REFERENCES public.members(id) ON DELETE SET NULL,
  uploaded_by_user uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_attachments_task_idx ON public.task_attachments(task_id, created_at);
CREATE INDEX task_attachments_comment_idx ON public.task_attachments(comment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_attachments TO authenticated;
GRANT ALL ON public.task_attachments TO service_role;

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments read" ON public.task_attachments FOR SELECT TO authenticated USING (
  public.is_admin() OR public.has_task_access(task_id)
);

CREATE POLICY "attachments insert" ON public.task_attachments FOR INSERT TO authenticated WITH CHECK (
  public.can_write_task(task_id)
);

-- Só o autor apaga; admin idem.
CREATE POLICY "attachments delete own" ON public.task_attachments FOR DELETE TO authenticated USING (
  public.is_admin()
  OR uploaded_by_user = auth.uid()
  OR uploaded_by_member = public.current_member_id()
);

-- ---------- bucket no Storage ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  false, -- privado, acesso via signed URL
  10 * 1024 * 1024, -- 10 MB por arquivo
  ARRAY[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ---------- políticas no storage.objects ----------
-- Convenção: primeiro segmento do path é o task_id, e o acesso segue o da
-- tarefa. Como o cliente sobe via supabase.storage.from(...).upload(), a
-- verificação precisa estar em storage.objects (não na tabela).

CREATE POLICY "task-attachments read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'task-attachments'
  AND (
    public.is_admin()
    OR public.has_task_access((split_part(name, '/', 1))::uuid)
  )
);

CREATE POLICY "task-attachments upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'task-attachments'
  AND public.can_write_task((split_part(name, '/', 1))::uuid)
);

CREATE POLICY "task-attachments delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'task-attachments'
  AND (
    public.is_admin()
    OR (
      owner IS NOT NULL AND owner = auth.uid()
    )
  )
);
