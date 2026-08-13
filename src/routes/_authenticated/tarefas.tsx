import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { SectionTitle, StatusBadge, Pill, EmptyState } from "@/components/ui-bits";
import { useInvalidate, useWorkspaceData, nameById } from "@/lib/useData";
import { createTask, updateTask } from "@/lib/data";
import { TaskCheck, TaskEditDialog } from "@/components/TaskEditDialog";
import { DeadlinePill, useSectionSortDir } from "@/components/project/ProjectViews";
import { RichTextView } from "@/components/RichTextEditor";
import {
  automationsQuery,
  commentsQuery,
  mentionsQuery,
  notifyAssignment,
  notifyStatusMilestone,
  sectionsQuery,
  taskProjectsQuery,
  type Automation,
  type Section,
  type TaskProject,
} from "@/lib/asana";
import { applyAutomationMoves, runAutomations } from "@/lib/automations";
import { colorForSectionName, softClass } from "@/lib/colors";
import { useCurrentMember } from "@/lib/useAsana";
import { cn } from "@/lib/utils";
import {
  COMPLEXITY_OPTIONS,
  DEADLINE_STATUS_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_META,
  STATUS_ORDER,
  deadlineStatus,
  formatHours,
  cycleTime,
  isLate,
  leadTime,
  timeInStatus,
  timeToStart,
  type DeadlineStatus,
  type Member,
  type Project,
  type Task,
  type TaskStatus,
} from "@/lib/domain";

/** Ordem de urgência pra ordenar a coluna "Situação do prazo" — atrasado primeiro. */
const DEADLINE_SORT_RANK: Record<DeadlineStatus, number> = {
  atrasado: 0,
  vencendo_hoje: 1,
  no_prazo: 2,
  sem_prazo: 3,
  concluido: 4,
  cancelado: 5,
};

type SortKey = "title" | "project" | "assignee" | "section" | "complexity" | "due_date" | "deadline" | "leadtime";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

/**
 * Seção "de verdade" da tarefa no projeto principal dela. Uma tarefa vinculada
 * a outro projeto pelo "+ Adicionar a projeto" (TaskPane) guarda a posição
 * NAQUELE projeto em task_projects.section_id, não em task.section_id (esse
 * campo é o "nativo", usado pelo departamento) — mesma regra de sectionOf()
 * na página do projeto. Ler task.section_id direto aqui mostrava "Sem seção"
 * pra tarefa que tinha seção certinha dentro do próprio projeto.
 */
function sectionIdOfTask(t: Task, taskProjects: TaskProject[]): string | null {
  if (t.project_id) {
    const link = taskProjects.find((l) => l.task_id === t.id && l.project_id === t.project_id);
    if (link?.section_id) return link.section_id;
  }
  return t.section_id;
}

function compareTasks(
  a: Task,
  b: Task,
  key: SortKey,
  projects: Project[],
  members: Member[],
  sections: Section[],
  taskProjects: TaskProject[],
): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title);
    case "project":
      return nameById(projects, a.project_id).localeCompare(nameById(projects, b.project_id));
    case "assignee":
      return nameById(members, a.assignee_id).localeCompare(nameById(members, b.assignee_id));
    case "section":
      return nameById(sections, sectionIdOfTask(a, taskProjects)).localeCompare(
        nameById(sections, sectionIdOfTask(b, taskProjects)),
      );
    case "complexity":
      return a.complexity - b.complexity;
    case "due_date":
      return (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31");
    case "deadline":
      return DEADLINE_SORT_RANK[deadlineStatus(a)] - DEADLINE_SORT_RANK[deadlineStatus(b)];
    case "leadtime":
      return (leadTime(a) ?? -1) - (leadTime(b) ?? -1);
    default:
      return 0;
  }
}

/** Cabeçalho de coluna clicável, com seta de ordenação (mesmo padrão da Lista do projeto). */
function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={cn("px-4 py-2 font-medium", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("group flex items-center gap-1", active ? "text-foreground" : "hover:text-foreground")}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-50" />
        )}
      </button>
    </th>
  );
}

