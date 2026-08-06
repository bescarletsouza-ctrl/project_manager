import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, Pill, RowMenu, StatusBadge } from "@/components/ui-bits";
import { TaskPane } from "@/components/TaskPane";
import { NewTaskDialog } from "@/components/dialogs";
import { createSection, createTaskLinked, deleteSection, updateSection } from "@/lib/asana";
import { deleteDepartment, deleteTask, updateDepartment, updateTask } from "@/lib/data";
import { useWorkspaceData } from "@/lib/useData";
import { useAsanaData, useCurrentMember } from "@/lib/useAsana";
import { PRIORITY_LABEL, isLate, type Priority, type Task } from "@/lib/domain";
import { dotClass } from "@/lib/colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/departamentos/$departmentId")({
  head: () => ({
    meta: [
      { title: "Departamento — Quadro de tarefas — Fluxo" },
      {
        name: "description",
        content:
          "Quadro Kanban do departamento com seções próprias e tarefas atribuídas a pessoas.",
      },
      { property: "og:title", content: "Departamento — Fluxo" },
      { property: "og:description", content: "Tarefas organizadas por seção, sem depender de projeto." },
    ],
  }),
  component: DepartmentDetail,
});

/** "12 de mar" — mesma abreviação usada nas outras views. */
function shortDate(date?: string | null) {
  if (!date) return "—";
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function DepartmentDetail() {
  const { departmentId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { departments, members, tasks, isLoading } = useWorkspaceData();
  const {
    sections: allSections,
    fields,
    fieldValues,
    comments,
    dependencies,
    taskProjects,
    automations,
    attachments,
  } = useAsanaData();
  const { member: currentMember, userId } = useCurrentMember();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editHeader, setEditHeader] = useState(false);

  const department = departments.find((d) => d.id === departmentId);

  const patchDept = useMutation({
    mutationFn: (patch: { name?: string; color?: string }) => updateDepartment(departmentId, patch),
    onSuccess: () => {
      qc.invalidateQueries();
      setEditHeader(false);
    },
    onError: () => toast.error("Não foi possível salvar."),
  });

  const removeDept = useMutation({
    mutationFn: () => deleteDepartment(departmentId),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Departamento removido.");
      navigate({ to: "/departamentos" });
    },
    onError: () => toast.error("Não foi possível remover."),
  });

  const addSection = useMutation({
    mutationFn: (name: string) =>
      createSection({ department_id: departmentId, name, position: 999 }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Seção criada.");
    },
    onError: (e: unknown) =>
      toast.error(`Não foi possível criar a seção: ${(e as Error)?.message ?? "erro"}`),
  });

  const renameSection = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      updateSection(input.id, { name: input.name }),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível renomear a seção."),
  });

  const removeSection = useMutation({
    mutationFn: (id: string) => deleteSection(id),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Seção removida.");
    },
    onError: () => toast.error("Não foi possível remover a seção."),
  });

  /** Cria uma tarefa direto no departamento (sem projeto), na seção informada. */
  const quickAddTask = useMutation({
    mutationFn: (input: { title: string; sectionId: string | null }) =>
      createTaskLinked(
        {
          title: input.title,
          project_id: null,
          department_id: departmentId,
          section_id: input.sectionId,
          status: "a_fazer",
          assignee_id: currentMember?.id ?? null,
        },
        // sem projeto: task_projects não recebe nada
        [],
      ),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: unknown) =>
      toast.error(`Não foi possível criar a tarefa: ${(e as Error)?.message ?? "erro"}`),
  });

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;
  if (!department) {
    return (
      <div className="card-surface p-10 text-center">
        <p className="font-medium">Departamento não encontrado.</p>
        <Link to="/departamentos" className="mt-2 inline-block text-sm text-primary hover:underline">
          Voltar
        </Link>
      </div>
    );
  }

  const sections = allSections.filter((s) => s.department_id === departmentId);
  const deptTasks = tasks.filter((t) => t.department_id === departmentId && !t.parent_task_id);
  const deptMembers = members.filter((m) => m.department_id === departmentId);

  // Se ainda não há nenhuma seção, mostramos "Sem seção" como caixa única
  // — de resto, o botão "Adicionar seção" fica visível em qualquer estado.
  const boardSections =
    sections.length > 0
      ? sections
      : [{ id: "", department_id: departmentId, project_id: null, name: "Sem seção", color: "slate", position: 999 }];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link to="/departamentos" className="text-xs text-muted-foreground hover:underline">
            Departamentos
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {editHeader ? (
          <input
            autoFocus
            defaultValue={department.name}
            maxLength={80}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v.length >= 2 && v !== department.name) patchDept.mutate({ name: v });
              else setEditHeader(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditHeader(false);
            }}
            className="rounded-md border border-ring bg-background px-2 py-1 text-2xl font-semibold focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditHeader(true)}
            title="Renomear departamento"
            className="flex items-center gap-2 text-2xl font-semibold tracking-tight hover:underline"
          >
            <span className={cn("size-3 rounded-full", dotClass(department.color))} />
            {department.name}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setNewTask(true)}
            className="btn btn-primary gap-1.5 px-3 py-1.5 text-sm"
          >
            <Plus className="size-4" /> Nova tarefa
          </button>
          <button
            type="button"
            onClick={() =>
              confirm(`Excluir "${department.name}"? As tarefas e seções vinculadas vão junto.`) &&
              removeDept.mutate()
            }
            className="rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            Excluir departamento
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Pill tone="info">{deptTasks.length} tarefas</Pill>
        <Pill>{sections.length} seções</Pill>
        <Pill>{deptMembers.length} pessoas no departamento</Pill>
      </div>

      {boardSections.length === 0 ? (
        <EmptyState
          title="Sem seções ainda"
          description="Adicione a primeira para começar a organizar as tarefas."
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {boardSections.map((section) => {
            const isVirtual = !section.id;
            const list = deptTasks
              .filter((t) => (isVirtual ? !t.section_id : t.section_id === section.id))
              // Mesma regra do Quadro do projeto: mais nova em cima.
              .slice()
              .sort((a, b) => b.created_at.localeCompare(a.created_at));

            return (
              <div
                key={section.id || "none"}
                className="flex w-[290px] shrink-0 flex-col rounded-lg bg-secondary/50 p-2"
              >
                <SectionHeader
                  name={section.name}
                  count={list.length}
                  editing={renaming === section.id}
                  onStartEdit={isVirtual ? undefined : () => setRenaming(section.id)}
                  onCommitName={(name) => {
                    if (section.id) renameSection.mutate({ id: section.id, name });
                    setRenaming(null);
                  }}
                  onCancelEdit={() => setRenaming(null)}
                  onAddTask={() => setNewTask(true)}
                  onRemove={
                    isVirtual
                      ? undefined
                      : () => {
                          if (confirm(`Excluir a seção "${section.name}" e as tarefas dela?`)) {
                            removeSection.mutate(section.id);
                          }
                        }
                  }
                />

                <div className="mt-1 flex flex-col gap-2">
                  {list.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      assigneeName={members.find((m) => m.id === t.assignee_id)?.name}
                      assigneeColor={members.find((m) => m.id === t.assignee_id)?.avatar_color}
                      onOpen={() => setOpenTask(t)}
                    />
                  ))}
                </div>

                <QuickAdd
                  onAdd={(title) => quickAddTask.mutate({ title, sectionId: section.id || null })}
                />
              </div>
            );
          })}

          <div className="w-56 shrink-0 pt-1">
            <AddSection onAdd={(name) => addSection.mutate(name)} />
          </div>
        </div>
      )}

      {newTask && (
        <NewTaskDialog
          onClose={() => setNewTask(false)}
          departmentId={departmentId}
        />
      )}

      {openTask && (
        <TaskPane
          task={openTask}
          tasks={tasks}
          members={members}
          sections={allSections}
          fields={fields}
          fieldValues={fieldValues}
          comments={comments}
          dependencies={dependencies}
          projects={[]}
          taskProjects={taskProjects}
          automations={automations}
          attachments={attachments}
          currentMember={currentMember}
          currentUserId={userId}
          onClose={() => setOpenTask(null)}
          onOpenTask={(t) => setOpenTask(t)}
        />
      )}
    </div>
  );
}

