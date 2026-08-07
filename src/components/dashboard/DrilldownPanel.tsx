import { Link } from "@tanstack/react-router";
import { SectionTitle, StatusBadge, Pill } from "@/components/ui-bits";
import { nameById } from "@/lib/useData";
import type { Member, Project, Task, TaskStatus } from "@/lib/domain";

export type Selection = { title: string; tasks: Task[] } | null;

/** Lista de tarefas filtradas por um clique em gráfico (status, departamento, projeto, seção, pessoa...). */
export function DrilldownPanel({
  selection,
  onClose,
  members,
  projects,
}: {
  selection: Selection;
  onClose: () => void;
  members: Member[];
  projects: Project[];
}) {
  if (!selection) return null;

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-4">
        <SectionTitle title={selection.title} description={`${selection.tasks.length} tarefa(s)`} />
        <button
          onClick={onClose}
          className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-secondary"
        >
          Fechar
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Tarefa</th>
              <th className="px-4 py-2 font-medium">Responsável</th>
              <th className="px-4 py-2 font-medium">Projeto</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Prazo</th>
            </tr>
          </thead>
          <tbody>
            {selection.tasks.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="max-w-[280px] truncate px-4 py-2">{t.title}</td>
                <td className="px-4 py-2">{nameById(members, t.assignee_id)}</td>
                <td className="px-4 py-2">
                  {t.project_id ? (
                    <Link to="/projetos/$projectId" params={{ projectId: t.project_id }} className="hover:underline">
                      {nameById(projects, t.project_id)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={t.status as TaskStatus} />
                </td>
                <td className="px-4 py-2">{t.due_date ?? <Pill>sem prazo</Pill>}</td>
              </tr>
            ))}
            {selection.tasks.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-muted-foreground">
                  Nenhuma tarefa.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
