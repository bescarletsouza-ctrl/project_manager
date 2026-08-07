import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Columns3, Flag, List, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { AutomationsPanel } from "@/components/AutomationsPanel";
import { EmptyState, Pill, RowMenu, StatusBadge } from "@/components/ui-bits";
import { TaskPane } from "@/components/TaskPane";
import { NewTaskDialog } from "@/components/dialogs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SlidersHorizontal } from "lucide-react";
import {
  createSection,
  createTaskLinked,
  deleteSection,
  updateSection,
  type Automation,
} from "@/lib/asana";
import { deleteDepartment, deleteTask, updateDepartment, updateTask } from "@/lib/data";
import { useWorkspaceData } from "@/lib/useData";
import { useAsanaData, useCurrentMember } from "@/lib/useAsana";
import { applyAutomationMoves, runAutomations } from "@/lib/automations";
import { PRIORITIES, PRIORITY_LABEL, isLate, type Member, type Priority, type Task } from "@/lib/domain";
import { dotClass } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { AssigneePicker, InlineSelect, InlineText } from "@/components/project/ProjectViews";

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

/**
 * Colunas configuráveis: quem controla o que rende no card do Quadro e
 * na linha da Lista. Departamento não tem visible_columns no banco (é
 * preferência de visualização, não de conteúdo), então salvamos em
 * localStorage por departamento, com todas visíveis por padrão.
 */
const COLUMN_KEYS = ["projeto", "prazo", "prioridade", "status", "sprint", "etiquetas", "responsavel"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABEL: Record<ColumnKey, string> = {
  projeto: "Projeto",
  prazo: "Prazo",
  prioridade: "Prioridade",
  status: "Status",
  sprint: "Sprint",
  etiquetas: "Etiquetas",
  responsavel: "Responsável",
};
type ColumnPrefs = Record<ColumnKey, boolean>;

function useDeptColumnPrefs(departmentId: string): [ColumnPrefs, (key: ColumnKey, on: boolean) => void] {
  const storageKey = `fluxo:dept-cols:${departmentId}`;
  const defaults: ColumnPrefs = COLUMN_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: true }),
    {} as ColumnPrefs,
  );
  const [prefs, setPrefs] = useState<ColumnPrefs>(defaults);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ColumnPrefs>;
        setPrefs({ ...defaults, ...parsed });
      } else {
        setPrefs(defaults);
      }
    } catch {
      setPrefs(defaults);
    }
    setLoaded(true);
    // defaults é derivado de COLUMN_KEYS (constante), não muda entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const update = (key: ColumnKey, on: boolean) => {
    setPrefs((p) => {
      const next = { ...p, [key]: on };
      if (loaded) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* modo privado ou cota: só afeta esta sessão */
        }
      }
      return next;
    });
  };

  return [prefs, update];
}

