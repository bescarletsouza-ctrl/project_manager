-- Flag "não planejada": marca a tarefa quando ela é CRIADA numa seção
-- "Não planejado" (reconhecida por nome, ver isUnplannedSectionName em
-- src/lib/domain.ts). Fica gravada no INSERT e não muda mais depois — mesmo
-- que a tarefa seja movida pra outra seção (ex.: Sprint) ou ganhe projeto —
-- porque o que interessa pro relatório é a ORIGEM da demanda (entrou fora do
-- planejamento), não onde ela está agora.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS unplanned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tasks.unplanned IS
  'true quando a tarefa foi criada numa seção "Não planejado" — mantém o valor mesmo se a seção mudar depois. Usado nos relatórios de fora do planejamento.';

-- Backfill: tarefas já existentes que HOJE estão numa seção "Não planejado"
-- entram marcadas, já que não temos histórico de qual era a seção no
-- momento da criação. Cobre acento e sem acento no nome da seção.
UPDATE public.tasks t
SET unplanned = true
FROM public.sections s
WHERE t.section_id = s.id
  AND lower(trim(s.name)) IN ('não planejado', 'nao planejado');
