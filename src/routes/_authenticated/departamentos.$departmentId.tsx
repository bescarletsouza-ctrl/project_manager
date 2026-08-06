import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Columns3, Flag, List, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { AutomationsPanel } from "@/components/AutomationsPanel";
import { EmptyState, Pill, RowMenu, StatusBadge } from "@/components/ui-bits";
import { TaskPane } from "@/components/TaskPane";
import { NewTaskDialog } from "@/components/dialogs";
import { createSection, createTaskLinked, deleteSection, updateSection } from "@/lib/asana";
import { deleteDepartment, deleteTask, updateDepartment, updateTask } from "@/lib/data";
import { useWorkspaceData } from "@/lib/useData";
import { useAsanaData, useCurrentMember } from "@/lib/useAsana";
import { applyAutomationMoves, runAutomations } from "@/lib/automations";
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
    automations: allAutomations,
    attachments,
  } = useAsanaData();
  const deptAutomations = allAutomations.filter((a) => a.department_id === departmentId);
  // TaskPane espera receber as automações do contexto atual — usa para
  // gatilhos de status_changed e assignee_changed. Como aqui tudo é
  // do departamento, passamos só as regras deste departamento.
  const automations = deptAutomations;
  const { member: currentMember, userId } = useCurrentMember();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editHeader, setEditHeader] = useState(false);
  const [view, setView] = useState<"board" | "list" | "auto">("board");
  /** Card em arraste (task id + seção de origem). Compartilhado por todas as colunas. */
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  /** Seção em arraste — quando o header de uma coluna/bloco é agarrado. */
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [overSectionId, setOverSectionId] = useState<string | null>(null);

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

  /**
   * Move um card entre colunas do quadro do departamento. Muda só a
   * section_id da tarefa — o vínculo com projeto (task_projects) segue
   * intacto. Se a tarefa era de um projeto, ela agora tem section_id de
   * uma seção do departamento; no quadro do projeto ela cai para "Sem
   * seção" (o oposto é o que estava faltando antes).
   */
  const moveTask = useMutation({
    mutationFn: (input: { taskId: string; sectionId: string | null }) =>
      updateTask(input.taskId, { section_id: input.sectionId }),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível mover a tarefa."),
  });

  /**
   * Reordena seções do departamento. Recebe a lista de ids na ordem final
   * e grava position por índice — mesmo padrão do useSectionMutations do
   * projeto. A ordenação no quadro/lista é por position ASC (herdada da
   * sectionsQuery), então essa gravação já refletiu no próximo render.
   */
  const reorderSections = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id, i) => updateSection(id, { position: i }))),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível reordenar as seções."),
  });

  /**
   * Cria uma tarefa direto no departamento (sem projeto). As automações
   * do próprio departamento rodam no evento task_created — mesma máquina
   * do projeto, só que filtrada por department_id. Sem seção explícita,
   * cai na 1ª do departamento (regra do produto).
   */
  const quickAddTask = useMutation({
    mutationFn: async (input: { title: string; sectionId: string | null }) => {
      const base: Record<string, unknown> = {
        title: input.title,
        project_id: null,
        department_id: departmentId,
        section_id: input.sectionId ?? firstSectionId,
        status: "a_fazer",
        assignee_id: currentMember?.id ?? null,
      };
      const { patch, applied, moves } = runAutomations(
        automations,
        "task_created",
        base as Partial<Task>,
        { departmentId },
      );
      if (applied.length) toast.info(`Automação aplicada: ${applied.join(", ")}`);
      const newId = await createTaskLinked({ ...base, ...patch }, []);
      if (newId) await applyAutomationMoves(newId, { departmentId }, moves);
      return newId;
    },
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
  /**
   * Insere a seção arrastada na posição da alvo. targetId "" (virtual
   * "Sem seção") empurra a arrastada pro fim — a virtual não tem
   * position no banco, então nunca é reordenada.
   */
  const dropSectionOn = (targetId: string) => {
    if (!dragSectionId || dragSectionId === targetId) return;
    const ids = sections.map((s) => s.id).filter((id) => id !== dragSectionId);
    const at = sections.findIndex((s) => s.id === targetId);
    ids.splice(at < 0 ? ids.length : at, 0, dragSectionId);
    reorderSections.mutate(ids);
  };
  const deptTasks = tasks.filter((t) => t.department_id === departmentId && !t.parent_task_id);
  const deptMembers = members.filter((m) => m.department_id === departmentId);
  /**
   * Set das seções que pertencem A ESTE departamento. Serve pra decidir
   * onde renderizar uma tarefa cujo section_id existe mas é de outro
   * container (ex.: veio de um projeto e o usuário marcou o departamento).
   * Sem esse tratamento a tarefa sumia — não casava com nenhuma seção do
   * departamento e nem entrava na virtual "Sem seção" (que só pegava
   * section_id === null).
   */
  const deptSectionIds = new Set(sections.map((s) => s.id));

  /**
   * Tarefas "órfãs": têm department_id mas section_id não é de uma seção
   * do departamento (veio de projeto, ou nunca teve seção). O produto pediu
   * que TODA nova demanda incluída no departamento caia na 1ª seção — em vez
   * de terem uma coluna separada "Sem seção", elas são exibidas dentro da
   * primeira seção real. Só há coluna virtual "Sem seção" quando o
   * departamento ainda não tem nenhuma seção (caso contrário, não há UI).
   */
  const orphanTasks = deptTasks.filter(
    (t) => !t.section_id || !deptSectionIds.has(t.section_id),
  );
  const firstSectionId = sections[0]?.id ?? null;
  const boardSections =
    sections.length > 0
      ? sections
      : [
          {
            id: "",
            department_id: departmentId,
            project_id: null,
            name: "Sem seção",
            color: "slate",
            position: 999,
          },
        ];

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill tone="info">{deptTasks.length} tarefas</Pill>
          <Pill>{sections.length} seções</Pill>
          <Pill>{deptMembers.length} pessoas no departamento</Pill>
        </div>
        {/* Switcher de visualização — mesmo padrão visual das abas do projeto. */}
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5 text-[13px]">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 transition-colors",
              view === "list"
                ? "bg-secondary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <List className="size-3.5" /> Lista
          </button>
          <button
            type="button"
            onClick={() => setView("board")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 transition-colors",
              view === "board"
                ? "bg-secondary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Columns3 className="size-3.5" /> Quadro
          </button>
          <button
            type="button"
            onClick={() => setView("auto")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 transition-colors",
              view === "auto"
                ? "bg-secondary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Zap className="size-3.5" /> Automações
          </button>
        </div>
      </div>

      {view === "auto" ? (
        <AutomationsPanel
          container={{ kind: "department", departmentId }}
          automations={deptAutomations}
          members={members}
          sections={sections.map((s) => ({ id: s.id, name: s.name }))}
          projects={[]}
        />
      ) : view === "list" ? (
        <ListPanel
          boardSections={boardSections}
          deptTasks={deptTasks}
          orphanTasks={orphanTasks}
          members={members}
          renamingSectionId={renaming}
          onRenameStart={(id) => setRenaming(id)}
          onRenameCommit={(id, name) => {
            renameSection.mutate({ id, name });
            setRenaming(null);
          }}
          onRenameCancel={() => setRenaming(null)}
          onRemoveSection={(id, name) => {
            if (confirm(`Excluir a seção "${name}" e as tarefas dela?`)) {
              removeSection.mutate(id);
            }
          }}
          onAddTask={(sectionId, title) => quickAddTask.mutate({ title, sectionId })}
          onOpenTask={(t) => setOpenTask(t)}
          dragSectionId={dragSectionId}
          overSectionId={overSectionId}
          onSectionDragStart={(id) => setDragSectionId(id)}
          onSectionDragEnd={() => {
            setDragSectionId(null);
            setOverSectionId(null);
          }}
          onSectionOver={(id) => setOverSectionId(id)}
          onSectionDrop={(targetId) => {
            dropSectionOn(targetId);
            setDragSectionId(null);
            setOverSectionId(null);
          }}
        />
      ) : boardSections.length === 0 ? (
        <EmptyState
          title="Sem seções ainda"
          description="Adicione a primeira para começar a organizar as tarefas."
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {boardSections.map((section) => {
            const isVirtual = !section.id;
            // Órfãs entram na 1ª seção real. Quando não há seções, a coluna
            // virtual "Sem seção" acaba pegando tudo (fallback único).
            const isFirst = section.id !== null && section.id === firstSectionId;
            const list = (
              isVirtual
                ? orphanTasks
                : isFirst
                  ? [
                      ...deptTasks.filter((t) => t.section_id === section.id),
                      ...orphanTasks,
                    ]
                  : deptTasks.filter((t) => t.section_id === section.id)
            )
              // Mesma regra do Quadro do projeto: mais nova em cima.
              .slice()
              .sort((a, b) => b.created_at.localeCompare(a.created_at));

            return (
              <div
                key={section.id || "none"}
                onDragOver={(e) => {
                  // Aceita tanto arraste de tarefa quanto de seção. Sem esse
                  // preventDefault o onDrop nunca dispara.
                  if (!dragTaskId && !dragSectionId) return;
                  e.preventDefault();
                  setOverSectionId(section.id);
                }}
                onDragLeave={() =>
                  setOverSectionId((o) => (o === section.id ? null : o))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragSectionId && section.id) {
                    // Solta seção sobre uma coluna real → reordena.
                    dropSectionOn(section.id);
                  } else if (dragTaskId) {
                    // Uma seção virtual "Sem seção" solta o section_id (vira null).
                    moveTask.mutate({ taskId: dragTaskId, sectionId: section.id || null });
                  }
                  setDragTaskId(null);
                  setDragSectionId(null);
                  setOverSectionId(null);
                }}
                className={cn(
                  "flex w-[290px] shrink-0 flex-col rounded-lg bg-secondary/50 p-2 transition-shadow",
                  overSectionId === section.id && "ring-2 ring-brand/40",
                )}
              >
                <SectionHeader
                  name={section.name}
                  count={list.length}
                  editing={renaming === section.id}
                  draggable={!isVirtual}
                  onDragStart={() => section.id && setDragSectionId(section.id)}
                  onDragEnd={() => {
                    setDragSectionId(null);
                    setOverSectionId(null);
                  }}
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
                      dragging={dragTaskId === t.id}
                      onDragStart={() => setDragTaskId(t.id)}
                      onDragEnd={() => {
                        setDragTaskId(null);
                        setOverSectionId(null);
                      }}
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
  draggable,
  onDragStart,
  onDragEnd,
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
  /** Coluna virtual "Sem seção" nunca é arrastável — sem position no banco. */
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group flex items-center gap-1.5 px-1.5 py-1",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
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
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  task: Task;
  assigneeName: string | undefined;
  assigneeColor: string | undefined;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
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
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/task-id", task.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "w-full cursor-grab space-y-2 rounded-lg border border-border bg-card p-2.5 text-left transition-shadow hover:shadow-[var(--shadow-raised)] focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing",
          dragging && "opacity-50",
        )}
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

/* --------------------------- Visualização: Lista --------------------------- */

/**
 * Lista agrupada por seção — cada bloco é colapsável, com cabeçalho igual ao
 * do quadro. Reusa os mesmos handlers (renomear seção, criar tarefa, abrir
 * tarefa) para não ter dois caminhos de escrita separados.
 */
function ListPanel({
  boardSections,
  deptTasks,
  orphanTasks,
  members,
  renamingSectionId,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onRemoveSection,
  onAddTask,
  onOpenTask,
  dragSectionId,
  overSectionId,
  onSectionDragStart,
  onSectionDragEnd,
  onSectionOver,
  onSectionDrop,
}: {
  boardSections: {
    id: string;
    name: string;
    department_id: string | null;
    project_id: string | null;
    color: string;
    position: number;
  }[];
  deptTasks: Task[];
  orphanTasks: Task[];
  members: { id: string; name: string; avatar_color: string }[];
  renamingSectionId: string | null;
  onRenameStart: (id: string) => void;
  onRenameCommit: (id: string, name: string) => void;
  onRenameCancel: () => void;
  onRemoveSection: (id: string, name: string) => void;
  onAddTask: (sectionId: string | null, title: string) => void;
  onOpenTask: (t: Task) => void;
  /** Estado de reordenação de seção — vem do componente pai para ser
   *  compartilhado com o Quadro (o hover/drop é feito aqui, mas quem
   *  mantém o dragSectionId é o pai). */
  dragSectionId: string | null;
  overSectionId: string | null;
  onSectionDragStart: (id: string) => void;
  onSectionDragEnd: () => void;
  onSectionOver: (id: string) => void;
  onSectionDrop: (targetId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="card-surface divide-y divide-border">
      {boardSections.map((section) => {
        const isVirtual = !section.id;
        // Mesma regra da Board view: órfãs acompanham a 1ª seção real. O id
        // da 1ª é o primeiro elemento não-virtual de boardSections — como
        // "Sem seção" só entra quando não há seções, e nesse caso ela É a
        // primeira, isFirst equivale a "primeira posição do vetor".
        const isFirst = section === boardSections[0] && !isVirtual;
        const list = (
          isVirtual
            ? orphanTasks
            : isFirst
              ? [
                  ...deptTasks.filter((t) => t.section_id === section.id),
                  ...orphanTasks,
                ]
              : deptTasks.filter((t) => t.section_id === section.id)
        )
          .slice()
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const isCollapsed = collapsed[section.id] ?? false;

        return (
          <div
            key={section.id || "none"}
            onDragOver={(e) => {
              // Só aceita o drop de outra seção — dentro da lista não movemos
              // tarefas (a UX é clique-para-abrir); reordenar tarefas fica no
              // Quadro, que é o lugar natural.
              if (!dragSectionId || dragSectionId === section.id || isVirtual) return;
              e.preventDefault();
              onSectionOver(section.id);
            }}
            onDrop={(e) => {
              if (!dragSectionId || isVirtual) return;
              e.preventDefault();
              onSectionDrop(section.id);
            }}
            className={cn(
              "px-3 py-2 transition-colors",
              overSectionId === section.id && !isVirtual && "bg-brand/5",
            )}
          >
            <SectionHeader
              name={section.name}
              count={list.length}
              editing={renamingSectionId === section.id}
              draggable={!isVirtual}
              onDragStart={() => section.id && onSectionDragStart(section.id)}
              onDragEnd={onSectionDragEnd}
              onStartEdit={isVirtual ? undefined : () => onRenameStart(section.id)}
              onCommitName={(name) => onRenameCommit(section.id, name)}
              onCancelEdit={onRenameCancel}
              onAddTask={() =>
                setCollapsed((c) => ({ ...c, [section.id]: false }))
              }
              onRemove={isVirtual ? undefined : () => onRemoveSection(section.id, section.name)}
            />
            <button
              type="button"
              aria-label={isCollapsed ? "Expandir seção" : "Recolher seção"}
              onClick={() =>
                setCollapsed((c) => ({ ...c, [section.id]: !isCollapsed }))
              }
              className="sr-only"
            />
            {!isCollapsed && (
              <div className="mt-1 divide-y divide-border/60">
                {list.length === 0 && (
                  <p className="px-2 py-2 text-xs text-muted-foreground">Nenhuma tarefa nesta seção.</p>
                )}
                {list.map((t) => {
                  const assignee = members.find((m) => m.id === t.assignee_id);
                  const done = t.status === "concluido";
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpenTask(t)}
                      className="flex w-full items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-secondary/50"
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border",
                          done ? "border-success bg-success text-white" : "border-input",
                        )}
                      >
                        {done && <Check className="size-2.5" strokeWidth={3} />}
                      </span>
                      <span className={cn("flex-1 truncate text-sm", done && "text-muted-foreground line-through")}>
                        {t.is_milestone && <Flag className="mr-1 inline size-3.5 text-warning" />}
                        {t.title}
                      </span>
                      <span className="hidden sm:block">
                        <Pill
                          tone={
                            t.priority === "urgente"
                              ? "danger"
                              : t.priority === "alta"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {PRIORITY_LABEL[t.priority as Priority] ?? t.priority}
                        </Pill>
                      </span>
                      <span className="hidden md:block">
                        <StatusBadge status={t.status} />
                      </span>
                      <span className="hidden lg:block w-24 truncate text-xs text-muted-foreground">
                        {t.due_date ? shortDate(t.due_date) : "—"}
                      </span>
                      <Avatar name={assignee?.name} color={assignee?.avatar_color} size="xs" />
                    </button>
                  );
                })}
                <div className="pt-1">
                  <ListQuickAdd onAdd={(title) => onAddTask(section.id || null, title)} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Linha "+ Adicionar tarefa" para o modo Lista. */
function ListQuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
      >
        <Plus className="size-4" /> Adicionar tarefa
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
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
            setValue("");
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (value.trim().length >= 2) onAdd(value.trim());
          setValue("");
          setEditing(false);
        }}
        className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm focus:border-ring focus:outline-none"
      />
    </div>
  );
}
