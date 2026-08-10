-- Anexos de tarefa: liberar qualquer tipo de arquivo (Word, Excel, PDF,
-- imagens, etc.), não só a lista curta de 20260804140000.
--
-- allowed_mime_types = NULL remove a restrição de tipo no bucket, mantendo
-- o limite de tamanho já existente.

UPDATE storage.buckets
SET allowed_mime_types = NULL
WHERE id = 'task-attachments';
