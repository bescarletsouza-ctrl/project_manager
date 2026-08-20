-- Portfólios/clusters viram organização PESSOAL: cada usuário cria e vê só
-- os próprios portfólios, e decide independentemente quais projetos entram
-- em cada um -- sem afetar a visão de mais ninguém (era pedido explícito:
-- "isso fica só na minha visualização").
--
-- Antes, um projeto só podia estar em UM portfólio (campo projects.portfolio_id,
-- global, visível/editável por todo mundo). Isso não sustenta "cada usuário
-- decide por si": se o usuário A bota o projeto X no portfólio dele, não dá
-- pra também deixar o usuário B, independentemente, decidir se X está ou não
-- num portfólio dele -- é o mesmo campo. Por isso a associação vira uma
-- tabela N:N (portfolio_projects), já que cada portfólio agora pertence a
-- um usuário só. projects.portfolio_id fica no banco sem uso (não é
-- dropado, só o app para de ler/escrever nele) -- evita migração destrutiva.

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.members(id) ON DELETE SET NULL;

ALTER TABLE public.portfolios
  ALTER COLUMN created_by SET DEFAULT public.current_member_id();

-- Backfill: portfólio que já tinha "responsável" (owner_id) vira dono dele
-- também pra fins de visibilidade. Sem owner, fica sem dono -- a policy de
-- leitura abaixo mantém esses visíveis pra todo mundo, pra não sumir dado
-- que já existia sem ter como saber de quem era.
UPDATE public.portfolios SET created_by = owner_id WHERE created_by IS NULL AND owner_id IS NOT NULL;

DROP POLICY IF EXISTS "portfolios read" ON public.portfolios;
DROP POLICY IF EXISTS "portfolios write" ON public.portfolios;
DROP POLICY IF EXISTS "portfolios insert" ON public.portfolios;
DROP POLICY IF EXISTS "portfolios update" ON public.portfolios;
DROP POLICY IF EXISTS "portfolios delete" ON public.portfolios;

CREATE POLICY "portfolios read" ON public.portfolios FOR SELECT TO authenticated
  USING (created_by IS NULL OR created_by = public.current_member_id() OR public.is_admin());

CREATE POLICY "portfolios insert" ON public.portfolios FOR INSERT TO authenticated
  WITH CHECK (created_by = public.current_member_id() OR public.is_admin());

CREATE POLICY "portfolios update" ON public.portfolios FOR UPDATE TO authenticated
  USING (created_by IS NULL OR created_by = public.current_member_id() OR public.is_admin())
  WITH CHECK (created_by IS NULL OR created_by = public.current_member_id() OR public.is_admin());

CREATE POLICY "portfolios delete" ON public.portfolios FOR DELETE TO authenticated
  USING (created_by IS NULL OR created_by = public.current_member_id() OR public.is_admin());

CREATE TABLE IF NOT EXISTS public.portfolio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, project_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_projects TO authenticated;
GRANT ALL ON public.portfolio_projects TO service_role;
ALTER TABLE public.portfolio_projects ENABLE ROW LEVEL SECURITY;

-- Acesso à linha de vínculo segue o dono do PORTFÓLIO (não do projeto,
-- que continua sendo visto por todo mundo normalmente) -- só quem pode ver
-- o portfólio pode ver/editar o que está dentro dele.
DROP POLICY IF EXISTS "portfolio_projects read" ON public.portfolio_projects;
DROP POLICY IF EXISTS "portfolio_projects write" ON public.portfolio_projects;

CREATE POLICY "portfolio_projects read" ON public.portfolio_projects FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolios p
      WHERE p.id = portfolio_id
        AND (p.created_by IS NULL OR p.created_by = public.current_member_id() OR public.is_admin())
    )
  );

CREATE POLICY "portfolio_projects write" ON public.portfolio_projects FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolios p
      WHERE p.id = portfolio_id
        AND (p.created_by IS NULL OR p.created_by = public.current_member_id() OR public.is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.portfolios p
      WHERE p.id = portfolio_id
        AND (p.created_by IS NULL OR p.created_by = public.current_member_id() OR public.is_admin())
    )
  );

-- Backfill: leva pra tabela nova o que já estava associado via
-- projects.portfolio_id, sem perder nada do que já tinha sido organizado.
INSERT INTO public.portfolio_projects (portfolio_id, project_id)
SELECT portfolio_id, id FROM public.projects WHERE portfolio_id IS NOT NULL
ON CONFLICT (portfolio_id, project_id) DO NOTHING;
