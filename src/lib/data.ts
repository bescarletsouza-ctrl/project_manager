import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Client, Department, Member, Project, StatusEvent, Task } from "./domain";

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

export async function createMember(payload: Record<string, unknown>) {
  const { error } = await supabase.from("members" as never).insert(payload as never);
  if (error) throw error;
}
export async function updateMember(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("members" as never).update(patch as never).eq("id", id);
  if (error) throw error;
}
export async function deleteMember(id: string) {
  const { error } = await supabase.from("members" as never).delete().eq("id", id);
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
