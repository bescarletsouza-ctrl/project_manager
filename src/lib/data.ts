import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Client, Department, Member, MemberDepartment, Project, StatusEvent, Tag, Task } from "./domain";

async function all<T>(table: string, order?: string): Promise<T[]> {
  let q = supabase.from(table as never).select("*");
  if (order) q = q.order(order, { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

export const membersQuery = queryOptions({
  queryKey: ["members"],
  queryFn: () => all<Member>("members"),
});

export const departmentsQuery = queryOptions({
  queryKey: ["departments"],
  queryFn: () => all<Department>("departments"),
});

export const clientsQuery = queryOptions({
  queryKey: ["clients"],
  queryFn: () => all<Client>("clients"),
});

export const tagsQuery = queryOptions({
  queryKey: ["tags"],
  queryFn: () => all<Tag>("tags"),
});

export const memberDepartmentsQuery = queryOptions({
  queryKey: ["member_departments"],
  queryFn: () => all<MemberDepartment>("member_departments"),
});

export const projectsQuery = queryOptions({
  queryKey: ["projects"],
  queryFn: () => all<Project>("projects", "created_at"),
});

export const tasksQuery = queryOptions({
  queryKey: ["tasks"],
  queryFn: () => all<Task>("tasks", "created_at"),
});

export const statusEventsQuery = queryOptions({
  queryKey: ["status_events"],
  queryFn: () => all<StatusEvent>("task_status_history", "entered_at"),
});

export type ProjectStatus = {
  id: string;
  project_id: string;
  name: string;
  color: string;
  position: number;
};

export const projectStatusesQuery = queryOptions({
  queryKey: ["project_statuses"],
  queryFn: () => all<ProjectStatus>("project_statuses"),
});

export async function updateTask(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("tasks" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function createTask(payload: Record<string, unknown>) {
  const { error } = await supabase.from("tasks" as never).insert(payload as never);
  if (error) throw error;
}

export async function deleteTask(id: string) {
  const { error } = await supabase.from("tasks" as never).delete().eq("id", id);
  if (error) throw error;
}

/**
 * Duplica uma tarefa (raiz), suas subtarefas e os valores de campos
 * personalizados. Não copia comentários, anexos, histórico nem dependências.
 * Nome da cópia: "Cópia de <titulo>". Rollback em caso de falha.
 */
export async function duplicateTask(sourceId: string) {
  const { data: sourceRaw, error: readErr } = await supabase
    .from("tasks" as never)
    .select("*")
    .eq("id", sourceId)
    .single();
  if (readErr) throw readErr;
  const source = sourceRaw as Task;

  const clone = (t: Task, parentIdNew: string | null, titlePrefix = "") => ({
    title: titlePrefix ? `${titlePrefix}${t.title}` : t.title,
    description: t.description,
    project_id: t.project_id,
    section_id: t.section_id,
    department_id: t.department_id,
    client_id: t.client_id,
    assignee_id: t.assignee_id,
    status: t.status,
    priority: t.priority,
    complexity: t.complexity,
    task_type: t.task_type,
    due_date: t.due_date,
    start_date: t.start_date,
    is_milestone: t.is_milestone,
    tags: t.tags,
    sprint: t.sprint,
    position: t.position,
    parent_task_id: parentIdNew,
    completed: false,
    reopen_count: 0,
    review_count: 0,
    block_reason: null,
  });

  const { data: created, error: createErr } = await supabase
    .from("tasks" as never)
    .insert(clone(source, source.parent_task_id, "Cópia de ") as never)
    .select("id")
    .single();
  if (createErr) throw createErr;
  const newRootId = (created as { id: string }).id;

  try {
    // Subtarefas — mesmo processo, refazendo o vínculo com o novo pai.
    const { data: subsRaw, error: subsErr } = await supabase
      .from("tasks" as never)
      .select("*")
      .eq("parent_task_id", sourceId)
      .order("position", { ascending: true });
    if (subsErr) throw subsErr;

    const subs = (subsRaw ?? []) as Task[];
    const subIdMap = new Map<string, string>([[sourceId, newRootId]]);
    for (const s of subs) {
      const { data: subCreated, error } = await supabase
        .from("tasks" as never)
        .insert(clone(s, newRootId) as never)
        .select("id")
        .single();
      if (error) throw error;
      subIdMap.set(s.id, (subCreated as { id: string }).id);
    }

    // Valores dos campos personalizados (da tarefa raiz e das subtarefas).
    const allSourceIds = [sourceId, ...subs.map((s) => s.id)];
    const { data: valuesData, error: valuesErr } = await supabase
      .from("task_field_values" as never)
      .select("task_id, field_id, value")
      .in("task_id", allSourceIds);
    if (valuesErr) throw valuesErr;

    const rows = ((valuesData ?? []) as { task_id: string; field_id: string; value: string | null }[])
      .map((v) => ({ task_id: subIdMap.get(v.task_id), field_id: v.field_id, value: v.value }))
      .filter((r): r is { task_id: string; field_id: string; value: string | null } => Boolean(r.task_id));

    if (rows.length > 0) {
      const { error } = await supabase.from("task_field_values" as never).insert(rows as never);
      if (error) throw error;
    }

    return newRootId;
  } catch (err) {
    // ON DELETE CASCADE nas subtarefas e nos valores derruba o resto.
    try {
      await supabase.from("tasks" as never).delete().eq("id", newRootId);
    } catch {
      /* engolimos o rollback para não mascarar o erro original */
    }
    throw err;
  }
}

/**
 * Duplica uma seção dentro do mesmo projeto: cria "Cópia de <nome>" e clona
 * todas as tarefas raiz da seção (com subtarefas e valores de campos
 * personalizados). Não copia comentários/anexos/histórico. Rollback total ao
 * falhar — se a inserção de qualquer tarefa quebrar, a seção nova é apagada
 * (ON DELETE CASCADE derruba o que já foi copiado).
 */
export async function duplicateSection(sourceId: string) {
  const { data: sourceRaw, error: readErr } = await supabase
    .from("sections" as never)
    .select("id, project_id, name, color, position")
    .eq("id", sourceId)
    .single();
  if (readErr) throw readErr;
  const source = sourceRaw as { id: string; project_id: string; name: string; color: string; position: number };

  const { data: created, error: createErr } = await supabase
    .from("sections" as never)
    .insert({
      project_id: source.project_id,
      name: `Cópia de ${source.name}`,
      color: source.color,
      position: source.position + 1,
    } as never)
    .select("id")
    .single();
  if (createErr) throw createErr;
  const newSectionId = (created as { id: string }).id;

  try {
    const { data: rootsRaw, error: rootsErr } = await supabase
      .from("tasks" as never)
      .select("*")
      .eq("section_id", sourceId)
      .is("parent_task_id", null)
      .order("position", { ascending: true });
    if (rootsErr) throw rootsErr;

    const roots = (rootsRaw ?? []) as Task[];
    const rootIdMap = new Map<string, string>();

    for (const t of roots) {
      const clone = {
        title: t.title,
        description: t.description,
        project_id: t.project_id,
        section_id: newSectionId,
        department_id: t.department_id,
        client_id: t.client_id,
        assignee_id: t.assignee_id,
        status: t.status,
        priority: t.priority,
        complexity: t.complexity,
        task_type: t.task_type,
        due_date: t.due_date,
        start_date: t.start_date,
        is_milestone: t.is_milestone,
        tags: t.tags,
        sprint: t.sprint,
        position: t.position,
        parent_task_id: null,
        completed: false,
        reopen_count: 0,
        review_count: 0,
        block_reason: null,
      };
      const { data: createdRoot, error } = await supabase
        .from("tasks" as never)
        .insert(clone as never)
        .select("id")
        .single();
      if (error) throw error;
      rootIdMap.set(t.id, (createdRoot as { id: string }).id);
    }

    if (rootIdMap.size > 0) {
      // Subtarefas dessas raízes — puxa todas de uma vez, depois insere com
      // parent_task_id remapeado.
      const { data: subsRaw, error: subsErr } = await supabase
        .from("tasks" as never)
        .select("*")
        .in("parent_task_id", [...rootIdMap.keys()])
        .order("position", { ascending: true });
      if (subsErr) throw subsErr;

      const subIdMap = new Map<string, string>();
      for (const s of (subsRaw ?? []) as Task[]) {
        const parentNew = s.parent_task_id ? rootIdMap.get(s.parent_task_id) : null;
        if (!parentNew) continue;
        const clone = {
          title: s.title,
          description: s.description,
          project_id: s.project_id,
          section_id: newSectionId,
          department_id: s.department_id,
          client_id: s.client_id,
          assignee_id: s.assignee_id,
          status: s.status,
          priority: s.priority,
          complexity: s.complexity,
          task_type: s.task_type,
          due_date: s.due_date,
          start_date: s.start_date,
          is_milestone: s.is_milestone,
          tags: s.tags,
          sprint: s.sprint,
          position: s.position,
          parent_task_id: parentNew,
          completed: false,
          reopen_count: 0,
          review_count: 0,
          block_reason: null,
        };
        const { data: createdSub, error } = await supabase
          .from("tasks" as never)
          .insert(clone as never)
          .select("id")
          .single();
        if (error) throw error;
        subIdMap.set(s.id, (createdSub as { id: string }).id);
      }

      // Valores de campos personalizados (raízes + subtarefas copiadas).
      const originalIds = [...rootIdMap.keys(), ...subIdMap.keys()];
      const { data: valuesData, error: valuesErr } = await supabase
        .from("task_field_values" as never)
        .select("task_id, field_id, value")
        .in("task_id", originalIds);
      if (valuesErr) throw valuesErr;

      const rows = ((valuesData ?? []) as { task_id: string; field_id: string; value: string | null }[])
        .map((v) => {
          const newId = rootIdMap.get(v.task_id) ?? subIdMap.get(v.task_id);
          return newId ? { task_id: newId, field_id: v.field_id, value: v.value } : null;
        })
        .filter((r): r is { task_id: string; field_id: string; value: string | null } => Boolean(r));

      if (rows.length > 0) {
        const { error } = await supabase.from("task_field_values" as never).insert(rows as never);
        if (error) throw error;
      }
    }

    return newSectionId;
  } catch (err) {
    try {
      await supabase.from("sections" as never).delete().eq("id", newSectionId);
    } catch {
      /* rollback silencioso, o erro original é o que importa */
    }
    throw err;
  }
}

/** Cria o projeto e devolve o id, para redirecionar ou criar seções padrão. */
export async function createProject(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("projects" as never)
    .insert(payload as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateProject(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("projects" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id: string) {
  const { error } = await supabase.from("projects" as never).delete().eq("id", id);
  if (error) throw error;
}

/**
 * Duplica um projeto: copia estrutura (seções, campos personalizados,
 * colunas visíveis, padrões), tarefas raiz + subtarefas com todos os
 * atributos, e valores de campos personalizados.
 *
 * NÃO copia (por decisão do produto):
 * - comentários e menções
 * - histórico de atividades (task_status_history)
 * - notificações
 * - automações (dependem de contexto e podem disparar efeitos indesejados)
 * - dependências entre tarefas (podem cruzar projetos)
 *
 * Se qualquer passo falhar depois da criação do projeto novo, o projeto é
 * apagado (o ON DELETE CASCADE derruba seções/tarefas em cadeia) para não
 * deixar cópia parcial no banco.
 */
export async function duplicateProject(sourceId: string) {
  const { data: sourceRaw, error: readErr } = await supabase
    .from("projects" as never)
    .select("*")
    .eq("id", sourceId)
    .single();
  if (readErr) throw readErr;
  const source = sourceRaw as Project;

  const {
    id: _id,
    name,
    position: _position,
    ...rest
  } = source;

  const newProjectId = await createProject({ ...rest, name: `Cópia de ${name}` });

  try {
    // Seções — id novo, precisamos do mapa antigo→novo para religar tarefas.
    const { data: sectionsData, error: sectionsErr } = await supabase
      .from("sections" as never)
      .select("id, name, color, position")
      .eq("project_id", sourceId)
      .order("position", { ascending: true });
    if (sectionsErr) throw sectionsErr;

    const sectionIdMap = new Map<string, string>();
    for (const s of (sectionsData ?? []) as { id: string; name: string; color: string; position: number }[]) {
      const { data: created, error } = await supabase
        .from("sections" as never)
        .insert({ project_id: newProjectId, name: s.name, color: s.color, position: s.position } as never)
        .select("id")
        .single();
      if (error) throw error;
      sectionIdMap.set(s.id, (created as { id: string }).id);
    }

    // Campos personalizados — mesmo mapa, para copiar os valores depois.
    const { data: fieldsData, error: fieldsErr } = await supabase
      .from("custom_fields" as never)
      .select("id, name, field_type, options, position")
      .eq("project_id", sourceId)
      .order("position", { ascending: true });
    if (fieldsErr) throw fieldsErr;

    const fieldIdMap = new Map<string, string>();
    for (const f of (fieldsData ?? []) as {
      id: string;
      name: string;
      field_type: string;
      options: unknown;
      position: number;
    }[]) {
      const { data: created, error } = await supabase
        .from("custom_fields" as never)
        .insert({
          project_id: newProjectId,
          name: f.name,
          field_type: f.field_type,
          options: f.options,
          position: f.position,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      fieldIdMap.set(f.id, (created as { id: string }).id);
    }

    // Tarefas — insere primeiro as raízes, depois as subtarefas com o novo
    // parent_task_id. Copia responsáveis, prioridades, datas, status,
    // etiquetas, sprint, marco etc.; zera contadores/histórico e a data de
    // conclusão, para a cópia começar "fresca" mesmo em tarefas concluídas.
    const { data: tasksData, error: tasksErr } = await supabase
      .from("tasks" as never)
      .select("*")
      .eq("project_id", sourceId)
      .order("position", { ascending: true });
    if (tasksErr) throw tasksErr;

    const tasks = (tasksData ?? []) as Task[];
    const taskIdMap = new Map<string, string>();

    const cloneTask = (t: Task, parentIdNew: string | null) => ({
      title: t.title,
      description: t.description,
      project_id: newProjectId,
      section_id: t.section_id ? (sectionIdMap.get(t.section_id) ?? null) : null,
      department_id: t.department_id,
      client_id: t.client_id,
      assignee_id: t.assignee_id,
      status: t.status,
      priority: t.priority,
      complexity: t.complexity,
      task_type: t.task_type,
      due_date: t.due_date,
      start_date: t.start_date,
      is_milestone: t.is_milestone,
      tags: t.tags,
      sprint: t.sprint,
      position: t.position,
      parent_task_id: parentIdNew,
      // reinicia o ciclo: não copia started_at/completed_at nem contadores.
      completed: false,
      reopen_count: 0,
      review_count: 0,
      block_reason: null,
    });

    const roots = tasks.filter((t) => !t.parent_task_id);
    for (const t of roots) {
      const { data: created, error } = await supabase
        .from("tasks" as never)
        .insert(cloneTask(t, null) as never)
        .select("id")
        .single();
      if (error) throw error;
      taskIdMap.set(t.id, (created as { id: string }).id);
    }

    const subs = tasks.filter((t) => t.parent_task_id);
    for (const t of subs) {
      const parentNew = t.parent_task_id ? taskIdMap.get(t.parent_task_id) : null;
      if (!parentNew) continue; // pai fora do projeto, ignora
      const { data: created, error } = await supabase
        .from("tasks" as never)
        .insert(cloneTask(t, parentNew) as never)
        .select("id")
        .single();
      if (error) throw error;
      taskIdMap.set(t.id, (created as { id: string }).id);
    }

    // Valores dos campos personalizados das tarefas copiadas.
    if (fieldIdMap.size > 0 && taskIdMap.size > 0) {
      const { data: valuesData, error: valuesErr } = await supabase
        .from("task_field_values" as never)
        .select("task_id, field_id, value")
        .in("task_id", tasks.map((t) => t.id));
      if (valuesErr) throw valuesErr;

      const rowsToInsert: { task_id: string; field_id: string; value: string | null }[] = [];
      for (const v of (valuesData ?? []) as { task_id: string; field_id: string; value: string | null }[]) {
        const newTaskId = taskIdMap.get(v.task_id);
        const newFieldId = fieldIdMap.get(v.field_id);
        if (newTaskId && newFieldId) rowsToInsert.push({ task_id: newTaskId, field_id: newFieldId, value: v.value });
      }

      if (rowsToInsert.length > 0) {
        const { error } = await supabase.from("task_field_values" as never).insert(rowsToInsert as never);
        if (error) throw error;
      }
    }

    return newProjectId;
  } catch (err) {
    // Desfaz a cópia parcial. ON DELETE CASCADE em sections/custom_fields/
    // tasks/task_field_values remove todo o resto derivado.
    try {
      await supabase.from("projects" as never).delete().eq("id", newProjectId);
    } catch {
      /* engolimos o erro do rollback para não mascarar o original */
    }
    throw err;
  }
}

export async function createProjectStatus(payload: {
  project_id: string;
  name: string;
  color?: string;
  position?: number;
}) {
  const { error } = await supabase.from("project_statuses" as never).insert(payload as never);
  if (error) throw error;
}

export async function deleteProjectStatus(id: string) {
  const { error } = await supabase.from("project_statuses" as never).delete().eq("id", id);
  if (error) throw error;
}

/* ---------- CRUD de configurações (equipe, departamentos, clientes) ---------- */

export const ACCESS_ROLES = ["admin", "colaborador", "visualizador"] as const;
export const ACCESS_ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  colaborador: "Colaborador",
  visualizador: "Visualizador",
};
export const ACCESS_ROLE_DESCRIPTION: Record<string, string> = {
  admin: "Cria e exclui projetos, gerencia a equipe e vê relatórios.",
  colaborador: "Edita os projetos em que é gestor ou tem tarefa atribuída.",
  visualizador: "Só visualiza — inclusive os relatórios.",
};

export async function createMember(payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.from("members" as never).insert(payload as never).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}
export async function updateMember(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("members" as never).update(patch as never).eq("id", id);
  if (error) throw error;
}
export async function deleteMember(id: string) {
  const { error } = await supabase.from("members" as never).delete().eq("id", id);
  if (error) throw error;
}

/** Substitui os departamentos extras da pessoa (fora o principal, em members.department_id). */
export async function setMemberDepartments(memberId: string, departmentIds: string[]) {
  const { error: delError } = await supabase
    .from("member_departments" as never)
    .delete()
    .eq("member_id", memberId);
  if (delError) throw delError;
  if (departmentIds.length === 0) return;
  const { error } = await supabase
    .from("member_departments" as never)
    .insert(departmentIds.map((department_id) => ({ member_id: memberId, department_id })) as never);
  if (error) throw error;
}

export async function createDepartment(payload: Record<string, unknown>) {
  const { error } = await supabase.from("departments" as never).insert(payload as never);
  if (error) throw error;
}
export async function updateDepartment(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("departments" as never).update(patch as never).eq("id", id);
  if (error) throw error;
}
export async function deleteDepartment(id: string) {
  const { error } = await supabase.from("departments" as never).delete().eq("id", id);
  if (error) throw error;
}

export async function createTag(payload: Record<string, unknown>) {
  const { error } = await supabase.from("tags" as never).insert(payload as never);
  if (error) throw error;
}
export async function updateTag(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("tags" as never).update(patch as never).eq("id", id);
  if (error) throw error;
}
export async function deleteTag(id: string) {
  const { error } = await supabase.from("tags" as never).delete().eq("id", id);
  if (error) throw error;
}

export async function createClient(payload: Record<string, unknown>) {
  const { error } = await supabase.from("clients" as never).insert(payload as never);
  if (error) throw error;
}
export async function updateClient(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("clients" as never).update(patch as never).eq("id", id);
  if (error) throw error;
}
export async function deleteClient(id: string) {
  const { error } = await supabase.from("clients" as never).delete().eq("id", id);
  if (error) throw error;
}