/**
 * Lembra a última visualização escolhida (Lista/Quadro) entre sessões — sem
 * isso, trocar de página (ou fechar o navegador) sempre voltava pro Quadro,
 * mesmo pra quem prefere trabalhar na Lista.
 */
function useViewPreference(): ["lista" | "kanban", (v: "lista" | "kanban") => void] {
  const storageKey = "fluxo:tarefas-view";
  const [view, setViewState] = useState<"lista" | "kanban">("kanban");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "lista" || raw === "kanban") setViewState(raw);
    } catch {
      /* modo privado ou cota cheia: só afeta esta sessão */
    }
  }, []);

  const setView = (v: "lista" | "kanban") => {
    setViewState(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      /* modo privado ou cota cheia: só afeta esta sessão */
    }
  };

  return [view, setView];
}

export const Route = createFileRoute("/_authenticated/tarefas")({
  head: () => ({
    meta: [
      { title: "Tarefas e Kanban — Alana" },
      {
        name: "description",
        content:
          "Gerencie tarefas em lista ou kanban, com histórico de movimentações e tempos calculados automaticamente.",
      },
      { property: "og:title", content: "Tarefas e Kanban — Alana" },
      { property: "og:description", content: "Fluxo de status, prazos, complexidade e histórico completo." },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const { tasks, projects, members, departments, clients, events, isLoading } = useWorkspaceData();
  const { member: currentMember } = useCurrentMember();
  const automations = useQuery(automationsQuery).data ?? [];
  const comments = useQuery(commentsQuery).data ?? [];
  const mentions = useQuery(mentionsQuery).data ?? [];
  const sections = useQuery(sectionsQuery).data ?? [];
  const taskProjects = useQuery(taskProjectsQuery).data ?? [];
  // Status muda dispara trigger de histórico (task_status_history) — inclui
  // status_events no escopo. Automação pode mexer em task_projects (mover
  // seção de projeto), task_field_values (set_field) ou criar notificação.
  const invalidateStatus = useInvalidate([
    "tasks",
    "status_events",
    "task_projects",
    "task_field_values",
    "notifications",
  ]);
  const invalidateTask = useInvalidate(["tasks"]);
  const [view, setView] = useViewPreference();
  const [selected, setSelected] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({
    project: "",
    assignee: "",
    status: "",
    priority: "",
    deadline: "",
    hideDone: false,
    from: "",
    to: "",
  });
  const [sort, setSort] = useState<SortState>(null);
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  /** Ordenação por prazo de cada etapa do Quadro — mesmo mecanismo (e mesma seta) do Quadro de departamento/projeto. */
  const { dirOf: colSortDirOf, toggle: toggleColSort } = useSectionSortDir("tarefas-board");

  /**
   * Muda o status (drag no Kanban ou botões "Alterar status" no drawer).
   * Precisa rodar as automações do projeto/departamento da tarefa — senão uma
   * regra tipo "concluído → mover pra seção Concluído" nunca disparava por
   * aqui, só quando a tarefa era concluída dentro do próprio Quadro do
   * projeto/departamento.
   */
  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) {
        await updateTask(id, { status });
        return;
      }
      const { patch, applied, moves } = runAutomations(
        automations,
        "status_changed",
        { ...task, status },
        { projectId: task.project_id, departmentId: task.department_id },
      );
      if (applied.length) toast.info(`Automação aplicada: ${applied.join(", ")}`);
      await updateTask(id, { status, completed: status === "concluido", ...patch });
      await applyAutomationMoves(id, { projectId: task.project_id, departmentId: task.department_id }, moves);
      const finalStatus = (patch["status"] as TaskStatus | undefined) ?? status;
      await notifyStatusMilestone(task, finalStatus, comments, mentions, currentMember?.id ?? null);
    },
    onSuccess: () => {
      invalidateStatus();
      toast.success("Status atualizado — movimentação registrada no histórico.");
    },
    onError: () => toast.error("Não foi possível atualizar a tarefa."),
  });

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (!filters.project || t.project_id === filters.project) &&
          (!filters.assignee || t.assignee_id === filters.assignee) &&
          (!filters.status || t.status === filters.status) &&
          (!filters.priority || t.priority === filters.priority) &&
          (!filters.deadline || deadlineStatus(t) === filters.deadline) &&
          (!filters.hideDone || t.status !== "concluido") &&
          (!filters.from || (t.due_date ?? "") >= filters.from) &&
          (!filters.to || (t.due_date ?? "") <= filters.to),
      ),
    [tasks, filters],
  );

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const factor = sort.dir === "asc" ? 1 : -1;
    return filtered
      .slice()
      .sort((a, b) => compareTasks(a, b, sort.key, projects, members, sections, taskProjects) * factor);
  }, [filtered, sort, projects, members, sections, taskProjects]);

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tarefas</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} tarefas · arraste entre colunas para registrar movimentações.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border p-1">
            {(["kanban", "lista"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${view === v ? "bg-secondary" : "text-muted-foreground"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCreating(true)}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Nova tarefa
          </button>
        </div>
      </div>

      <div className="card-surface flex flex-wrap gap-2 p-3">
        <Select value={filters.project} onChange={(v) => setFilters({ ...filters, project: v })} placeholder="Projeto" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Select value={filters.assignee} onChange={(v) => setFilters({ ...filters, assignee: v })} placeholder="Responsável" options={members.map((m) => ({ value: m.id, label: m.name }))} />
        <Select value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} placeholder="Status" options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label }))} />
        <Select value={filters.priority} onChange={(v) => setFilters({ ...filters, priority: v })} placeholder="Prioridade" options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        <Select
          value={filters.deadline}
          onChange={(v) => setFilters({ ...filters, deadline: v })}
          placeholder="Situação do prazo"
          options={Object.entries(DEADLINE_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={filters.hideDone}
            onChange={(e) => setFilters({ ...filters, hideDone: e.target.checked })}
          />
          Ocultar concluídas
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          De
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Até
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() =>
            setFilters({
              project: "",
              assignee: "",
              status: "",
              priority: "",
              deadline: "",
              hideDone: false,
              from: "",
              to: "",
            })
          }
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
        >
          Limpar
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Nenhuma tarefa encontrada" description="Ajuste os filtros ou crie uma nova tarefa." />
      ) : view === "kanban" ? (
        <div className="flex items-start gap-3 overflow-x-auto pb-4">
          {STATUS_ORDER.map((status) => {
            const dir = colSortDirOf(status);
            // Sem prazo cai por último em qualquer direção — mesma convenção do Quadro de departamento/projeto.
            const column = filtered
              .filter((t) => t.status === status)
              .slice()
              .sort(
                dir === "asc"
                  ? (a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")
                  : (a, b) => (b.due_date ?? "0000-00-00").localeCompare(a.due_date ?? "0000-00-00"),
              );
            return (
              <div
                key={status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) move.mutate({ id, status });
                }}
                className="w-72 shrink-0 rounded-lg border border-border bg-muted/40 p-2"
              >
                <div className="flex items-center justify-between px-1 pb-2">
                  <StatusBadge status={status} />
                  <div className="flex items-center gap-0.5">
                    <span className="text-xs text-muted-foreground">{column.length}</span>
                    <button
                      type="button"
                      onClick={() => toggleColSort(status)}
                      aria-label={dir === "asc" ? "Ordenar por prazo mais distante primeiro" : "Ordenar por prazo mais próximo primeiro"}
                      title={dir === "asc" ? "Vence mais cedo primeiro — clique para inverter" : "Vence mais tarde primeiro — clique para inverter"}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      {dir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="max-h-[65vh] space-y-1.5 overflow-y-auto">
                  {column.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                      onClick={() => setSelected(t)}
                      className="card-surface w-full cursor-pointer space-y-2 p-3 text-left transition-shadow hover:shadow-md"
                    >
                      <div className="flex items-start gap-2">
                        <TaskCheck task={t} className="mt-0.5" currentMemberId={currentMember?.id ?? null} automations={automations} />
                        <p className={`text-sm font-medium ${t.status === "concluido" ? "text-muted-foreground line-through" : ""}`}>{t.title}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Pill tone={t.priority === "urgente" ? "danger" : t.priority === "alta" ? "warning" : "neutral"}>
                          {PRIORITY_LABEL[t.priority]}
                        </Pill>
                        <Pill tone="info">{t.complexity} pts</Pill>
                        <DeadlinePill task={t} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {nameById(members, t.assignee_id)} · {t.due_date ?? "sem prazo"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">✓</th>
                <SortableTh label="Tarefa" sortKey="title" sort={sort} onSort={toggleSort} />
                <SortableTh label="Projeto" sortKey="project" sort={sort} onSort={toggleSort} />
                <SortableTh label="Responsável" sortKey="assignee" sort={sort} onSort={toggleSort} />
                <SortableTh label="Seção" sortKey="section" sort={sort} onSort={toggleSort} />
                <SortableTh label="Pts" sortKey="complexity" sort={sort} onSort={toggleSort} />
                <SortableTh label="Prazo" sortKey="due_date" sort={sort} onSort={toggleSort} />
                <SortableTh label="Situação do prazo" sortKey="deadline" sort={sort} onSort={toggleSort} />
                <SortableTh label="Lead time" sortKey="leadtime" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const section = sections.find((s) => s.id === sectionIdOfTask(t, taskProjects));
                return (
                <tr key={t.id} className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => setSelected(t)}>
                  <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                    <TaskCheck task={t} currentMemberId={currentMember?.id ?? null} automations={automations} />
                  </td>
                  <td className={`max-w-[300px] truncate px-4 py-2 font-medium ${t.status === "concluido" ? "text-muted-foreground line-through" : ""}`}>{t.title}</td>
                  <td className="px-4 py-2">{nameById(projects, t.project_id)}</td>
                  <td className="px-4 py-2">{nameById(members, t.assignee_id)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
                        softClass(section ? colorForSectionName(section.name) : "slate"),
                      )}
                    >
                      {section?.name ?? "Sem seção"}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{t.complexity}</td>
                  <td className={`px-4 py-2 ${isLate(t) ? "text-destructive" : ""}`}>{t.due_date ?? "—"}</td>
                  <td className="px-4 py-2">
                    <DeadlinePill task={t} />
                  </td>
                  <td className="px-4 py-2 tabular-nums">{formatHours(leadTime(t))}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <TaskDrawer
          task={tasks.find((t) => t.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          events={events}
          members={members}
          projects={projects}
          onStatus={(status) => move.mutate({ id: selected.id, status })}
          currentMemberId={currentMember?.id ?? null}
          automations={automations}
        />
      )}

      {creating && (
        <NewTaskDialog
          onClose={() => setCreating(false)}
          projects={projects}
          members={members}
          departments={departments}
          clients={clients}
          currentMemberId={currentMember?.id ?? null}
          onCreated={() => {
            invalidateTask();
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TaskDrawer({
  task,
  onClose,
  events,
  members,
  projects,
  onStatus,
  currentMemberId,
  automations,
}: {
  task: Task;
  onClose: () => void;
  events: { id: string; task_id: string; from_status: string | null; to_status: string; entered_at: string; exited_at: string | null; duration_minutes: number | null }[];
  members: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  onStatus: (status: TaskStatus) => void;
  currentMemberId: string | null;
  automations: Automation[];
}) {
  const [editing, setEditing] = useState(false);
  const perStatus = timeInStatus(events, task);
  const history = events
    .filter((e) => e.task_id === task.id)
    .sort((a, b) => +new Date(a.entered_at) - +new Date(b.entered_at));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <TaskCheck task={task} className="mt-1" currentMemberId={currentMemberId} automations={automations} />
            <h2 className="text-lg font-semibold">{task.title}</h2>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setEditing(true)} className="text-sm font-medium text-primary hover:underline">
              Editar
            </button>
            <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
              Fechar
            </button>
          </div>
        </div>
        {task.description && (
          <RichTextView html={task.description} className="mt-2 text-muted-foreground" />
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Field label="Projeto" value={projects.find((p) => p.id === task.project_id)?.name ?? "—"} />
          <Field label="Responsável" value={members.find((m) => m.id === task.assignee_id)?.name ?? "—"} />
          <Field label="Prioridade" value={PRIORITY_LABEL[task.priority]} />
          <Field label="Complexidade" value={`${task.complexity} pts`} />
          <Field label="Prazo" value={task.due_date ?? "—"} />
          <Field label="Reaberturas" value={String(task.reopen_count)} />
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Alterar status</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => onStatus(s)}
                className={`rounded-full border px-2.5 py-1 text-xs ${task.status === s ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary"}`}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Metric label="Até iniciar" value={formatHours(timeToStart(task))} />
          <Metric label="Cycle time" value={formatHours(cycleTime(task))} />
          <Metric label="Lead time" value={formatHours(leadTime(task))} />
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tempo por status</p>
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(perStatus).map(([status, hours]) => (
              <li key={status} className="flex justify-between">
                <span>{STATUS_META[status as TaskStatus]?.label ?? status}</span>
                <span className="tabular-nums text-muted-foreground">{formatHours(hours)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Histórico de movimentações</p>
          <ol className="mt-2 space-y-2 border-l border-border pl-4 text-sm">
            {history.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                <p>
                  {e.from_status ? `${STATUS_META[e.from_status as TaskStatus]?.label ?? e.from_status} → ` : "Criada em "}
                  <strong>{STATUS_META[e.to_status as TaskStatus]?.label ?? e.to_status}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.entered_at).toLocaleString("pt-BR")}
                  {e.duration_minutes !== null ? ` · permaneceu ${formatHours(e.duration_minutes / 60)}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {editing && (
        <TaskEditDialog
          task={task}
          members={members}
          onClose={() => setEditing(false)}
          onDeleted={onClose}
          currentMemberId={currentMemberId}
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function NewTaskDialog({
  onClose,
  onCreated,
  projects,
  members,
  departments,
  clients,
  currentMemberId,
}: {
  onClose: () => void;
  onCreated: () => void;
  projects: { id: string; name: string; department_id: string | null; client_id: string | null }[];
  members: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  currentMemberId: string | null;
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    project_id: projects[0]?.id ?? "",
    assignee_id: members[0]?.id ?? "",
    department_id: departments[0]?.id ?? "",
    client_id: clients[0]?.id ?? "",
    priority: "media",
    complexity: 3,
    status: "backlog",
    due_date: "",
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.title.trim().length < 3) {
      toast.error("Informe um título com pelo menos 3 caracteres.");
      return;
    }
    setSaving(true);
    try {
      const taskId = await createTask({ ...form, due_date: form.due_date || null });
      await notifyAssignment(
        { id: taskId, title: form.title.trim(), project_id: form.project_id || null },
        form.assignee_id || null,
        currentMemberId,
      );
      toast.success("Tarefa criada.");
      onCreated();
    } catch {
      toast.error("Não foi possível criar a tarefa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-3 rounded-lg border border-border bg-card p-5"
      >
        <SectionTitle title="Nova tarefa" />
        <input
          placeholder="Título"
          value={form.title}
          maxLength={140}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Descrição"
          value={form.description}
          maxLength={2000}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.complexity} onChange={(e) => setForm({ ...form, complexity: Number(e.target.value) })}>
            {COMPLEXITY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </select>
          <input type="date" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm hover:bg-secondary">
            Cancelar
          </button>
          <button disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            {saving ? "Salvando..." : "Criar tarefa"}
          </button>
        </div>
      </form>
    </div>
  );
}
