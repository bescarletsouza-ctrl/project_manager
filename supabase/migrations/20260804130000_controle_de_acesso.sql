-- Controle de acesso por papel: admin, colaborador, visualizador.
--
-- admin        cria/edita/exclui projetos, gerencia equipe, vê relatórios, mexe em tudo.
-- colaborador  edita apenas os projetos em que é gestor ou tem tarefa atribuída;
--              não cria projeto, não mexe em equipe, não vê relatórios.
-- visualizador só lê — inclusive relatórios — e não escreve em nada.
--
-- Isto substitui as políticas "USING (true)" da migration inicial, que
-- liberavam qualquer escrita para todo autenticado. A tela já esconde as
-- ações fora do papel de quem está olhando, mas quem barra de verdade é o
-- banco: sem isso, dava para contornar a interface chamando a API direto.

-- ---------- papel Gestor deixou de existir ----------
UPDATE public.members SET access_role = 'colaborador' WHERE access_role NOT IN ('admin', 'colaborador', 'visualizador');
ALTER TABLE public.members
  ADD CONSTRAINT members_access_role_check CHECK (access_role IN ('admin', 'colaborador', 'visualizador'));

-- ---------- funções auxiliares ----------
-- SECURITY DEFINER: rodam com o dono da função, então conseguem consultar
-- members/projects/tasks por dentro sem entrar em recursão com as próprias
-- políticas de RLS dessas tabelas.

CREATE OR REPLACE FUNCTION public.current_member_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id FROM public.members
  WHERE user_id = auth.uid()
     OR (user_id IS NULL AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', '#')))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_member_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT access_role FROM public.members WHERE id = public.current_member_id();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.current_member_role() = 'admin';
$$;

/**
 * Gestor do projeto ou com tarefa atribuída nele (diretamente ou por vínculo
 * em task_projects). "visualizador" nunca tem acesso de escrita a projeto
 * nenhum, mesmo que apareça como gestor ou responsável por uma tarefa nele —
 * o papel é só leitura, em qualquer canto do sistema.
 */
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_project_id IS NOT NULL AND public.current_member_role() <> 'visualizador' AND (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.manager_id = public.current_member_id())
    OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.project_id = p_project_id AND t.assignee_id = public.current_member_id())
    OR EXISTS (
      SELECT 1 FROM public.task_projects tp
      JOIN public.tasks t ON t.id = tp.task_id
      WHERE tp.project_id = p_project_id AND t.assignee_id = public.current_member_id()
    )
  );
$$;

/** Acesso de LEITURA à tarefa: projeto acessível, sem projeto, ou atribuída a quem pergunta — vale para todos os papéis. */
CREATE OR REPLACE FUNCTION public.has_task_access(p_task_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task_id
      AND (t.project_id IS NULL OR public.has_project_access(t.project_id) OR t.assignee_id = public.current_member_id())
  );
$$;

/** Acesso de ESCRITA à tarefa: igual ao de leitura, mas nunca para "visualizador". */
CREATE OR REPLACE FUNCTION public.can_write_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.current_member_role() <> 'visualizador' AND public.has_task_access(p_task_id);
$$;

REVOKE ALL ON FUNCTION public.current_member_id() FROM public;
REVOKE ALL ON FUNCTION public.current_member_role() FROM public;
REVOKE ALL ON FUNCTION public.is_admin() FROM public;
REVOKE ALL ON FUNCTION public.has_project_access(uuid) FROM public;
REVOKE ALL ON FUNCTION public.has_task_access(uuid) FROM public;
REVOKE ALL ON FUNCTION public.can_write_task(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.current_member_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_member_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_task_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_task(uuid) TO authenticated;

-- ---------- referência (admin): departamentos, clientes, portfólios, equipe ----------

DROP POLICY IF EXISTS "dept write" ON public.departments;
CREATE POLICY "dept write" ON public.departments FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "clients write" ON public.clients;
CREATE POLICY "clients write" ON public.clients FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "portfolios write" ON public.portfolios;
CREATE POLICY "portfolios write" ON public.portfolios FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Equipe continua legível por todo mundo (nomes/avatares aparecem em toda a
-- aplicação), mas só admin cadastra, edita ou remove alguém.
DROP POLICY IF EXISTS "members write" ON public.members;
CREATE POLICY "members write" ON public.members FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- projetos ----------
-- Leitura continua aberta (o seletor de projeto e a busca global dependem
-- disso). Criar e excluir projeto é só admin; editar vale para quem tem acesso.

DROP POLICY IF EXISTS "projects write" ON public.projects;
CREATE POLICY "projects insert" ON public.projects FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "projects update" ON public.projects FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.has_project_access(id))
  WITH CHECK (public.is_admin() OR public.has_project_access(id));
CREATE POLICY "projects delete" ON public.projects FOR DELETE TO authenticated USING (public.is_admin());

-- ---------- estrutura do projeto: seções, campos, automações, status ----------

DROP POLICY IF EXISTS "sections write" ON public.sections;
CREATE POLICY "sections write" ON public.sections FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_project_access(project_id))
  WITH CHECK (public.is_admin() OR public.has_project_access(project_id));

DROP POLICY IF EXISTS "fields write" ON public.custom_fields;
CREATE POLICY "fields write" ON public.custom_fields FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_project_access(project_id))
  WITH CHECK (public.is_admin() OR public.has_project_access(project_id));

