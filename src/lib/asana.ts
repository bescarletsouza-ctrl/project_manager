import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ---------------- tipos ---------------- */

export type Portfolio = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  owner_id: string | null;
  position: number;
  created_at: string;
};

export type Section = {
  id: string;
  project_id: string;
  name: string;
  color: string;
  position: number;
};

export type TaskDependency = {
  id: string;
  task_id: string;
  blocked_by_task_id: string;
};

export type CustomFieldType = "text" | "number" | "date" | "select";

export type CustomField = {
  id: string;
  project_id: string;
  name: string;
  field_type: CustomFieldType;
  options: string[];
  position: number;
};

export type TaskFieldValue = {
  id: string;
  task_id: string;
  field_id: string;
  value: string | null;
};

export type TaskComment = {
  id: string;
  task_id: string;
  author_member_id: string | null;
  author_user_id: string | null;
  body: string;
  created_at: string;
};

export type CommentMention = {
  id: string;
  comment_id: string;
  member_id: string;
};

export type Notification = {
  id: string;
  member_id: string | null;
  recipient_user_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  task_id: string | null;
  project_id: string | null;
  actor_member_id: string | null;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
};


export type TaskProject = {
  id: string;
  task_id: string;
  project_id: string;
  section_id: string | null;
  position: number;
};

export type Automation = {
  id: string;
  project_id: string;
  name: string;
  trigger_type: string;
  trigger_value: string | null;
  action_type: string;
  action_value: string | null;
  active: boolean;
  created_at: string;
};

export const TASK_COLUMNS = [
  { id: "assignee", label: "Responsável" },
  { id: "due_date", label: "Data de fim" },
  { id: "start_date", label: "Data de início" },
  { id: "status", label: "Status" },
  { id: "priority", label: "Prioridade" },
  { id: "tags", label: "Etiquetas" },
  { id: "sprint", label: "Sprint" },
  { id: "task_type", label: "Tipo de tarefa" },
] as const;

export type TaskColumn = (typeof TASK_COLUMNS)[number]["id"];

export const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  select: "Seleção",
};

export const NOTIFICATION_LABEL: Record<string, string> = {
  atribuicao: "Atribuição",
  mencao: "Menção",
  comentario: "Comentário",
  status: "Status",
  prazo: "Prazo",
  dependencia: "Dependência",
  atividade: "Atividade",
};

/* ---------------- leitura ---------------- */

