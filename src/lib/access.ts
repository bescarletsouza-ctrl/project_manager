import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { membersQuery } from "./data";
import type { Member, Project, Task } from "./domain";
import type { TaskProject } from "./asana";

export type AccessRole = "admin" | "colaborador" | "visualizador";

/** Resolve a linha de members da pessoa autenticada, do mesmo jeito que useCurrentMember. */
export async function resolveCurrentMember(queryClient: QueryClient): Promise<Member | null> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return null;
  const list = await queryClient.ensureQueryData(membersQuery);
  return (
    list.find((m) => m.user_id && m.user_id === user.id) ??
    list.find((m) => user.email && m.email.trim().toLowerCase() === user.email.trim().toLowerCase()) ??
    null
  );
}

/**
 * Trava de rota (beforeLoad): redireciona quem não tem um dos papéis
 * permitidos. É só a camada de experiência — quem barra de verdade é a
 * política de RLS no banco (ver migration controle_de_acesso).
 */
export async function requireRole(queryClient: QueryClient, allowed: AccessRole[]) {
  const member = await resolveCurrentMember(queryClient);
  const role = (member?.access_role ?? "colaborador") as AccessRole;
  if (!allowed.includes(role)) {
    toast.error("Você não tem acesso a essa página.");
    throw redirect({ to: "/minhas-tarefas" });
  }
}

/** Papel + atalhos de permissão, para esconder ações na interface. */
export function useAccessRole() {
  const { data: member, isLoading } = useQuery({
    queryKey: ["current-member-access"],
    queryFn: async () => {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) return null;
      const { data, error } = await supabase.from("members" as never).select("*");
      if (error) throw error;
      const list = (data ?? []) as Member[];
      return (
        list.find((m) => m.user_id && m.user_id === user.id) ??
        list.find((m) => user.email && m.email.trim().toLowerCase() === user.email.trim().toLowerCase()) ??
        null
      );
    },
  });

  const role = (member?.access_role ?? "colaborador") as AccessRole;

  return {
    member: member ?? null,
    role,
    isLoading,
    isAdmin: role === "admin",
    isVisualizador: role === "visualizador",
    isColaborador: role === "colaborador",
    canManageTeam: role === "admin",
    canCreateProject: role === "admin",
    canViewReports: role === "admin" || role === "visualizador",
  };
}

/**
 * Espelha has_project_access(uuid) do banco, para decidir na hora o que
 * mostrar (a política de RLS é quem garante de verdade — isto é só a tela).
 */
export function hasProjectAccess(
  role: AccessRole,
  memberId: string | null,
  project: Pick<Project, "id" | "manager_id">,
  tasks: Task[],
  taskProjects: TaskProject[] = [],
): boolean {
  if (role === "admin") return true;
  if (!memberId) return false;
  if (project.manager_id === memberId) return true;
  if (tasks.some((t) => t.project_id === project.id && t.assignee_id === memberId)) return true;
  const linkedTaskIds = new Set(
    taskProjects.filter((tp) => tp.project_id === project.id).map((tp) => tp.task_id),
  );
  return tasks.some((t) => linkedTaskIds.has(t.id) && t.assignee_id === memberId);
}
