import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, Pill, RowMenu } from "@/components/ui-bits";
import { deleteTask, updateTask } from "@/lib/data";
import {
  createSection,
  createTaskLinked,
  deleteSection,
  setFieldValue,
  setTaskProjectSection,
  updateSection,
  type Automation,
  type CustomField,
  type Section,
  type TaskFieldValue,
} from "@/lib/asana";
import { applyAutomationMoves, runAutomations } from "@/lib/automations";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_META,
  STATUS_ORDER,
  TASK_TYPES,
  TASK_TYPE_LABEL,
  isLate,
  type Member,
  type Priority,
  type Project,
  type Task,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

export type ViewProps = {
  projectId: string;
  project: Project;
  sections: Section[];
  tasks: Task[];
  members: Member[];
  fields: CustomField[];
  fieldValues: TaskFieldValue[];
  automations: Automation[];
  sectionOf: (task: Task) => string;
  onOpenTask: (task: Task) => void;
};

/* ------------------------- utilidades ------------------------- */

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function toISO(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "12 de mar" — data curta, sem ruído. */
function shortDate(date?: string | null) {
  if (!date) return "—";
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/** Botão de excluir tarefa (com confirmação). */
export function DeleteTaskButton({ task, className }: { task: Task; className?: string }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Tarefa excluída.");
    },
    onError: (e: unknown) =>
      toast.error(`Não foi possível excluir: ${(e as { message?: string })?.message ?? "erro"}`),
  });

  return (
    <button
      type="button"
      title="Excluir tarefa"
      aria-label={`Excluir tarefa ${task.title}`}
      disabled={remove.isPending}
      onClick={(e) => {
        e.stopPropagation();
        if (confirm(`Excluir a tarefa "${task.title}"?`)) remove.mutate();
      }}
      className={cn(
        "shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

export function useSectionMutations(projectId: string, project: Project, automations: Automation[]) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries();

  const addSection = useMutation({
    mutationFn: (name: string) => createSection({ project_id: projectId, name, position: 999 }),
    onSuccess: () => {
      invalidate();
      toast.success("Seção criada.");
    },
    onError: () => toast.error("Não foi possível criar a seção."),
  });

  const renameSection = useMutation({
    mutationFn: (input: { id: string; name: string }) => updateSection(input.id, { name: input.name }),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível renomear a seção."),
  });

  const removeSection = useMutation({
    mutationFn: (id: string) => deleteSection(id),
    onSuccess: () => {
      invalidate();
      toast.success("Seção removida.");
    },
    onError: () => toast.error("Não foi possível remover a seção."),
  });

  const addTask = useMutation({
    mutationFn: async (input: { title: string; sectionId: string | null; dueDate?: string | null }) => {
      const base: Record<string, unknown> = {
        title: input.title,
        project_id: projectId,
        section_id: input.sectionId,
        status: "a_fazer",
        assignee_id: project.default_assignee_id ?? null,
        due_date:
          input.dueDate ?? (project.default_due_days ? addDays(project.default_due_days) : null),
      };
      const { patch, applied, moves } = runAutomations(automations, "task_created", base as Partial<Task>, projectId);
      if (applied.length) toast.info(`Automação aplicada: ${applied.join(", ")}`);
      const newId = await createTaskLinked({ ...base, ...patch }, [projectId]);
      if (newId) await applyAutomationMoves(newId, projectId, moves);
      return newId;
    },
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível criar a tarefa."),
  });

  const moveTask = useMutation({
    mutationFn: (input: { taskId: string; sectionId: string }) =>
      setTaskProjectSection(input.taskId, projectId, input.sectionId),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível mover a tarefa."),
  });

  /** Reordena tarefas dentro de uma seção (e move entre seções quando preciso). */
  const reorderTasks = useMutation({
    mutationFn: async (input: { ids: string[]; sectionId: string; movedId?: string }) => {
      if (input.movedId) await setTaskProjectSection(input.movedId, projectId, input.sectionId);
      await Promise.all(input.ids.map((id, i) => updateTask(id, { position: i })));
    },
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível reordenar as tarefas."),
  });

  /** Reordena seções do projeto. */
  const reorderSections = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id, i) => updateSection(id, { position: i }))),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível reordenar as seções."),
  });

  return { addSection, renameSection, removeSection, addTask, moveTask, reorderTasks, reorderSections };
}

type TaskDrag = { taskId: string; sectionId: string };

