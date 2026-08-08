import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { AvatarStack } from "@/components/Avatar";
import { Bar, EmptyState, Pill } from "@/components/ui-bits";
import { NewProjectDialog } from "@/components/dialogs";
import { useWorkspaceData, nameById } from "@/lib/useData";
import { useAccessRole } from "@/lib/access";
import { PROJECT_STATUS, PROJECT_STATUS_LABEL, projectHealth } from "@/lib/domain";
import { softClass } from "@/lib/colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/projetos/")({
  head: () => ({
    meta: [
      { title: "Projetos e saúde da operação — Alana" },
      {
        name: "description",
        content:
          "Acompanhe projetos por cliente, departamento e gestor, com progresso automático e indicador de saúde.",
      },
      { property: "og:title", content: "Projetos — Alana" },
      { property: "og:description", content: "Progresso automático, riscos e prazos de cada projeto." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { projects, tasks, members, isLoading } = useWorkspaceData();
  const { canCreateProject } = useAccessRole();
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const [term, setTerm] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const list = projects.filter(
    (p) =>
      (!status || p.status === status) && (!term.trim() || p.name.toLowerCase().includes(term.trim().toLowerCase())),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projetos</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} projeto(s) · clique para abrir a lista, o quadro ou a timeline.
          </p>
        </div>
        {canCreateProject && (
          <button onClick={() => setCreating(true)} className="btn btn-brand">
            <Plus className="size-4" /> Novo projeto
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar projeto"
            className="field h-8 w-52 pl-7"
          />
        </div>
        <select
          aria-label="Filtrar por status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="field h-8 w-auto"
        >
          <option value="">Todos os status</option>
          {PROJECT_STATUS.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-0.5 rounded-lg bg-secondary p-0.5">
          <button
            onClick={() => setLayout("grid")}
            aria-label="Ver em cartões"
            className={cn("rounded-md p-1.5", layout === "grid" ? "bg-background shadow-[var(--shadow-soft)]" : "text-muted-foreground")}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={() => setLayout("list")}
            aria-label="Ver em lista"
            className={cn("rounded-md p-1.5", layout === "list" ? "bg-background shadow-[var(--shadow-soft)]" : "text-muted-foreground")}
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="Nenhum projeto por aqui"
          description={
            canCreateProject
              ? "Crie o primeiro projeto — ele já nasce com seções prontas para receber tarefas."
              : "Ainda não há projetos visíveis para você."
          }
          action={
            canCreateProject ? (
              <button onClick={() => setCreating(true)} className="btn btn-primary">
                <Plus className="size-4" /> Novo projeto
              </button>
            ) : undefined
          }
        />
      ) : layout === "grid" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const h = projectHealth(p, tasks);
            const team = members.filter((m) => tasks.some((t) => t.project_id === p.id && t.assignee_id === m.id));
            return (
              <Link
                key={p.id}
                to="/projetos/$projectId"
                params={{ projectId: p.id }}
                className="card-surface block space-y-3 p-4 transition-shadow hover:shadow-[var(--shadow-raised)]"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold",
                      softClass(p.color),
                    )}
                  >
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{p.name}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {PROJECT_STATUS_LABEL[p.status] ?? p.status} · {nameById(members, p.manager_id)}
                    </p>
                  </div>
                  <Pill tone={h.score >= 75 ? "success" : h.score >= 50 ? "warning" : "danger"}>{h.health}</Pill>
                </div>

                {p.description && <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {h.done}/{h.total} tarefas
                    </span>
                    <span className="tabular-nums">{h.progress}%</span>
                  </div>
                  <Bar value={h.progress} tone={h.score >= 75 ? "success" : h.score >= 50 ? "warning" : "danger"} />
                </div>

                <div className="flex items-center gap-2 border-t border-border pt-2.5">
                  {team.length > 0 && <AvatarStack people={team} max={3} />}
                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    {h.late > 0 && <Pill tone="danger">{h.late} atrasadas</Pill>}
                    {h.blocked > 0 && <Pill tone="warning">{h.blocked} bloqueadas</Pill>}
                    <span className="text-xs text-muted-foreground">
                      {p.due_date ? new Date(`${p.due_date}T12:00:00`).toLocaleDateString("pt-BR") : "sem prazo"}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <span className="min-w-0 flex-1">Projeto</span>
            <span className="hidden w-28 sm:block">Status</span>
            <span className="hidden w-36 md:block">Progresso</span>
            <span className="hidden w-32 lg:block">Gestor</span>
            <span className="w-24 text-right">Entrega</span>
          </div>
          <ul>
            {list.map((p) => {
              const h = projectHealth(p, tasks);
              return (
                <li key={p.id} className="border-t border-border/60 first:border-t-0">
                  <Link
                    to="/projetos/$projectId"
                    params={{ projectId: p.id }}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/40"
                  >
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold",
                        softClass(p.color),
                      )}
                    >
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                    <span className="hidden w-28 sm:block">
                      <Pill>{PROJECT_STATUS_LABEL[p.status] ?? p.status}</Pill>
                    </span>
                    <span className="hidden w-36 items-center gap-2 md:flex">
                      <Bar value={h.progress} />
                      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{h.progress}%</span>
                    </span>
                    <span className="hidden w-32 truncate text-xs text-muted-foreground lg:block">
                      {nameById(members, p.manager_id)}
                    </span>
                    <span className="w-24 text-right text-xs text-muted-foreground">
                      {p.due_date ? new Date(`${p.due_date}T12:00:00`).toLocaleDateString("pt-BR") : "—"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