function DepartmentDetail() {
  const { departmentId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { departments, members, projects, tasks, isLoading } = useWorkspaceData();
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
  /**
   * automations aqui é a lista COMPLETA do workspace — o runAutomations
   * filtra por container internamente. Isso importa porque uma tarefa
   * aberta no TaskPane do departamento pode ter project_id também, e as
   * regras do projeto correspondente devem disparar junto. deptAutomations
   * (só do dept) é usada em quickAddTask e no TaskCard toggle, onde só
   * queremos aplicar regras deste departamento.
   */
  const automations = allAutomations;
  const { member: currentMember, userId } = useCurrentMember();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editHeader, setEditHeader] = useState(false);
  const [view, setView] = useState<"board" | "list" | "auto">("board");
  const [columnPrefs, setColumnPref] = useDeptColumnPrefs(departmentId);
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
    mutationFn: async (input: { taskId: string; sectionId: string | null }) => {
      const task = tasks.find((t) => t.id === input.taskId);
      if (!task || task.section_id === input.sectionId) {
        await updateTask(input.taskId, { section_id: input.sectionId });
        return;
      }
      const container = { projectId: task.project_id, departmentId: task.department_id ?? departmentId };
      const { patch, applied, moves } = runAutomations(
        automations,
        "section_changed",
        { ...task, section_id: input.sectionId },
        container,
      );
      if (applied.length) toast.info(`Automação aplicada: ${applied.join(", ")}`);
      await updateTask(input.taskId, { section_id: input.sectionId, ...patch });
      await applyAutomationMoves(input.taskId, container, moves);
    },
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
   * TaskPane precisa receber o objeto FRESCO do cache — se receber o
   * snapshot capturado em setOpenTask, alterações que a própria pane
   * dispara (status, prazo, seção…) só refletem quando o painel fecha
   * e reabre. Mesma técnica do detalhe de projeto: openTask serve só
   * de âncora de identidade; live é a versão viva.
   */
  const live = openTask ? (tasks.find((t) => t.id === openTask.id) ?? null) : null;
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
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground"
                title="Ajustar colunas do departamento"
              >
                <SlidersHorizontal className="size-3.5" /> Colunas
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Mostrar nesta visualização
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMN_KEYS.map((k) => (
                <DropdownMenuCheckboxItem
                  key={k}
                  checked={columnPrefs[k]}
                  onCheckedChange={(v) => setColumnPref(k, Boolean(v))}
                  onSelect={(e) => e.preventDefault()}
                >
                  {COLUMN_LABEL[k]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
      </div>

      {view === "auto" ? (
        <AutomationsPanel
          container={{ kind: "department", departmentId }}
          automations={deptAutomations}
          members={members}
          sections={sections.map((s) => ({ id: s.id, name: s.name }))}
          projects={[]}
          // Custom fields no departamento ainda dependem de migração (a
          // tabela custom_fields hoje só tem project_id). Departamento
          // não usa field_changed/set_field por enquanto.
          fields={[]}
        />
      ) : view === "list" ? (
        <ListPanel
          boardSections={boardSections}
          deptTasks={deptTasks}
          orphanTasks={orphanTasks}
          members={members}
          projects={projects}
          columnPrefs={columnPrefs}
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
          automations={automations}
          departmentId={departmentId}
          dragTaskId={dragTaskId}
          onTaskDragStart={(id) => setDragTaskId(id)}
          onTaskDragEnd={() => {
            setDragTaskId(null);
            setOverSectionId(null);
          }}
          onTaskDrop={(sectionId) => {
            if (dragTaskId) moveTask.mutate({ taskId: dragTaskId, sectionId });
            setDragTaskId(null);
            setOverSectionId(null);
          }}
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
                      members={members}
                      projectName={projects.find((p) => p.id === t.project_id)?.name}
                      projectColor={projects.find((p) => p.id === t.project_id)?.color}
                      dragging={dragTaskId === t.id}
                      onDragStart={() => setDragTaskId(t.id)}
                      onDragEnd={() => {
                        setDragTaskId(null);
                        setOverSectionId(null);
                      }}
                      onOpen={() => setOpenTask(t)}
                      automations={automations}
                      departmentId={departmentId}
                      columnPrefs={columnPrefs}
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

      {live && (
        <TaskPane
          task={live}
          tasks={tasks}
          members={members}
          sections={allSections}
          fields={fields}
          fieldValues={fieldValues}
          comments={comments}
          dependencies={dependencies}
          projects={projects}
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
  members,
  projectName,
  projectColor,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  automations,
  departmentId,
  columnPrefs,
}: {
  task: Task;
  members: Member[];
  projectName: string | undefined;
  projectColor: string | undefined;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  columnPrefs: ColumnPrefs;
  /**
   * Automações do container atual — o toggle "concluir" precisa rodá-las,
   * senão uma regra tipo "quando status = concluido → mover para
   * Concluído" nunca dispara ao clicar direto no card (funcionaria só via
   * TaskPane, que era o único caminho que já rodava).
   */
  automations: Automation[];
  departmentId: string;
}) {
  const qc = useQueryClient();
  /** Edição direta dos campos da coluna — mesmo padrão do TaskCells do projeto: grava sem passar pelas automações (só status/assignee do toggle rodam automação). */
  const fieldPatch = useMutation({
    mutationFn: (patch: Partial<Task>) => updateTask(task.id, patch),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível salvar."),
  });
  const toggle = useMutation({
    mutationFn: async () => {
      const nextStatus = task.status === "concluido" ? "em_andamento" : "concluido";
      const { patch, applied, moves } = runAutomations(
        automations,
        "status_changed",
        { ...task, status: nextStatus as Task["status"] },
        { projectId: task.project_id, departmentId: task.department_id ?? departmentId },
      );
      if (applied.length) toast.info(`Automação aplicada: ${applied.join(", ")}`);
      await updateTask(task.id, {
        status: nextStatus,
        completed: nextStatus === "concluido",
        ...patch,
      });
      await applyAutomationMoves(
        task.id,
        { projectId: task.project_id, departmentId: task.department_id ?? departmentId },
        moves,
      );
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível atualizar."),
  });
  const [editingTitle, setEditingTitle] = useState(false);
  const rename = useMutation({
    mutationFn: (title: string) => updateTask(task.id, { title }),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível renomear."),
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
        onClick={() => !editingTitle && onOpen()}
        onKeyDown={(e) => {
          if (editingTitle) return;
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
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={task.title}
              maxLength={140}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v.length >= 2 && v !== task.title) rename.mutate(v);
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="flex-1 rounded-md border border-ring bg-background px-1.5 py-0.5 text-sm focus:outline-none"
            />
          ) : (
            <span
              className={cn(
                "flex-1 pr-5 text-sm leading-snug",
                done && "text-muted-foreground line-through",
              )}
            >
              {task.is_milestone && <Flag className="mr-1 inline size-3.5 text-warning" />}
              {task.title}
            </span>
          )}
        </div>
        {/*
          Todas as pills que a tarefa ativou aparecem — mesmo padrão do
          Quadro do projeto, mas sem depender de visible_columns (o
          departamento não tem essa preferência). Cada campo só rende se
          tem valor; assim o card fica enxuto quando poucos campos estão
          preenchidos. Projeto vinculado ganha um pill próprio para o
          usuário ver de onde a demanda veio sem precisar abrir.
        */}
        <div className="flex flex-wrap items-center gap-1">
          {columnPrefs.projeto && projectName && (
            <Pill tone="brand">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  projectColor ? dotClass(projectColor) : "bg-current",
                )}
              />
              {projectName}
            </Pill>
          )}
          {columnPrefs.prazo && (
            <InlineText
              label="Prazo"
              type="date"
              value={task.due_date ?? ""}
              onCommit={(v) => fieldPatch.mutate({ due_date: v || null })}
              className={cn("w-[118px] text-xs", isLate(task) && "text-destructive")}
            />
          )}
          {columnPrefs.prioridade && (
            <InlineSelect
              label="Prioridade"
              value={task.priority}
              onChange={(v) => fieldPatch.mutate({ priority: v as Priority })}
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
              className="text-xs"
            />
          )}
          {columnPrefs.status && <StatusBadge status={task.status} />}
          {columnPrefs.sprint && (
            <InlineText
              label="Sprint"
              value={task.sprint ?? ""}
              placeholder="sprint"
              onCommit={(v) => fieldPatch.mutate({ sprint: v || null })}
              className="w-20 text-xs"
            />
          )}
          {columnPrefs.etiquetas && (
            <InlineText
              label="Etiquetas"
              value={(task.tags ?? []).join(", ")}
              placeholder="etiquetas"
              onCommit={(v) =>
                fieldPatch.mutate({
                  tags: v
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              className="w-28 text-xs"
            />
          )}
          {columnPrefs.responsavel && (
            <span className="ml-auto">
              <AssigneePicker
                members={members}
                value={task.assignee_id}
                onChange={(id) => fieldPatch.mutate({ assignee_id: id })}
              />
            </span>
          )}
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
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={onOpen} className="gap-2 text-sm">
          <Pencil className="size-4" /> Editar (abrir)
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => requestAnimationFrame(() => setEditingTitle(true))}
          className="gap-2 text-sm"
        >
          <Pencil className="size-4" /> Renomear
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => confirm(`Excluir "${task.title}"?`) && remove.mutate()}
          className="gap-2 text-sm text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4" /> Excluir
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  projects,
  columnPrefs,
  renamingSectionId,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onRemoveSection,
  onAddTask,
  onOpenTask,
  automations,
  departmentId,
  dragTaskId,
  onTaskDragStart,
  onTaskDragEnd,
  onTaskDrop,
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
  members: Member[];
  /** Só o suficiente para exibir o pill do projeto de cada tarefa. */
  projects: { id: string; name: string; color: string }[];
  columnPrefs: ColumnPrefs;
  renamingSectionId: string | null;
  onRenameStart: (id: string) => void;
  onRenameCommit: (id: string, name: string) => void;
  onRenameCancel: () => void;
  onRemoveSection: (id: string, name: string) => void;
  onAddTask: (sectionId: string | null, title: string) => void;
  onOpenTask: (t: Task) => void;
  /** Automações + dept p/ o toggle "concluir" rodar as regras — mesma
   *  máquina do card do Quadro, reusada aqui. */
  automations: Automation[];
  departmentId: string;
  /** Drag de tarefa entre blocos da Lista (equivalente ao do Quadro). */
  dragTaskId: string | null;
  onTaskDragStart: (id: string) => void;
  onTaskDragEnd: () => void;
  onTaskDrop: (sectionId: string | null) => void;
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
              // Aceita drop de seção (reordenar coluna) OU de tarefa (mover
              // card entre blocos). Seção virtual "Sem seção" nunca aceita
              // drop de seção — não tem position no banco.
              if (dragSectionId && dragSectionId !== section.id && !isVirtual) {
                e.preventDefault();
                onSectionOver(section.id);
                return;
              }
              if (dragTaskId) {
                e.preventDefault();
                onSectionOver(section.id);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragSectionId && !isVirtual) {
                onSectionDrop(section.id);
              } else if (dragTaskId) {
                onTaskDrop(section.id || null);
              }
            }}
            className={cn(
              "px-3 py-2 transition-colors",
              overSectionId === section.id && "bg-brand/5",
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
                {list.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    members={members}
                    project={projects.find((p) => p.id === t.project_id)}
                    automations={automations}
                    departmentId={departmentId}
                    dragging={dragTaskId === t.id}
                    onDragStart={() => onTaskDragStart(t.id)}
                    onDragEnd={onTaskDragEnd}
                    onOpen={() => onOpenTask(t)}
                    columnPrefs={columnPrefs}
                  />
                ))}
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

/**
 * Linha da Lista com toggle na bolinha, drag, edição inline de título
 * e menu de contexto (Renomear, Editar, Excluir). Um <div> — não um
 * <button> — porque tem botões aninhados (toggle) e HTML inválido
 * quebra hidratação. Clique geral abre o TaskPane; clique na bolinha
 * marca/desmarca concluída direto e roda as automações do container.
 */
function TaskRow({
  task,
  members,
  project,
  automations,
  departmentId,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  columnPrefs,
}: {
  task: Task;
  members: Member[];
  project: { id: string; name: string; color: string } | undefined;
  automations: Automation[];
  departmentId: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  columnPrefs: ColumnPrefs;
}) {
  const qc = useQueryClient();
  const [editingTitle, setEditingTitle] = useState(false);
  const done = task.status === "concluido";

  /** Edição direta dos campos da coluna — mesmo padrão do TaskCells do projeto. */
  const fieldPatch = useMutation({
    mutationFn: (patch: Partial<Task>) => updateTask(task.id, patch),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível salvar."),
  });

  const toggle = useMutation({
    mutationFn: async () => {
      const nextStatus = done ? "em_andamento" : "concluido";
      const { patch, applied, moves } = runAutomations(
        automations,
        "status_changed",
        { ...task, status: nextStatus as Task["status"] },
        { projectId: task.project_id, departmentId: task.department_id ?? departmentId },
      );
      if (applied.length) toast.info(`Automação aplicada: ${applied.join(", ")}`);
      await updateTask(task.id, {
        status: nextStatus,
        completed: nextStatus === "concluido",
        ...patch,
      });
      await applyAutomationMoves(
        task.id,
        { projectId: task.project_id, departmentId: task.department_id ?? departmentId },
        moves,
      );
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível atualizar."),
  });

  const rename = useMutation({
    mutationFn: (title: string) => updateTask(task.id, { title }),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível renomear."),
  });

  const remove = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Tarefa excluída.");
    },
    onError: () => toast.error("Não foi possível excluir."),
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/task-id", task.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onClick={() => !editingTitle && onOpen()}
          onKeyDown={(e) => {
            if (editingTitle) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen();
            }
          }}
          className={cn(
            "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-left transition-colors hover:bg-secondary/50",
            "cursor-grab active:cursor-grabbing",
            dragging && "opacity-50",
          )}
        >
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
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={task.title}
              maxLength={140}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v.length >= 2 && v !== task.title) rename.mutate(v);
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="min-w-0 flex-1 rounded-md border border-ring bg-background px-1.5 py-0.5 text-sm focus:outline-none"
            />
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                done && "text-muted-foreground line-through",
              )}
            >
              {task.is_milestone && <Flag className="mr-1 inline size-3.5 text-warning" />}
              {task.title}
            </span>
          )}
          {columnPrefs.projeto && project && (
            <Pill tone="brand">
              <span className={cn("size-1.5 rounded-full", dotClass(project.color))} />
              {project.name}
            </Pill>
          )}
          {columnPrefs.prioridade && (
            <InlineSelect
              label="Prioridade"
              value={task.priority}
              onChange={(v) => fieldPatch.mutate({ priority: v as Priority })}
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
              className="text-xs"
            />
          )}
          {columnPrefs.status && <StatusBadge status={task.status} />}
          {columnPrefs.sprint && (
            <InlineText
              label="Sprint"
              value={task.sprint ?? ""}
              placeholder="sprint"
              onCommit={(v) => fieldPatch.mutate({ sprint: v || null })}
              className="w-20 text-xs"
            />
          )}
          {columnPrefs.etiquetas && (
            <InlineText
              label="Etiquetas"
              value={(task.tags ?? []).join(", ")}
              placeholder="etiquetas"
              onCommit={(v) =>
                fieldPatch.mutate({
                  tags: v
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              className="w-28 text-xs"
            />
          )}
          {columnPrefs.prazo && (
            <InlineText
              label="Prazo"
              type="date"
              value={task.due_date ?? ""}
              onCommit={(v) => fieldPatch.mutate({ due_date: v || null })}
              className={cn("w-[118px] text-right text-xs", isLate(task) && "text-destructive")}
            />
          )}
          {columnPrefs.responsavel && (
            <AssigneePicker
              members={members}
              value={task.assignee_id}
              onChange={(id) => fieldPatch.mutate({ assignee_id: id })}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={onOpen} className="gap-2 text-sm">
          <Pencil className="size-4" /> Editar (abrir)
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            // A ContextMenu do radix fecha ao selecionar o item; damos um
            // frame para o menu fechar antes de trocar o span pelo input.
            requestAnimationFrame(() => setEditingTitle(true));
          }}
          className="gap-2 text-sm"
        >
          <Pencil className="size-4" /> Renomear
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => confirm(`Excluir "${task.title}"?`) && remove.mutate()}
          className="gap-2 text-sm text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4" /> Excluir
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