/** Estado de arraste compartilhado entre lista e quadro. */
function useDnd({
  sections,
  reorderSections,
  reorderTasks,
}: {
  sections: Section[];
  reorderSections: (ids: string[]) => void;
  reorderTasks: (input: { ids: string[]; sectionId: string; movedId?: string }) => void;
}) {
  const [dragTask, setDragTask] = useState<TaskDrag | null>(null);
  const [dragSection, setDragSection] = useState<string | null>(null);
  const [overSection, setOverSection] = useState<string | null>(null);

  const dropOnSection = (targetId: string, listIds: string[]) => {
    if (dragSection) {
      const ids = sections.map((s) => s.id).filter((id) => id !== dragSection);
      const at = sections.findIndex((s) => s.id === targetId);
      ids.splice(at < 0 ? ids.length : at, 0, dragSection);
      reorderSections(ids);
    } else if (dragTask) {
      const ids = listIds.filter((id) => id !== dragTask.taskId).concat(dragTask.taskId);
      reorderTasks({ ids, sectionId: targetId, movedId: dragTask.taskId });
    }
    setDragTask(null);
    setDragSection(null);
    setOverSection(null);
  };

  const dropOnTask = (targetTaskId: string, sectionId: string, listIds: string[]) => {
    if (!dragTask || dragTask.taskId === targetTaskId) return;
    const ids = listIds.filter((id) => id !== dragTask.taskId);
    const at = ids.indexOf(targetTaskId);
    ids.splice(at < 0 ? ids.length : at, 0, dragTask.taskId);
    reorderTasks({ ids, sectionId, movedId: dragTask.taskId });
    setDragTask(null);
    setOverSection(null);
  };

  return { dragTask, setDragTask, dragSection, setDragSection, overSection, setOverSection, dropOnSection, dropOnTask };
}

/* ------------------------- peças da linha ------------------------- */

function TaskToggle({
  task,
  automations,
  size = "md",
}: {
  task: Task;
  automations: Automation[];
  size?: "sm" | "md";
}) {
  const qc = useQueryClient();
  const done = task.status === "concluido";
  const toggle = useMutation({
    mutationFn: async () => {
      const status = done ? "em_andamento" : "concluido";
      const { patch, moves } = runAutomations(
        automations,
        "status_changed",
        { ...task, status: status as Task["status"] },
        task.project_id,
      );
      const res = await updateTask(task.id, { status, completed: !done, ...patch });
      await applyAutomationMoves(task.id, task.project_id, moves);
      return res;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível atualizar."),
  });

  return (
    <button
      type="button"
      aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
      title={done ? "Reabrir tarefa" : "Marcar como concluída"}
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate();
      }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border transition-colors",
        size === "sm" ? "size-4" : "size-[18px]",
        done
          ? "border-success bg-success text-white"
          : "border-input text-transparent hover:border-success hover:text-success",
      )}
    >
      <Check className={size === "sm" ? "size-2.5" : "size-3"} strokeWidth={3} />
    </button>
  );
}

/** Linha fantasma "+ Adicionar tarefa" que vira campo — Enter cria e continua aberta. */
function AddTaskRow({
  onAdd,
  placeholder = "Adicionar tarefa",
  className,
  indent = false,
}: {
  onAdd: (title: string) => void;
  placeholder?: string;
  className?: string;
  indent?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground",
          indent && "pl-10",
          className,
        )}
      >
        <Plus className="size-4" /> {placeholder}
      </button>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5", indent && "pl-10", className)}>
      <span className="size-[18px] shrink-0 rounded-full border border-dashed border-input" />
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

/** Campo de texto simples usado para criar seções. */
function AddInline({ onAdd, placeholder }: { onAdd: (v: string) => void; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="btn btn-ghost px-3">
        <Plus className="size-4" /> {placeholder}
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
      className="flex max-w-sm gap-2"
    >
      <input
        autoFocus
        value={value}
        maxLength={80}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim().length >= 2) onAdd(value.trim());
          setValue("");
          setEditing(false);
        }}
        className="field flex-1"
      />
      <button className="btn btn-outline px-2.5">
        <Plus className="size-4" />
      </button>
    </form>
  );
}

/**
 * Ordem, rótulo, largura padrão e a partir de qual breakpoint a coluna aparece.
 * A largura é só o ponto de partida — o usuário arrasta a borda para ajustar.
 */
const COLUMN_DEFS = [
  { id: "tags", label: "Etiquetas", bp: "lg", width: 128 },
  { id: "sprint", label: "Sprint", bp: "lg", width: 96 },
  { id: "task_type", label: "Tipo", bp: "lg", width: 96 },
  { id: "priority", label: "Prioridade", bp: "sm", width: 96 },
  { id: "start_date", label: "Início", bp: "md", width: 116 },
  { id: "due_date", label: "Data de fim", bp: "none", width: 116 },
  { id: "status", label: "Status", bp: "sm", width: 132 },
  { id: "assignee", label: "Responsável", bp: "none", width: 92 },
] as const;

/** Classes literais (o Tailwind precisa vê-las no fonte para gerá-las). */
const SHOW: Record<string, string> = {
  none: "flex",
  sm: "hidden sm:flex",
  md: "hidden md:flex",
  lg: "hidden lg:flex",
};

const CUSTOM_FIELD_WIDTH = 116;
const MIN_COLUMN_WIDTH = 64;
const MAX_COLUMN_WIDTH = 480;

const defaultWidth = (id: string) =>
  COLUMN_DEFS.find((c) => c.id === id)?.width ?? CUSTOM_FIELD_WIDTH;

/**
 * Larguras de coluna por projeto. Ficam no localStorage: é preferência de
 * visualização de quem está olhando, não dado do projeto — e evita migração
 * de schema só para guardar pixel.
 */
