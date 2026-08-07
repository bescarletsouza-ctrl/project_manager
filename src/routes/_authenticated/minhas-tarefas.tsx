import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, Field } from "@/components/ui-bits";
import { TaskPane } from "@/components/TaskPane";
import { createTask, updateTask } from "@/lib/data";
import { useInvalidate, useWorkspaceData } from "@/lib/useData";
import { useAsanaData, useCurrentMember } from "@/lib/useAsana";
import { isLate, isOpen, type Member, type Task } from "@/lib/domain";
import { dotClass } from "@/lib/colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/minhas-tarefas")({
  head: () => ({
    meta: [
      { title: "Minhas Tarefas — o que fazer hoje — Fluxo" },
      {
        name: "description",
        content: "Suas tarefas organizadas por Hoje, Próximos dias e Depois, com prazos, marcos e bloqueios.",
      },
      { property: "og:title", content: "Minhas Tarefas — Fluxo" },
      { property: "og:description", content: "Sua lista pessoal: hoje, próximos dias e depois." },
    ],
  }),
  component: MyTasksPage,
});

type BucketId = "atrasadas" | "hoje" | "proximos" | "depois" | "sem_prazo";

const BUCKETS: { id: BucketId; label: string; offset: number | null }[] = [
  { id: "atrasadas", label: "Atrasadas", offset: 0 },
  { id: "hoje", label: "Hoje", offset: 0 },
  { id: "proximos", label: "Próximos 7 dias", offset: 3 },
  { id: "depois", label: "Depois", offset: 14 },
  { id: "sem_prazo", label: "Sem prazo", offset: null },
];

