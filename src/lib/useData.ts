import { useQuery } from "@tanstack/react-query";
import {
  clientsQuery,
  departmentsQuery,
  membersQuery,
  projectsQuery,
  statusEventsQuery,
  tasksQuery,
} from "./data";

export function useWorkspaceData() {
  const members = useQuery(membersQuery);
  const departments = useQuery(departmentsQuery);
  const clients = useQuery(clientsQuery);
  const projects = useQuery(projectsQuery);
  const tasks = useQuery(tasksQuery);
  const events = useQuery(statusEventsQuery);

  return {
    members: members.data ?? [],
    departments: departments.data ?? [],
    clients: clients.data ?? [],
    projects: projects.data ?? [],
    tasks: tasks.data ?? [],
    events: events.data ?? [],
    isLoading:
      members.isLoading ||
      departments.isLoading ||
      clients.isLoading ||
      projects.isLoading ||
      tasks.isLoading ||
      events.isLoading,
  };
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
