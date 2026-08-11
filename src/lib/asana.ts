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

/**
 * Seção é um container leve para tarefas. Pertence a UM projeto OU a UM
 * departamento — não aos dois. O CHECK constraint no banco (sections_container_ck)
 * é o que garante que uma delas seja NULL; do lado do cliente é só um union.
 */
export type Section = {
  id: string;
  project_id: string | null;
  department_id: string | null;
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

export type TaskAttachment = {
  id: string;
  task_id: string;
  comment_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by_member: string | null;
  uploaded_by_user: string | null;
  created_at: string;
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

/**
 * Automação: uma regra "quando X, faz Y" pertencente a UM container
 * (projeto XOR departamento). O CHECK do banco (automations_container_ck)
 * garante o XOR; do lado do cliente é só um union nullable.
 */
export type Automation = {
  id: string;
  project_id: string | null;
  department_id: string | null;
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
  { id: "section", label: "Seção" },
  { id: "department", label: "Departamento" },
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

export const attachmentsQuery = queryOptions({
  queryKey: ["task_attachments"],
  queryFn: () => all<TaskAttachment>("task_attachments", "created_at"),
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

/**
 * Cria uma seção. Exige exatamente UM entre project_id e department_id — os
 * dois lados chamam esta função (ProjectViews e DepartmentViews), então a
 * assinatura aceita ambos e o CHECK do banco rejeita quem passar 0 ou 2.
 */
export const createSection = (payload: {
  project_id?: string | null;
  department_id?: string | null;
  name: string;
  position?: number;
  color?: string;
}) => run(table("sections").insert(payload as never));
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

export const updateComment = (id: string, body: string) =>
  run(table("task_comments").update({ body } as never).eq("id", id));

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

/**
 * Notifica a pessoa designada — chamado depois de QUALQUER caminho que muda
 * assignee_id (Lista, Card, menu de contexto, atribuição em lote, criação
 * já atribuída), não só o TaskPane. Sem isso, só quem recebia a tarefa pelo
 * painel de detalhe era avisado; atribuir pela grade ficava mudo.
 */
export const notifyAssignment = (
  task: { id: string; title: string; project_id: string | null; assignee_id?: string | null },
  nextAssigneeId: string | null,
  actorMemberId: string | null,
) => {
  if (!nextAssigneeId || nextAssigneeId === task.assignee_id || nextAssigneeId === actorMemberId) {
    return Promise.resolve();
  }
  return createNotifications([
    {
      member_id: nextAssigneeId,
      kind: "atribuicao",
      title: `Você foi designado para "${task.title}"`,
      task_id: task.id,
      project_id: task.project_id,
      actor_member_id: actorMemberId,
    },
  ]);
};

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

/**
 * Upsert (não update): tarefa que chegou ao projeto direto por project_id
 * (sem passar por createTaskLinked) pode nunca ter tido linha em
 * task_projects — um update simples nesse caso afeta zero linhas e a seção
 * some silenciosamente. Upsert garante que a posição sempre grava.
 */
export const setTaskProjectSection = (task_id: string, project_id: string, section_id: string | null) =>
  run(
    table("task_projects").upsert({ task_id, project_id, section_id } as never, {
      onConflict: "task_id,project_id",
    }),
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
  project_id?: string | null;
  department_id?: string | null;
  name: string;
  trigger_type: string;
  trigger_value?: string | null;
  action_type: string;
  action_value?: string | null;
}) => run(table("automations").insert(payload as never));

export const updateAutomation = (id: string, patch: Partial<Automation>) =>
  run(table("automations").update(patch as never).eq("id", id));

export const deleteAutomation = (id: string) => run(table("automations").delete().eq("id", id));

/* ---------------- anexos de tarefa ---------------- */

/** Bucket privado; ver migration 20260804140000_anexos_de_comentario.sql. */
const ATTACHMENT_BUCKET = "task-attachments";

/**
 * Sobe o arquivo no Storage e insere o registro em task_attachments.
 * Se o insert falhar, remove o objeto do Storage para não deixar arquivo órfão.
 * comment_id é opcional: anexos podem ficar avulsos na tarefa.
 */
export async function uploadTaskAttachment(input: {
  taskId: string;
  commentId?: string | null;
  file: File;
  memberId?: string | null;
  userId?: string | null;
}) {
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${input.taskId}/${crypto.randomUUID()}-${safeName}`;

  const uploadOptions: { contentType?: string; upsert: boolean } = { upsert: false };
  if (input.file.type) uploadOptions.contentType = input.file.type;
  const { error: uploadErr } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, input.file, uploadOptions);
  if (uploadErr) throw uploadErr;

  const { data, error: insertErr } = await supabase
    .from("task_attachments" as never)
    .insert({
      task_id: input.taskId,
      comment_id: input.commentId ?? null,
      storage_path: path,
      file_name: input.file.name,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      uploaded_by_member: input.memberId ?? null,
      uploaded_by_user: input.userId ?? null,
    } as never)
    .select("id")
    .single();

  if (insertErr) {
    // rollback do arquivo — sem isso ficaria lixo no bucket.
    try {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
    } catch {
      /* ignora, o erro original é o que importa */
    }
    throw insertErr;
  }
  return (data as { id: string }).id;
}

/** Cria uma URL temporária para baixar/visualizar (5 min). */
export async function getAttachmentUrl(storagePath: string) {
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(storagePath, 60 * 5);
  if (error) throw error;
  return data.signedUrl;
}

/** Apaga do banco e do Storage (nessa ordem: se o banco recusar, arquivo fica). */
export async function deleteTaskAttachment(attachment: Pick<TaskAttachment, "id" | "storage_path">) {
  const { error } = await supabase.from("task_attachments" as never).delete().eq("id", attachment.id);
  if (error) throw error;
  try {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.storage_path]);
  } catch {
    /* arquivo pode já ter sido removido por outro caminho, tudo bem */
  }
}

/* ---------------- imagem colada na descrição ---------------- */

/**
 * Bucket público (ver migration 20260810130000_imagens_de_descricao.sql) —
 * URL direta e estável, ao contrário do bucket de anexos (signed URL de só
 * 5 min, que não serve pra imagem embutida no meio do texto).
 */
const DESCRIPTION_IMAGE_BUCKET = "task-description-images";

/** Sobe a imagem colada em <taskId>/<uuid>-<arquivo> e devolve a URL pública, pra inserir direto no <img src>. */
export async function uploadDescriptionImage(taskId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "imagem.png";
  const path = `${taskId}/${crypto.randomUUID()}-${safeName}`;
  const uploadOptions: { contentType?: string; upsert: boolean } = { upsert: false };
  if (file.type) uploadOptions.contentType = file.type;
  const { error } = await supabase.storage.from(DESCRIPTION_IMAGE_BUCKET).upload(path, file, uploadOptions);
  if (error) throw error;
  return supabase.storage.from(DESCRIPTION_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ---------------- perfil e foto ---------------- */

/** Bucket público (ver migration 20260808120000_perfil_e_foto.sql) — URL direta, sem signed URL. */
const AVATAR_BUCKET = "avatar-photos";

/** Sobe a foto em <memberId>/<uuid>-<arquivo> e devolve a URL pública. */
export async function uploadAvatarPhoto(memberId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${memberId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Só toca nome/função/contato/foto da PRÓPRIA linha (RPC restrita a essas
 * colunas — ver migration). Não passa por is_admin(): qualquer pessoa edita
 * o próprio perfil.
 */
export async function updateMyProfile(input: {
  name: string;
  job_title: string;
  phone: string;
  avatar_url: string | null;
}) {
  const { error } = await supabase.rpc("update_my_profile" as never, {
    p_name: input.name,
    p_job_title: input.job_title,
    p_phone: input.phone,
    p_avatar_url: input.avatar_url,
  } as never);
  if (error) throw error;
}
