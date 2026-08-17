import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clientsQuery,
  departmentsQuery,
  memberDepartmentsQuery,
  membersQuery,
  projectsQuery,
  statusEventsQuery,
  tasksQuery,
} from "./data";

/**
 * Invalida só as queries dadas, em vez do cache inteiro (qc.invalidateQueries()
 * sem argumento refaz as ~18 queries do app a cada mutação, mesmo quando só
 * "tasks" mudou). Mesmo padrão já usado em configuracoes.tsx, centralizado
 * aqui para reaproveitar em qualquer mutação do app.
 */
export function useInvalidate(keys: string[]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function useWorkspaceData() {
  const members = useQuery(membersQuery);
  const departments = useQuery(departmentsQuery);
  const memberDepartments = useQuery(memberDepartmentsQuery);
  const clients = useQuery(clientsQuery);
  const projects = useQuery(projectsQuery);
  const tasks = useQuery(tasksQuery);
  const events = useQuery(statusEventsQuery);

  return {
    members: members.data ?? [],
    departments: departments.data ?? [],
    memberDepartments: memberDepartments.data ?? [],
    clients: clients.data ?? [],
    projects: projects.data ?? [],
    tasks: tasks.data ?? [],
    events: events.data ?? [],
    isLoading:
      members.isLoading ||
      departments.isLoading ||
      memberDepartments.isLoading ||
      clients.isLoading ||
      projects.isLoading ||
      tasks.isLoading ||
      events.isLoading,
  };
}

/** IDs de departamento da pessoa: o principal (department_id) + os extras (member_departments). */
export function departmentIdsOf(
  member: { id: string; department_id: string | null },
  memberDepartments: { member_id: string; department_id: string }[],
): string[] {
  const extras = memberDepartments.filter((md) => md.member_id === member.id).map((md) => md.department_id);
  return member.department_id ? [member.department_id, ...extras] : extras;
}

/** IDs de departamento da tarefa: o principal (department_id) + os extras (task_departments). Mesmo padrão de departmentIdsOf. */
export function taskDepartmentIdsOf(
  task: { id: string; department_id: string | null },
  taskDepartments: { task_id: string; department_id: string }[],
): string[] {
  const extras = taskDepartments.filter((td) => td.task_id === task.id).map((td) => td.department_id);
  return task.department_id ? [task.department_id, ...extras] : extras;
}

export function nameById<T extends { id: string; name: string }>(list: T[], id?: string | null) {
  if (!id) return "—";
  return list.find((x) => x.id === id)?.name ?? "—";
}

export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