async function all<T>(table: string, order?: string, ascending = true): Promise<T[]> {
  let q = supabase.from(table as never).select("*");
  if (order) q = q.order(order, { ascending });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

export const portfoliosQuery = queryOptions({
  queryKey: ["portfolios"],
  queryFn: () => all<Portfolio>("portfolios", "position"),
});

export const sectionsQuery = queryOptions({
  queryKey: ["sections"],
  queryFn: () => all<Section>("sections", "position"),
});

export const dependenciesQuery = queryOptions({
  queryKey: ["task_dependencies"],
  queryFn: () => all<TaskDependency>("task_dependencies"),
});

export const customFieldsQuery = queryOptions({
  queryKey: ["custom_fields"],
  queryFn: () => all<CustomField>("custom_fields", "position"),
});

export const fieldValuesQuery = queryOptions({
  queryKey: ["task_field_values"],
  queryFn: () => all<TaskFieldValue>("task_field_values"),
});

export const commentsQuery = queryOptions({
  queryKey: ["task_comments"],
  queryFn: () => all<TaskComment>("task_comments", "created_at"),
});

export const mentionsQuery = queryOptions({
  queryKey: ["comment_mentions"],
  queryFn: () => all<CommentMention>("comment_mentions"),
});

export const notificationsQuery = queryOptions({
  queryKey: ["notifications"],
  queryFn: () => all<Notification>("notifications", "created_at", false),
});

export const taskProjectsQuery = queryOptions({
  queryKey: ["task_projects"],
  queryFn: () => all<TaskProject>("task_projects", "position"),
});

export const automationsQuery = queryOptions({
  queryKey: ["automations"],
  queryFn: () => all<Automation>("automations", "created_at"),
});


/* ---------------- escrita ---------------- */

function table(name: string) {
  return supabase.from(name as never);
}

async function run(promise: PromiseLike<{ error: unknown }>) {
  const { error } = await promise;
  if (error) throw error;
}

/* portfólios */
export const createPortfolio = (payload: Partial<Portfolio>) =>
  run(table("portfolios").insert(payload as never));
export const updatePortfolio = (id: string, patch: Partial<Portfolio>) =>
  run(table("portfolios").update(patch as never).eq("id", id));
export const deletePortfolio = (id: string) => run(table("portfolios").delete().eq("id", id));

/* seções */
export const createSection = (payload: { project_id: string; name: string; position?: number; color?: string }) =>
  run(table("sections").insert(payload as never));
export const updateSection = (id: string, patch: Partial<Section>) =>
  run(table("sections").update(patch as never).eq("id", id));
export const deleteSection = (id: string) => run(table("sections").delete().eq("id", id));

/* dependências */
export const addDependency = (task_id: string, blocked_by_task_id: string) =>
  run(table("task_dependencies").insert({ task_id, blocked_by_task_id } as never));
export const removeDependency = (id: string) => run(table("task_dependencies").delete().eq("id", id));

/* campos personalizados */
export const createCustomField = (payload: {
  project_id: string;
  name: string;
  field_type: CustomFieldType;
  options?: string[];
  position?: number;
}) => run(table("custom_fields").insert(payload as never));
export const deleteCustomField = (id: string) => run(table("custom_fields").delete().eq("id", id));

export async function setFieldValue(task_id: string, field_id: string, value: string | null) {
  const { error } = await supabase
    .from("task_field_values" as never)
    .upsert({ task_id, field_id, value } as never, { onConflict: "task_id,field_id" });
  if (error) throw error;
}

/* comentários */
export async function createComment(payload: {
  task_id: string;
  body: string;
  author_member_id: string | null;
  author_user_id: string | null;
  mentions?: string[];
}) {
  const { data, error } = await supabase
    .from("task_comments" as never)
    .insert({
      task_id: payload.task_id,
      body: payload.body,
      author_member_id: payload.author_member_id,
      author_user_id: payload.author_user_id,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const commentId = (data as { id: string }).id;

  if (payload.mentions?.length) {
    await run(
      table("comment_mentions").insert(
        payload.mentions.map((member_id) => ({ comment_id: commentId, member_id })) as never,
      ),
    );
  }
  return commentId;
}

export const deleteComment = (id: string) => run(table("task_comments").delete().eq("id", id));

/* notificações */
export const createNotifications = (
  rows: Array<{
    member_id: string | null;
    kind: string;
    title: string;
    body?: string | null;
    task_id?: string | null;
    project_id?: string | null;
    actor_member_id?: string | null;
  }>,
) => (rows.length ? run(table("notifications").insert(rows as never)) : Promise.resolve());

export const markNotificationRead = (id: string) =>
  run(table("notifications").update({ read_at: new Date().toISOString() } as never).eq("id", id));

export const markAllRead = (memberId: string) =>
  run(
    table("notifications")
      .update({ read_at: new Date().toISOString() } as never)
      .eq("member_id", memberId)
      .is("read_at", null),
  );

export const setNotificationRead = (id: string, read: boolean) =>
  run(
    table("notifications")
      .update({ read_at: read ? new Date().toISOString() : null } as never)
      .eq("id", id),
  );

export const setNotificationArchived = (id: string, archived: boolean) =>
  run(
    table("notifications")
      .update({
        archived_at: archived ? new Date().toISOString() : null,
        ...(archived ? { read_at: new Date().toISOString() } : {}),
      } as never)
      .eq("id", id),
  );

export const deleteNotification = (id: string) => run(table("notifications").delete().eq("id", id));

/* ---------------- helpers de menção ---------------- */

/** Extrai @nomes do texto e resolve para ids de membros. */
export function resolveMentions(body: string, members: { id: string; name: string }[]) {
  const found = new Set<string>();
  for (const m of members) {
    const first = m.name.split(" ")[0]?.toLowerCase();
    const full = m.name.toLowerCase();
    const text = body.toLowerCase();
    if (!first) continue;
    if (text.includes(`@${full}`) || text.includes(`@${first}`)) found.add(m.id);
  }
  return [...found];
}

/* ---------------- tarefas em vários projetos ---------------- */

export const linkTaskToProject = (task_id: string, project_id: string, section_id: string | null = null) =>
  run(table("task_projects").insert({ task_id, project_id, section_id } as never));

export const unlinkTaskFromProject = (id: string) => run(table("task_projects").delete().eq("id", id));

export const setTaskProjectSection = (task_id: string, project_id: string, section_id: string | null) =>
  run(
    table("task_projects")
      .update({ section_id } as never)
      .eq("task_id", task_id)
      .eq("project_id", project_id),
  );

/** Cria a tarefa e a vincula a um ou mais projetos (sem duplicar). */
export async function createTaskLinked(
  payload: Record<string, unknown>,
  projectIds: string[],
) {
  const { data, error } = await supabase
    .from("tasks" as never)
    .insert(payload as never)
    .select("id")
    .single();
  if (error) throw error;
  const taskId = (data as { id: string }).id;
  const sectionId = (payload["section_id"] as string | null) ?? null;
  const primary = payload["project_id"] as string | null;
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length) {
    await run(
      table("task_projects").insert(
        ids.map((project_id) => ({
          task_id: taskId,
          project_id,
          section_id: project_id === primary ? sectionId : null,
        })) as never,
      ),
    );
  }
  return taskId;
}

/* ---------------- automações ---------------- */

export const createAutomation = (payload: {
  project_id: string;
  name: string;
  trigger_type: string;
  trigger_value?: string | null;
  action_type: string;
  action_value?: string | null;
}) => run(table("automations").insert(payload as never));

export const updateAutomation = (id: string, patch: Partial<Automation>) =>
  run(table("automations").update(patch as never).eq("id", id));

export const deleteAutomation = (id: string) => run(table("automations").delete().eq("id", id));
