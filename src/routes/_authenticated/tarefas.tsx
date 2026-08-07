import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionTitle, StatusBadge, Pill, EmptyState } from "@/components/ui-bits";
import { useInvalidate, useWorkspaceData, nameById } from "@/lib/useData";
import { createTask, updateTask } from "@/lib/data";
import { TaskCheck, TaskEditDialog } from "@/components/TaskEditDialog";
import { DeadlinePill } from "@/components/project/ProjectViews";
import {
  COMPLEXITY_OPTIONS,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_META,
  STATUS_ORDER,
  formatHours,
  cycleTime,
  isLate,
  leadTime,
  timeInStatus,
  timeToStart,
  type Task,
  type TaskStatus,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/tarefas")({
  head: () => ({
    meta: [
      { title: "Tarefas e Kanban — Fluxo" },
      {
        name: "description",
        content:
          "Gerencie tarefas em lista ou kanban, com histórico de movimentações e tempos calculados automaticamente.",
      },
      { property: "og:title", content: "Tarefas e Kanban — Fluxo" },
      { property: "og:description", content: "Fluxo de status, prazos, complexidade e histórico completo." },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const { tasks, projects, members, departments, clients, events, isLoading } = useWorkspaceData();
  // Status muda dispara trigger de histórico (task_status_history) — inclui
  // status_events no escopo.
  const invalidateStatus = useInvalidate(["tasks", "status_events"]);
  const invalidateTask = useInvalidate(["tasks"]);
  const [view, setView] = useState<"lista" | "kanban">("kanban");
  const [selected, setSelected] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({ project: "", assignee: "", status: "", priority: "", late: false });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateTask(id, { status }),
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
          (!filters.late || isLate(t)),
      ),
    [tasks, filters],
  );

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
        <label className="flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm">
          <input type="checkbox" checked={filters.late} onChange={(e) => setFilters({ ...filters, late: e.target.checked })} />
          Somente atrasadas
        </label>
        <button
          onClick={() => setFilters({ project: "", assignee: "", status: "", priority: "", late: false })}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
        >
          Limpar
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Nenhuma tarefa encontrada" description="Ajuste os filtros ou crie uma nova tarefa." />
      ) : view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STATUS_ORDER.map((status) => {
            const column = filtered.filter((t) => t.status === status);
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
                  <span className="text-xs text-muted-foreground">{column.length}</span>
                </div>
                <div className="space-y-2">
                  {column.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                      onClick={() => setSelected(t)}
                      className="card-surface w-full cursor-pointer space-y-2 p-3 text-left transition-shadow hover:shadow-md"
                    >
                      <div className="flex items-start gap-2">
                        <TaskCheck task={t} className="mt-0.5" />
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
                <th className="px-4 py-2 font-medium">Tarefa</th>
                <th className="px-4 py-2 font-medium">Projeto</th>
                <th className="px-4 py-2 font-medium">Responsável</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Pts</th>
                <th className="px-4 py-2 font-medium">Prazo</th>
                <th className="px-4 py-2 font-medium">Situação do prazo</th>
                <th className="px-4 py-2 font-medium">Lead time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => setSelected(t)}>
                  <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                    <TaskCheck task={t} />
                  </td>
                  <td className={`max-w-[300px] truncate px-4 py-2 font-medium ${t.status === "concluido" ? "text-muted-foreground line-through" : ""}`}>{t.title}</td>
                  <td className="px-4 py-2">{nameById(projects, t.project_id)}</td>
                  <td className="px-4 py-2">{nameById(members, t.assignee_id)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={t.status as TaskStatus} />
                  </td>
                  <td className="px-4 py-2 tabular-nums">{t.complexity}</td>
                  <td className={`px-4 py-2 ${isLate(t) ? "text-destructive" : ""}`}>{t.due_date ?? "—"}</td>
                  <td className="px-4 py-2">
                    <DeadlinePill task={t} />
                  </td>
                  <td className="px-4 py-2 tabular-nums">{formatHours(leadTime(t))}</td>
                </tr>
              ))}
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
        />
      )}

      {creating && (
        <NewTaskDialog
          onClose={() => setCreating(false)}
          projects={projects}
          members={members}
          departments={departments}
          clients={clients}
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
}: {
  task: Task;
  onClose: () => void;
  events: { id: string; task_id: string; from_status: string | null; to_status: string; entered_at: string; exited_at: string | null; duration_minutes: number | null }[];
  members: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  onStatus: (status: string) => void;
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
            <TaskCheck task={task} className="mt-1" />
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
        <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>

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
      {editing && <TaskEditDialog task={task} members={members} onClose={() => setEditing(false)} onDeleted={onClose} />}
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
}: {
  onClose: () => void;
  onCreated: () => void;
  projects: { id: string; name: string; department_id: string | null; client_id: string | null }[];
  members: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  clients: { id: string; name: string }[];
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
      await createTask({ ...form, due_date: form.due_date || null });
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