function useColumnWidths(projectId: string) {
  const storageKey = `fluxo:col-widths:${projectId}`;
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    try {
      const saved = localStorage.getItem(storageKey);
      setWidths(saved ? (JSON.parse(saved) as Record<string, number>) : {});
    } catch {
      setWidths({});
    }
    setLoaded(true);
  }, [storageKey]);

  // Grava depois que o arraste sossega — durante o arraste seriam dezenas de
  // escritas por segundo. O `loaded` evita salvar {} por cima do que existe.
  useEffect(() => {
    if (!loaded) return undefined;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(widths));
      } catch {
        /* modo privado ou cota cheia: a sessão continua, só não persiste */
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [widths, loaded, storageKey]);

  const widthOf = (id: string) => widths[id] ?? defaultWidth(id);

  const setWidth = (id: string, value: number) =>
    setWidths((prev) => ({
      ...prev,
      [id]: Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, value))),
    }));

  /** Duplo clique na alça devolve a coluna ao tamanho padrão. */
  const resetWidth = (id: string) =>
    setWidths((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  return { widthOf, setWidth, resetWidth };
}

type ColumnWidths = ReturnType<typeof useColumnWidths>;

/** Alça de 6px na borda direita da coluna. */
function ResizeHandle({
  onResize,
  onReset,
  label,
}: {
  onResize: (deltaX: number) => void;
  onReset: () => void;
  label: string;
}) {
  const [active, setActive] = useState(false);

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Redimensionar coluna ${label}`}
      title="Arraste para redimensionar · duplo clique para restaurar"
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        setActive(true);

        const move = (ev: PointerEvent) => onResize(ev.clientX - startX);
        const up = () => {
          setActive(false);
          target.releasePointerCapture(e.pointerId);
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", up);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
      }}
      className={cn(
        "absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none",
        "after:absolute after:top-1 after:bottom-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors",
        active ? "after:bg-brand" : "after:bg-transparent hover:after:bg-input",
      )}
    />
  );
}

type SortKey = (typeof COLUMN_DEFS)[number]["id"] | "title";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

const PRIORITIES_ORDER: Priority[] = ["urgente", "alta", "media", "baixa"];

function sortValue(task: Task, key: SortKey, members: Member[]): string {
  switch (key) {
    case "title":
      return task.title.toLowerCase();
    case "tags":
      return (task.tags ?? []).join(", ").toLowerCase();
    case "sprint":
      return (task.sprint ?? "").toLowerCase();
    case "task_type":
      return (task.task_type ?? "").toLowerCase();
    case "priority":
      return String(PRIORITIES_ORDER.indexOf(task.priority as Priority)).padStart(2, "0");
    case "start_date":
      return task.start_date ?? "9999-12-31";
    case "due_date":
      return task.due_date ?? "9999-12-31";
    case "status":
      return String(STATUS_ORDER.indexOf(task.status)).padStart(2, "0");
    case "assignee":
      return (members.find((m) => m.id === task.assignee_id)?.name ?? "zzz").toLowerCase();
    default:
      return "";
  }
}

/** Cabeçalho com nomes das colunas, ordenação e alças de redimensionamento. */
function TaskHeader({
  columns,
  fields,
  sort,
  onSort,
  cols,
}: {
  columns: string[];
  fields: CustomField[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  cols: ColumnWidths;
}) {
  const arrow = (key: SortKey) =>
    sort?.key === key ? (
      sort.dir === "asc" ? (
        <ArrowUp className="size-3" />
      ) : (
        <ArrowDown className="size-3" />
      )
    ) : (
      <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-50" />
    );

  const labelCls = "truncate text-left text-[11px] font-medium tracking-wide uppercase";

  /** Coluna de largura fixa: rótulo (ordenável ou não) + alça na borda direita. */
  const column = (id: string, label: string, bp: string, sortKey?: SortKey) => {
    const start = cols.widthOf(id);
    return (
      <div
        key={id}
        style={{ width: start }}
        className={cn("relative shrink-0 items-center", SHOW[bp] ?? SHOW["none"])}
      >
        {sortKey ? (
          <button
            type="button"
            onClick={() => onSort(sortKey)}
            className={cn(
              "group flex min-w-0 flex-1 items-center gap-1",
              labelCls,
              sort?.key === sortKey ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="truncate">{label}</span>
            {arrow(sortKey)}
          </button>
        ) : (
          <span className={cn("min-w-0 flex-1 text-muted-foreground", labelCls)}>{label}</span>
        )}
        <ResizeHandle
          label={label}
          onReset={() => cols.resetWidth(id)}
          onResize={(deltaX) => cols.setWidth(id, start + deltaX)}
        />
      </div>
    );
  };

  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background px-3 py-2">
      <span className="w-4 shrink-0" />
      <span className="size-[18px] shrink-0" />
      <button
        type="button"
        onClick={() => onSort("title")}
        className={cn(
          "group flex min-w-0 flex-1 items-center gap-1",
          labelCls,
          sort?.key === "title" ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="truncate">Nome da tarefa</span>
        {arrow("title")}
      </button>
      {fields.map((f) => column(`cf:${f.id}`, f.name, "none"))}
      {COLUMN_DEFS.filter((c) => columns.includes(c.id)).map((c) => column(c.id, c.label, c.bp, c.id))}
      <span className="size-6 shrink-0" />
    </div>
  );
}

/* ---------- edição inline das colunas (fora da tarefa) ---------- */

function useTaskPatch(task: Task) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Task>) => updateTask(task.id, patch),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: unknown) =>
      toast.error(`Não foi possível salvar: ${(e as { message?: string })?.message ?? "erro"}`),
  });
}

function InlineSelect({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className={cn("field-inline truncate", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function InlineText({
  value,
  onCommit,
  label,
  type = "text",
  placeholder = "—",
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  type?: "text" | "date" | "number";
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      aria-label={label}
      type={type}
      value={draft}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      className={cn("field-inline", className)}
    />
  );
}

/** Célula de campo personalizado editável. */
export function CustomFieldCell({
  taskId,
  field,
  value,
}: {
  taskId: string;
  field: CustomField;
  value: string;
}) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (v: string) => setFieldValue(taskId, field.id, v === "" ? null : v),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível salvar o campo."),
  });

  const options = (field.options ?? []) as string[];
  if (field.field_type === "select" && options.length > 0) {
    return (
      <InlineSelect
        label={field.name}
        value={value}
        onChange={(v) => save.mutate(v)}
        options={[{ value: "", label: "—" }, ...options.map((o) => ({ value: o, label: o }))]}
      />
    );
  }
  const type = field.field_type === "date" ? "date" : field.field_type === "number" ? "number" : "text";
  return <InlineText label={field.name} value={value} type={type} onCommit={(v) => save.mutate(v)} />;
}

/** Células de coluna configuráveis da lista — todas editáveis fora da tarefa. */
function TaskCells({
  task,
  columns,
  members,
  cols,
}: {
  task: Task;
  columns: string[];
  members: Member[];
  cols: ColumnWidths;
}) {
  const patch = useTaskPatch(task);
  const has = (id: string) => columns.includes(id);
  const assignee = members.find((m) => m.id === task.assignee_id);

  /** Mesma largura e mesmo breakpoint do cabeçalho, senão as colunas desalinham. */
  const cell = (id: string, bp: string, children: React.ReactNode, className?: string) => (
    <span
      style={{ width: cols.widthOf(id) }}
      className={cn("shrink-0 items-center gap-1", SHOW[bp] ?? SHOW["none"], className)}
    >
      {children}
    </span>
  );

  return (
    <>
      {has("tags") &&
        cell(
          "tags",
          "lg",
          <InlineText
            label="Etiquetas"
            value={(task.tags ?? []).join(", ")}
            placeholder="etiquetas"
            onCommit={(v) =>
              patch.mutate({
                tags: v
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          />,
        )}
      {has("sprint") &&
        cell(
          "sprint",
          "lg",
          <InlineText label="Sprint" value={task.sprint ?? ""} onCommit={(v) => patch.mutate({ sprint: v || null })} />,
        )}
      {has("task_type") &&
        cell(
          "task_type",
          "lg",
          <InlineSelect
            label="Tipo"
            value={task.task_type ?? ""}
            onChange={(v) => patch.mutate({ task_type: v })}
            options={TASK_TYPES.map((t) => ({ value: t, label: TASK_TYPE_LABEL[t] ?? t }))}
          />,
        )}
      {has("priority") &&
        cell(
          "priority",
          "sm",
          <InlineSelect
            label="Prioridade"
            value={task.priority}
            onChange={(v) => patch.mutate({ priority: v as Priority })}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          />,
        )}
      {has("start_date") &&
        cell(
          "start_date",
          "md",
          <InlineText
            label="Início"
            type="date"
            value={task.start_date ?? ""}
            onCommit={(v) => patch.mutate({ start_date: v || null })}
          />,
        )}
      {has("due_date") &&
        cell(
          "due_date",
          "none",
          <InlineText
            label="Data de fim"
            type="date"
            value={task.due_date ?? ""}
            onCommit={(v) => patch.mutate({ due_date: v || null })}
          />,
          isLate(task) ? "text-destructive" : undefined,
        )}
      {has("status") &&
        cell(
          "status",
          "sm",
          <InlineSelect
            label="Status"
            value={task.status}
            onChange={(v) => patch.mutate({ status: v as Task["status"], completed: v === "concluido" })}
            options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s]?.label ?? s }))}
          />,
        )}
      {has("assignee") &&
        cell(
          "assignee",
          "none",
          <>
            <Avatar name={assignee?.name} color={assignee?.avatar_color} size="xs" />
            <InlineSelect
              label="Responsável"
              className="min-w-0 flex-1"
              value={task.assignee_id ?? ""}
              onChange={(v) => patch.mutate({ assignee_id: v || null })}
              options={[{ value: "", label: "—" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
            />
          </>,
        )}
    </>
  );
}

/** Cabeçalho de seção com nome editável, contador e menu. */
function SectionHeader({
  section,
  count,
  collapsed,
  onToggle,
  onRename,
  onRemove,
  onAdd,
  draggable,
  onDragStart,
  onDragEnd,
  className,
}: {
  section: Section;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename?: ((name: string) => void) | undefined;
  onRemove?: (() => void) | undefined;
  onAdd?: (() => void) | undefined;
  draggable?: boolean | undefined;
  onDragStart?: (() => void) | undefined;
  onDragEnd?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn("group flex items-center gap-1.5", draggable && "cursor-grab active:cursor-grabbing", className)}
    >
      <button onClick={onToggle} aria-label={collapsed ? "Expandir seção" : "Recolher seção"} className="p-0.5 text-muted-foreground">
        <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
      </button>
      {editing && onRename ? (
        <input
          autoFocus
          defaultValue={section.name}
          maxLength={80}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v.length >= 2 && v !== section.name) onRename(v);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="rounded-md border border-ring bg-background px-1.5 py-0.5 text-sm font-semibold focus:outline-none"
        />
      ) : (
        <button
          onClick={() => onRename && setEditing(true)}
          className="truncate text-sm font-semibold hover:underline"
          title={onRename ? "Renomear seção" : undefined}
        >
          {section.name}
        </button>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      {onAdd && (
        <button
          onClick={onAdd}
          aria-label="Adicionar tarefa nesta seção"
          className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      )}
      {(onRename || onRemove) && (
        <RowMenu
          className="ml-auto opacity-0 group-hover:opacity-100"
          actions={[
            ...(onRename ? [{ label: "Renomear seção", icon: Pencil, onSelect: () => setEditing(true) }] : []),
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

/* ------------------------- LISTA ------------------------- */

export function ListView({
  projectId,
  project,
  sections,
  tasks,
  members,
  fields,
  fieldValues,
  automations,
  sectionOf,
  onOpenTask,
}: ViewProps) {
  const { addSection, renameSection, removeSection, addTask, reorderTasks, reorderSections } =
    useSectionMutations(projectId, project, automations);
  const dnd = useDnd({
    sections,
    reorderSections: (ids) => reorderSections.mutate(ids),
    reorderTasks: (input) => reorderTasks.mutate(input),
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortState>(null);
  const cols = useColumnWidths(projectId);

  const columns = project.visible_columns ?? ["assignee", "due_date", "status"];
  const anyCustomPicked = columns.some((c) => c.startsWith("cf:"));
  const visibleFields = anyCustomPicked ? fields.filter((f) => columns.includes(`cf:${f.id}`)) : fields;
  const valueOf = (taskId: string, fieldId: string) =>
    fieldValues.find((v) => v.task_id === taskId && v.field_id === fieldId)?.value ?? "";

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));

  const applySort = (list: Task[]) => {
    if (!sort) return list.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const factor = sort.dir === "asc" ? 1 : -1;
    return list
      .slice()
      .sort((a, b) => sortValue(a, sort.key, members).localeCompare(sortValue(b, sort.key, members)) * factor);
  };

  const groups: Section[] = [
    ...sections,
    { id: "", project_id: projectId, name: "Sem seção", color: "slate", position: 999 },
  ];

  return (
    <div className="space-y-3">
      <div className="card-surface overflow-hidden">
        <TaskHeader columns={columns} fields={visibleFields} sort={sort} onSort={toggleSort} cols={cols} />

        {groups.map((section) => {
          const roots = applySort(tasks.filter((t) => sectionOf(t) === section.id && !t.parent_task_id));
          const listIds = roots.map((t) => t.id);
          if (!section.id && roots.length === 0) return null;
          const isCollapsed = collapsedSections[section.id] ?? false;

          return (
            <section
              key={section.id || "none"}
              onDragOver={(e) => {
                e.preventDefault();
                dnd.setOverSection(section.id);
              }}
              onDragLeave={() => dnd.setOverSection((o) => (o === section.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                dnd.dropOnSection(section.id, listIds);
              }}
              className={cn("border-b border-border last:border-b-0", dnd.overSection === section.id && "bg-brand/5")}
            >
              <SectionHeader
                section={section}
                count={roots.length}
                collapsed={isCollapsed}
                onToggle={() => setCollapsedSections((s) => ({ ...s, [section.id]: !isCollapsed }))}
                onRename={section.id ? (name) => renameSection.mutate({ id: section.id, name }) : undefined}
                onRemove={
                  section.id
                    ? () => confirm(`Remover a seção "${section.name}"?`) && removeSection.mutate(section.id)
                    : undefined
                }
                draggable={Boolean(section.id)}
                onDragStart={() => section.id && dnd.setDragSection(section.id)}
                onDragEnd={() => dnd.setDragSection(null)}
                className="bg-secondary/40 px-3 py-2"
              />

              {!isCollapsed && (
                <>
                  {roots.map((t) => {
                    const subs = tasks.filter((s) => s.parent_task_id === t.id);
                    const open = expanded[t.id] ?? false;
                    return (
                      <div key={t.id}>
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/task-id", t.id);
                            dnd.setDragTask({ taskId: t.id, sectionId: section.id });
                          }}
                          onDragEnd={() => dnd.setDragTask(null)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            dnd.dropOnTask(t.id, section.id, listIds);
                          }}
                          className="group flex items-center gap-2 border-t border-border/60 px-3 py-1.5 hover:bg-secondary/40"
                        >
                          <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-50 active:cursor-grabbing" />
                          <TaskToggle task={t} automations={automations} />
                          <button
                            onClick={() => onOpenTask(t)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                          >
                            {subs.length > 0 && (
                              <ChevronRight
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpanded((x) => ({ ...x, [t.id]: !open }));
                                }}
                                className={cn(
                                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                  open && "rotate-90",
                                )}
                              />
                            )}
                            {t.is_milestone && <Flag className="size-3.5 shrink-0 text-warning" />}
                            <span
                              className={cn(
                                "truncate text-sm",
                                t.status === "concluido" && "text-muted-foreground line-through",
                              )}
                            >
                              {t.title}
                            </span>
                            {subs.length > 0 && (
                              <Pill>
                                {subs.filter((s) => s.status === "concluido").length}/{subs.length}
                              </Pill>
                            )}
                          </button>
                          {visibleFields.map((f) => (
                            <span
                              key={f.id}
                              style={{ width: cols.widthOf(`cf:${f.id}`) }}
                              className="shrink-0"
                            >
                              <CustomFieldCell taskId={t.id} field={f} value={valueOf(t.id, f.id)} />
                            </span>
                          ))}
                          <TaskCells task={t} columns={columns} members={members} cols={cols} />
                          <DeleteTaskButton task={t} className="opacity-0 group-hover:opacity-100 focus:opacity-100" />
                        </div>

                        {open &&
                          subs.map((s) => (
                            <div
                              key={s.id}
                              className="group flex items-center gap-2 border-t border-border/60 bg-secondary/20 py-1.5 pr-3 pl-11"
                            >
                              <TaskToggle task={s} automations={automations} size="sm" />
                              <button
                                onClick={() => onOpenTask(s)}
                                className={cn(
                                  "min-w-0 flex-1 truncate text-left text-sm",
                                  s.status === "concluido" && "text-muted-foreground line-through",
                                )}
                              >
                                {s.title}
                              </button>
                              <TaskCells task={s} columns={columns} members={members} cols={cols} />
                              <DeleteTaskButton task={s} className="opacity-0 group-hover:opacity-100" />
                            </div>
                          ))}
                      </div>
                    );
                  })}

                  <AddTaskRow
                    className="border-t border-border/60"
                    onAdd={(title) => addTask.mutate({ title, sectionId: section.id || null })}
                  />
                </>
              )}
            </section>
          );
        })}
      </div>

      <AddInline placeholder="Adicionar seção" onAdd={(name) => addSection.mutate(name)} />
    </div>
  );
}

/* ------------------------- QUADRO ------------------------- */

export function BoardView({
  projectId,
  project,
  sections,
  tasks,
  members,
  automations,
  sectionOf,
  onOpenTask,
}: ViewProps) {
  const { addSection, renameSection, removeSection, addTask, reorderTasks, reorderSections } =
    useSectionMutations(projectId, project, automations);
  const dnd = useDnd({
    sections,
    reorderSections: (ids) => reorderSections.mutate(ids),
    reorderTasks: (input) => reorderTasks.mutate(input),
  });
  const memberOf = (id?: string | null) => members.find((m) => m.id === id) ?? null;
  const columns = project.visible_columns ?? ["assignee", "due_date", "status"];

  const unsectioned = tasks.filter((t) => !sectionOf(t) && !t.parent_task_id);
  const boardSections: Section[] =
    unsectioned.length > 0
      ? [...sections, { id: "", project_id: project.id, name: "Sem seção", color: "slate", position: 999 }]
      : sections;

  if (boardSections.length === 0) {
    return (
      <EmptyState
        title="Nenhuma seção ainda"
        description="Crie a primeira coluna para começar a organizar as tarefas."
        action={<AddInline placeholder="Adicionar seção" onAdd={(name) => addSection.mutate(name)} />}
      />
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {boardSections.map((section) => {
        const list = tasks
          .filter((t) => sectionOf(t) === section.id && !t.parent_task_id)
          .slice()
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const listIds = list.map((t) => t.id);
        return (
          <div
            key={section.id || "none"}
            onDragOver={(e) => {
              e.preventDefault();
              dnd.setOverSection(section.id);
            }}
            onDragLeave={() => dnd.setOverSection((o) => (o === section.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              dnd.dropOnSection(section.id, listIds);
            }}
            className={cn(
              "flex w-[290px] shrink-0 flex-col rounded-lg bg-secondary/50 p-2",
              dnd.overSection === section.id && "ring-2 ring-brand/40",
            )}
          >
            <SectionHeader
              section={section}
              count={list.length}
              collapsed={false}
              onToggle={() => undefined}
              onRename={section.id ? (name) => renameSection.mutate({ id: section.id, name }) : undefined}
              onRemove={
                section.id
                  ? () => confirm(`Remover a seção "${section.name}"?`) && removeSection.mutate(section.id)
                  : undefined
              }
              draggable={Boolean(section.id)}
              onDragStart={() => section.id && dnd.setDragSection(section.id)}
              onDragEnd={() => dnd.setDragSection(null)}
              className="px-1.5 py-1"
            />

            <div className="mt-1 flex flex-col gap-2">
              {list.map((t) => {
                const subs = tasks.filter((s) => s.parent_task_id === t.id);
                const assignee = memberOf(t.assignee_id);
                return (
                  <div
                    key={t.id}
                    className="group relative"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      dnd.dropOnTask(t.id, section.id, listIds);
                    }}
                  >
                    {/* div, não button: o card contém outros botões (concluir, excluir)
                        e botão aninhado é HTML inválido — quebra a hidratação. */}
                    <div
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/task-id", t.id);
                        dnd.setDragTask({ taskId: t.id, sectionId: section.id });
                      }}
                      onDragEnd={() => dnd.setDragTask(null)}
                      onClick={() => onOpenTask(t)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenTask(t);
                        }
                      }}
                      className="w-full cursor-grab space-y-2 rounded-lg border border-border bg-card p-2.5 text-left transition-shadow hover:shadow-[var(--shadow-raised)] focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
                    >
                      <div className="flex items-start gap-2">
                        <TaskToggle task={t} automations={automations} size="sm" />
                        <span
                          className={cn(
                            "flex-1 pr-5 text-sm leading-snug",
                            t.status === "concluido" && "text-muted-foreground line-through",
                          )}
                        >
                          {t.is_milestone && <Flag className="mr-1 inline size-3.5 text-warning" />}
                          {t.title}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {columns.includes("due_date") && t.due_date && (
                          <Pill tone={isLate(t) ? "danger" : "neutral"}>{shortDate(t.due_date)}</Pill>
                        )}
                        {columns.includes("priority") && (
                          <Pill tone={t.priority === "urgente" ? "danger" : t.priority === "alta" ? "warning" : "neutral"}>
                            {PRIORITY_LABEL[t.priority as Priority] ?? t.priority}
                          </Pill>
                        )}
                        {columns.includes("sprint") && t.sprint && <Pill tone="info">{t.sprint}</Pill>}
                        {columns.includes("tags") && t.tags?.map((tag) => <Pill key={tag}>{tag}</Pill>)}
                        {subs.length > 0 && (
                          <Pill>
                            {subs.filter((s) => s.status === "concluido").length}/{subs.length} subtarefas
                          </Pill>
                        )}
                        {columns.includes("assignee") && (
                          <span className="ml-auto">
                            <Avatar name={assignee?.name} color={assignee?.avatar_color} />
                          </span>
                        )}
                      </div>
                    </div>
                    <DeleteTaskButton
                      task={t}
                      className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    />
                  </div>
                );
              })}
            </div>

            <AddTaskRow
              className="mt-1 rounded-md"
              onAdd={(title) => addTask.mutate({ title, sectionId: section.id || null })}
            />
          </div>
        );
      })}

      <div className="w-56 shrink-0 pt-1">
        <AddInline placeholder="Adicionar seção" onAdd={(name) => addSection.mutate(name)} />
      </div>
    </div>
  );
}

/* ------------------------- TIMELINE ------------------------- */

const DAY = 1000 * 60 * 60 * 24;

export function TimelineView({
  tasks,
  members,
  dependencies,
  onOpenTask,
}: ViewProps & { dependencies: { task_id: string; blocked_by_task_id: string }[] }) {
  const dated = tasks.filter((t) => t.due_date && !t.parent_task_id);
  const memberOf = (id?: string | null) => members.find((m) => m.id === id) ?? null;

  if (dated.length === 0) {
    return (
      <EmptyState
        title="Sem datas para desenhar a timeline"
        description="Defina prazos nas tarefas e elas aparecem aqui automaticamente."
      />
    );
  }

  const starts = dated.map((t) => new Date(t.start_date ?? t.created_at).getTime());
  const ends = dated.map((t) => new Date(`${t.due_date}T12:00:00`).getTime());
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const span = Math.max(DAY, max - min);

  /** Marcadores de mês ao longo do eixo. */
  const ticks: { label: string; left: number }[] = [];
  const cursor = new Date(min);
  cursor.setDate(1);
  while (cursor.getTime() <= max) {
    const left = ((cursor.getTime() - min) / span) * 100;
    if (left >= 0)
      ticks.push({
        label: cursor.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        left,
      });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const blockedBy = (id: string) =>
    dependencies.filter((d) => d.task_id === id).map((d) => tasks.find((t) => t.id === d.blocked_by_task_id)?.title);

  return (
    <div className="card-surface space-y-2 overflow-x-auto p-4">
      <div className="relative ml-52 h-5 border-b border-border">
        {ticks.map((t) => (
          <span
            key={t.label + t.left}
            style={{ left: `${t.left}%` }}
            className="absolute top-0 -translate-x-1/2 text-[11px] text-muted-foreground"
          >
            {t.label}
          </span>
        ))}
      </div>
      <div className="space-y-1">
        {dated
          .slice()
          .sort((a, b) => (a.start_date ?? a.due_date ?? "").localeCompare(b.start_date ?? b.due_date ?? ""))
          .map((t) => {
            const start = new Date(t.start_date ?? t.created_at).getTime();
            const end = new Date(`${t.due_date}T12:00:00`).getTime();
            const left = ((start - min) / span) * 100;
            const width = Math.max(1.5, ((end - start) / span) * 100);
            const deps = blockedBy(t.id).filter(Boolean);
            return (
              <div key={t.id} className="flex items-center gap-3">
                <button
                  onClick={() => onOpenTask(t)}
                  className="w-48 shrink-0 truncate text-left text-sm hover:underline"
                  title={t.title}
                >
                  {t.is_milestone && <Flag className="mr-1 inline size-3 text-warning" />}
                  {t.title}
                </button>
                <div className="relative h-7 min-w-[360px] flex-1 rounded-md bg-secondary/60">
                  <button
                    onClick={() => onOpenTask(t)}
                    title={deps.length ? `Bloqueada por: ${deps.join(", ")}` : t.title}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className={cn(
                      "absolute inset-y-1 flex items-center gap-1 overflow-hidden rounded px-2 text-[10px] font-medium text-white",
                      t.is_milestone
                        ? "bg-warning"
                        : t.status === "concluido"
                          ? "bg-success"
                          : isLate(t)
                            ? "bg-destructive"
                            : "bg-brand",
                    )}
                  >
                    {deps.length > 0 && <span aria-hidden>⛓</span>}
                    <span className="truncate">{shortDate(t.due_date)}</span>
                  </button>
                </div>
                <Avatar name={memberOf(t.assignee_id)?.name} color={memberOf(t.assignee_id)?.avatar_color} />
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ------------------------- CALENDÁRIO ------------------------- */

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export function CalendarView({ projectId, project, tasks, members, automations, sections, onOpenTask }: ViewProps) {
  const qc = useQueryClient();
  const { addTask } = useSectionMutations(projectId, project, automations);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [composing, setComposing] = useState<string | null>(null);

  const reschedule = useMutation({
    mutationFn: (input: { id: string; due_date: string }) => updateTask(input.id, { due_date: input.due_date }),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível mudar o prazo."),
  });

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // segunda = 0
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - offset);

  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const todayISO = toISO(new Date());
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.due_date || t.parent_task_id) continue;
    const list = byDay.get(t.due_date) ?? [];
    list.push(t);
    byDay.set(t.due_date, list);
  }

  const firstSectionId = sections[0]?.id ?? null;

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label="Mês anterior"
          className="btn btn-ghost p-1.5"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-semibold capitalize">
          {cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </span>
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label="Próximo mês"
          className="btn btn-ghost p-1.5"
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          onClick={() => {
            const d = new Date();
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
          }}
          className="btn btn-outline ml-2 px-2.5 py-1 text-xs"
        >
          Hoje
        </button>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
          Arraste uma tarefa para outro dia para mudar o prazo.
        </span>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-secondary/40">
        {WEEKDAYS.map((d) => (
          <span key={d} className="px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground uppercase">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = toISO(day);
          const list = byDay.get(iso) ?? [];
          const outside = day.getMonth() !== cursor.getMonth();
          return (
            <div
              key={iso}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/task-id");
                if (id) reschedule.mutate({ id, due_date: iso });
              }}
              className={cn(
                "group min-h-28 border-r border-b border-border p-1.5 last:border-r-0",
                outside && "bg-secondary/30",
              )}
            >
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[11px] tabular-nums",
                    iso === todayISO ? "bg-brand font-semibold text-brand-foreground" : "text-muted-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
                <button
                  onClick={() => setComposing(iso)}
                  aria-label="Adicionar tarefa neste dia"
                  className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>

              <div className="mt-1 space-y-1">
                {list.map((t) => {
                  const assignee = members.find((m) => m.id === t.assignee_id);
                  return (
                    <button
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)}
                      onClick={() => onOpenTask(t)}
                      title={t.title}
                      className={cn(
                        "flex w-full items-center gap-1 rounded border px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-secondary",
                        t.status === "concluido"
                          ? "border-success/30 bg-success/10 text-muted-foreground line-through"
                          : isLate(t)
                            ? "border-destructive/30 bg-destructive/5"
                            : "border-border bg-card",
                      )}
                    >
                      {t.is_milestone && <Flag className="size-3 shrink-0 text-warning" />}
                      <span className="truncate">{t.title}</span>
                      {assignee && (
                        <Avatar name={assignee.name} color={assignee.avatar_color} size="xs" className="ml-auto" />
                      )}
                    </button>
                  );
                })}

                {composing === iso && (
                  <input
                    autoFocus
                    placeholder="Nova tarefa"
                    maxLength={140}
                    onKeyDown={(e) => {
                      const value = (e.target as HTMLInputElement).value.trim();
                      if (e.key === "Enter" && value.length >= 2) {
                        addTask.mutate({ title: value, sectionId: firstSectionId, dueDate: iso });
                        setComposing(null);
                      }
                      if (e.key === "Escape") setComposing(null);
                    }}
                    onBlur={() => setComposing(null)}
                    className="w-full rounded border border-ring bg-background px-1.5 py-1 text-[11px] focus:outline-none"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
