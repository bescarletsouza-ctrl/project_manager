-- Imagem colada na descrição da tarefa: bucket público (diferente do
-- task-attachments, que é privado com signed URL de 5 min — não serve
-- pra imagem embutida no meio do texto, que precisa de URL estável).
--
-- Convenção do caminho: <task_id>/<uuid>-<arquivo>, mesmo padrão do
-- task-attachments — quem tem acesso de escrita na tarefa cai na pasta certa.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-description-images',
  'task-description-images',
  true, -- público: URL direta, sem signed URL
  8 * 1024 * 1024, -- 8 MB por imagem
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ---------- políticas no storage.objects ----------

CREATE POLICY "task-description-images read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'task-description-images'
);

CREATE POLICY "task-description-images upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'task-description-images'
  AND public.can_write_task((split_part(name, '/', 1))::uuid)
);

CREATE POLICY "task-description-images delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'task-description-images'
  AND (
    public.is_admin()
    OR (owner IS NOT NULL AND owner = auth.uid())
  )
);
