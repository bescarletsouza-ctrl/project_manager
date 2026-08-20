-- Projetos "pontuais" (com início e fim definidos, diferente dos
-- recorrentes) ganham um botão manual de Iniciar/Finalizar pra registrar a
-- duração real de execução. Projetos recorrentes continuam 100% inalterados
-- -- default 'recorrente' garante que todo projeto já existente mantém o
-- comportamento de hoje (sem o botão, sem started_at/finished_at).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'recorrente',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_tipo_ck CHECK (tipo IN ('recorrente', 'pontual'));
