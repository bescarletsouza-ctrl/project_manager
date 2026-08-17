-- Anexos de tarefa vinham travando em PDFs "grandes demais" com o limite de
-- 10 MB definido em 20260804140000_anexos_de_comentario.sql. Sobe pra 50 MB
-- (mesmo padrão da migration 20260810120000, que já tinha ampliado os tipos
-- de arquivo aceitos sem mexer no tamanho).
--
-- Atenção: o bucket não pode aceitar mais do que o limite global do projeto
-- Supabase (Dashboard → Storage → Settings → "Upload file size limit"). Se
-- esse limite global estiver abaixo de 50 MB, precisa subir ele também —
-- senão o upload continua recusando mesmo com o bucket liberado aqui.

UPDATE storage.buckets
SET file_size_limit = 50 * 1024 * 1024
WHERE id = 'task-attachments';