function isoIn(days: number | null) {
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function bucketOf(task: Task): BucketId {
  if (!task.due_date) return "sem_prazo";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${task.due_date}T00:00:00`);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "atrasadas";
  if (diff === 0) return "hoje";
  if (diff <= 7) return "proximos";
  return "depois";
}

function MyTasksPage() {
  const { tasks, members, projects, isLoading } = useWorkspaceData();
  const { sections, fields, fieldValues, comments, dependencies, taskProjects, attachments } = useAsanaData();
  const { member, userId } = useCurrentMember();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [pickedId, setPickedId] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Partial<Record<BucketId, boolean>>>({});

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const activeMember = member ?? members.find((m) => m.id === pickedId) ?? null;
  const live = openTask ? (tasks.find((t) => t.id === openTask.id) ?? null) : null;

  if (!activeMember) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Minhas Tarefas</h1>
        <div className="card-surface max-w-md space-y-3 p-5">
          <p className="text-sm text-muted-foreground">
            Sua conta ainda não está vinculada a uma pessoa da equipe. Escolha quem você é para ver sua lista.
          </p>
          <Field label="Sou">
            <select value={pickedId} onChange={(e) => setPickedId(e.target.value)} className="field w-full">
              <option value="">Selecione…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            Dica: em{" "}
            <Link to="/configuracoes" className="text-brand hover:underline">
              Configurações
            </Link>{" "}
            você vincula o e-mail da conta ao membro da equipe.
          </p>
        </div>
      </div>
    );
  }

  const mine = tasks.filter((t) => t.assignee_id === activeMember.id && !t.parent_task_id);
  const visible = showDone ? mine : mine.filter(isOpen);
  const open = mine.filter(isOpen);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={activeMember.name} color={activeMember.avatar_color} size="lg" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Minhas Tarefas</h1>
          <p className="text-sm text-muted-foreground">
            {open.length} abertas · {open.filter(isLate).length} atrasadas
          </p>
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Mostrar concluídas
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nada pendente para você"
          description="Aproveite — ou puxe uma tarefa de um projeto para a sua lista."
        />
      ) : (
        <div className="card-surface overflow-hidden">
          {BUCKETS.map((b) => {
            const list = visible
              .filter((t) => bucketOf(t) === b.id)
              .slice()
              .sort((a, c) => (a.due_date ?? "9999").localeCompare(c.due_date ?? "9999"));
            const isCollapsed = collapsed[b.id] ?? false;
            if (list.length === 0 && b.id !== "hoje") return null;

            return (
              <section key={b.id} className="border-b border-border last:border-b-0">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [b.id]: !isCollapsed }))}
                  className="flex w-full items-center gap-1.5 bg-secondary/40 px-3 py-2 text-left"
                >
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isCollapsed && "-rotate-90")} />
                  <span className={cn("text-sm font-semibold", b.id === "atrasadas" && "text-destructive")}>
                    {b.label}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{list.length}</span>
                </button>

                {!isCollapsed && (
                  <>
                    {list.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        projects={projects}
                        members={members}
                        onOpen={() => setOpenTask(t)}
                      />
                    ))}
                    <AddMyTask member={activeMember} dueDate={isoIn(b.offset)} />
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}

      {live && (
        <TaskPane
          task={live}
          tasks={tasks}
          members={members}
          sections={sections}
          fields={fields}
          fieldValues={fieldValues}
          comments={comments}
          dependencies={dependencies}
          projects={projects}
          taskProjects={taskProjects}
          attachments={attachments}
          currentMember={activeMember}
          currentUserId={userId}
          onClose={() => setOpenTask(null)}
          onOpenTask={(t) => setOpenTask(t)}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  projects,
  members,
  onOpen,
}: {
  task: Task;
  projects: { id: string; name: string; color: string }[];
  members: Member[];
  onOpen: () => void;
}) {
  const invalidateTask = useInvalidate(["tasks"]);
  const done = task.status === "concluido";
  const project = projects.find((p) => p.id === task.project_id) ?? null;

  const patch = useMutation({
    mutationFn: (input: Record<string, unknown>) => updateTask(task.id, input),
    onSuccess: () => invalidateTask(),
    onError: () => toast.error("Não foi possível atualizar."),
  });

  return (
    <div className="group flex items-center gap-2 border-t border-border/60 px-3 py-1.5 hover:bg-secondary/40">
      <button
        type="button"
        aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
        onClick={() => patch.mutate({ status: done ? "em_andamento" : "concluido", completed: !done })}
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
          done ? "border-success bg-success text-white" : "border-input text-transparent hover:border-success hover:text-success",
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </button>

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={cn("truncate text-sm", done && "text-muted-foreground line-through")}>{task.title}</span>
      </button>

      {project && (
        <Link
          to="/projetos/$projectId"
          params={{ projectId: project.id }}
          className="hidden items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground sm:flex"
        >
          <span className={cn("size-2 rounded-[2px]", dotClass(project.color))} />
          <span className="max-w-32 truncate">{project.name}</span>
        </Link>
      )}

      <input
        type="date"
        aria-label="Prazo"
        value={task.due_date ?? ""}
        onChange={(e) => patch.mutate({ due_date: e.target.value || null })}
        className={cn("field-inline w-28 shrink-0", isLate(task) && "text-destructive")}
      />

      <Avatar
        name={members.find((m) => m.id === task.assignee_id)?.name}
        color={members.find((m) => m.id === task.assignee_id)?.avatar_color}
        size="xs"
      />
    </div>
  );
}

/** Criação rápida direto na seção, já atribuída a mim e com o prazo da faixa. */
function AddMyTask({ member, dueDate }: { member: Member; dueDate: string | null }) {
  const invalidateTask = useInvalidate(["tasks"]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const add = useMutation({
    mutationFn: (title: string) =>
      createTask({
        title,
        assignee_id: member.id,
        due_date: dueDate,
        status: "a_fazer",
      }),
    onSuccess: () => invalidateTask(),
    onError: () => toast.error("Não foi possível criar a tarefa."),
  });

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
      >
        <Plus className="size-4" /> Adicionar tarefa
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-border/60 px-3 py-1.5">
      <span className="size-[18px] shrink-0 rounded-full border border-dashed border-input" />
      <input
        autoFocus
        value={value}
        maxLength={140}
        placeholder="Escreva e pressione Enter"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim().length >= 2) {
            add.mutate(value.trim());
            setValue("");
          }
          if (e.key === "Escape") {
            setValue("");
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (value.trim().length >= 2) add.mutate(value.trim());
          setValue("");
          setEditing(false);
        }}
        className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm focus:border-ring focus:outline-none"
      />
    </div>
  );
}