/* ------------------------------- peças ------------------------------- */

function SectionHeader({
  name,
  count,
  editing,
  onStartEdit,
  onCommitName,
  onCancelEdit,
  onAddTask,
  onRemove,
}: {
  name: string;
  count: number;
  editing: boolean;
  /** Ausente na coluna virtual "Sem seção" — nada a renomear/excluir. */
  onStartEdit: (() => void) | undefined;
  onCommitName: (name: string) => void;
  onCancelEdit: () => void;
  onAddTask: () => void;
  onRemove: (() => void) | undefined;
}) {
  return (
    <div className="group flex items-center gap-1.5 px-1.5 py-1">
      <ChevronDown className="size-4 text-muted-foreground" />
      {editing ? (
        <input
          autoFocus
          defaultValue={name}
          maxLength={80}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v.length >= 2 && v !== name) onCommitName(v);
            else onCancelEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") onCancelEdit();
          }}
          className="rounded-md border border-ring bg-background px-1.5 py-0.5 text-sm font-semibold focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          className="truncate text-sm font-semibold hover:underline"
          title={onStartEdit ? "Renomear seção" : undefined}
        >
          {name}
        </button>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      <button
        onClick={onAddTask}
        aria-label="Adicionar tarefa nesta seção"
        title="Nova tarefa aqui"
        className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
      {(onStartEdit || onRemove) && (
        <RowMenu
          className="ml-auto opacity-0 group-hover:opacity-100"
          actions={[
            ...(onStartEdit
              ? [{ label: "Renomear", icon: Pencil, onSelect: onStartEdit }]
              : []),
            ...(onRemove
              ? [
                  {
                    label: "Excluir seção",
                    icon: Trash2,
                    destructive: true,
                    separatorBefore: true,
                    onSelect: onRemove,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  assigneeName,
  assigneeColor,
  onOpen,
}: {
  task: Task;
  assigneeName: string | undefined;
  assigneeColor: string | undefined;
  onOpen: () => void;
}) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      updateTask(task.id, {
        status: task.status === "concluido" ? "em_andamento" : "concluido",
        completed: task.status !== "concluido",
      }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const remove = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Tarefa excluída.");
    },
  });
  const done = task.status === "concluido";

  return (
    <div className="group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="w-full cursor-pointer space-y-2 rounded-lg border border-border bg-card p-2.5 text-left transition-shadow hover:shadow-[var(--shadow-raised)] focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
            title={done ? "Reabrir" : "Concluir"}
            onClick={(e) => {
              e.stopPropagation();
              toggle.mutate();
            }}
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
              done
                ? "border-success bg-success text-white"
                : "border-input text-transparent hover:border-success hover:text-success",
            )}
          >
            <Check className="size-2.5" strokeWidth={3} />
          </button>
          <span
            className={cn(
              "flex-1 pr-5 text-sm leading-snug",
              done && "text-muted-foreground line-through",
            )}
          >
            {task.is_milestone && <Flag className="mr-1 inline size-3.5 text-warning" />}
            {task.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {task.due_date && (
            <Pill tone={isLate(task) ? "danger" : "neutral"}>{shortDate(task.due_date)}</Pill>
          )}
          <Pill
            tone={task.priority === "urgente" ? "danger" : task.priority === "alta" ? "warning" : "neutral"}
          >
            {PRIORITY_LABEL[task.priority as Priority] ?? task.priority}
          </Pill>
          <StatusBadge status={task.status} />
          <span className="ml-auto">
            <Avatar name={assigneeName} color={assigneeColor} />
          </span>
        </div>
      </div>
      <button
        type="button"
        aria-label="Excluir tarefa"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Excluir "${task.title}"?`)) remove.mutate();
        }}
        className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

/** Linha "+ Adicionar tarefa" ao fim da coluna — Enter cria; segue aberta. */
function QuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
      >
        <Plus className="size-4" /> Adicionar tarefa
      </button>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-2 rounded-md px-3 py-1.5">
      <span className="size-4 shrink-0 rounded-full border border-dashed border-input" />
      <input
        autoFocus
        value={value}
        maxLength={140}
        placeholder="Escreva e pressione Enter"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim().length >= 2) {
            onAdd(value.trim());
            setValue("");
          }
          if (e.key === "Escape") {
            setEditing(false);
            setValue("");
          }
        }}
        onBlur={() => {
          if (value.trim().length >= 2) onAdd(value.trim());
          setEditing(false);
          setValue("");
        }}
        className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm focus:border-ring focus:outline-none"
      />
    </div>
  );
}

/** Botão "+ Adicionar seção" na ponta direita, vira input ao clicar. */
function AddSection({ onAdd }: { onAdd: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
      >
        <Plus className="size-4" /> Adicionar seção
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length < 2) return;
        onAdd(value.trim());
        setValue("");
        setEditing(false);
      }}
      className="flex gap-2"
    >
      <input
        autoFocus
        value={value}
        maxLength={80}
        placeholder="Nome da seção"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim().length >= 2) onAdd(value.trim());
          setValue("");
          setEditing(false);
        }}
        className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:border-ring focus:outline-none"
      />
    </form>
  );
}