DROP POLICY IF EXISTS "automations write" ON public.automations;
CREATE POLICY "automations write" ON public.automations FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_project_access(project_id))
  WITH CHECK (public.is_admin() OR public.has_project_access(project_id));

DROP POLICY IF EXISTS "project statuses write" ON public.project_statuses;
CREATE POLICY "project statuses write" ON public.project_statuses FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_project_access(project_id))
  WITH CHECK (public.is_admin() OR public.has_project_access(project_id));

-- ---------- tarefas ----------
-- Leitura continua aberta (dependências e menções cruzam projetos). Escrita
-- exige acesso ao projeto da tarefa — ou ser a própria pessoa responsável,
-- para quem só tem uma tarefa avulsa sem outros vínculos no projeto.

DROP POLICY IF EXISTS "tasks write" ON public.tasks;
CREATE POLICY "tasks insert" ON public.tasks FOR INSERT TO authenticated WITH CHECK (
  public.current_member_role() <> 'visualizador'
  AND (public.is_admin() OR project_id IS NULL OR public.has_project_access(project_id))
);
CREATE POLICY "tasks update" ON public.tasks FOR UPDATE TO authenticated
  USING (
    public.current_member_role() <> 'visualizador'
    AND (
      public.is_admin() OR project_id IS NULL OR public.has_project_access(project_id)
      OR assignee_id = public.current_member_id()
    )
  )
  WITH CHECK (
    public.current_member_role() <> 'visualizador'
    AND (
      public.is_admin() OR project_id IS NULL OR public.has_project_access(project_id)
      OR assignee_id = public.current_member_id()
    )
  );
CREATE POLICY "tasks delete" ON public.tasks FOR DELETE TO authenticated USING (
  public.current_member_role() <> 'visualizador'
  AND (public.is_admin() OR project_id IS NULL OR public.has_project_access(project_id))
);

-- ---------- histórico de status (dado de relatório) ----------
-- Visão completa só para admin/visualizador; quem não é nenhum dos dois só
-- lê o histórico das tarefas às quais tem acesso (usado no painel de
-- atividade da própria tarefa).

DROP POLICY IF EXISTS "history read" ON public.task_status_history;
CREATE POLICY "history read" ON public.task_status_history FOR SELECT TO authenticated USING (
  public.current_member_role() IN ('admin', 'visualizador') OR public.has_task_access(task_id)
);

-- O trigger que grava o histórico roda como SECURITY DEFINER e não depende
-- desta política; ninguém mais precisa inserir aqui.
DROP POLICY IF EXISTS "history insert" ON public.task_status_history;

-- ---------- dependências, campos por tarefa, comentários, menções ----------

DROP POLICY IF EXISTS "deps write" ON public.task_dependencies;
CREATE POLICY "deps write" ON public.task_dependencies FOR ALL TO authenticated
  USING (public.can_write_task(task_id))
  WITH CHECK (public.can_write_task(task_id));

DROP POLICY IF EXISTS "field values write" ON public.task_field_values;
CREATE POLICY "field values write" ON public.task_field_values FOR ALL TO authenticated
  USING (public.can_write_task(task_id))
  WITH CHECK (public.can_write_task(task_id));

DROP POLICY IF EXISTS "comments insert" ON public.task_comments;
CREATE POLICY "comments insert" ON public.task_comments FOR INSERT TO authenticated WITH CHECK (
  public.can_write_task(task_id)
);
-- "comments update own" e "comments delete own" continuam como estavam: quem
-- não podia escrever nunca teve como criar o comentário para editar depois.

DROP POLICY IF EXISTS "mentions write" ON public.comment_mentions;
CREATE POLICY "mentions write" ON public.comment_mentions FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.task_comments c WHERE c.id = comment_id AND public.can_write_task(c.task_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.task_comments c WHERE c.id = comment_id AND public.can_write_task(c.task_id))
  );

-- ---------- tarefa em vários projetos ----------

DROP POLICY IF EXISTS "task_projects write" ON public.task_projects;
CREATE POLICY "task_projects write" ON public.task_projects FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_project_access(project_id))
  WITH CHECK (public.is_admin() OR public.has_project_access(project_id));

-- ---------- caixa de entrada ----------
-- Cada um só lê/marca/apaga a própria notificação. A criação continua aberta
-- porque atribuir uma tarefa a alguém precisa notificar essa pessoa, não quem
-- está atribuindo.

DROP POLICY IF EXISTS "notifications read" ON public.notifications;
CREATE POLICY "notifications read" ON public.notifications FOR SELECT TO authenticated USING (
  public.is_admin() OR member_id = public.current_member_id()
);

DROP POLICY IF EXISTS "notifications update" ON public.notifications;
CREATE POLICY "notifications update" ON public.notifications FOR UPDATE TO authenticated
  USING (public.is_admin() OR member_id = public.current_member_id())
  WITH CHECK (public.is_admin() OR member_id = public.current_member_id());

DROP POLICY IF EXISTS "notifications delete" ON public.notifications;
CREATE POLICY "notifications delete" ON public.notifications FOR DELETE TO authenticated USING (
  public.is_admin() OR member_id = public.current_member_id()
);
