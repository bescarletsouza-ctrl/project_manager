import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionTitle } from "@/components/ui-bits";
import { updateTask, deleteTask } from "@/lib/data";
import {
  commentsQuery,
  mentionsQuery,
  notifyAssignment,
  notifyStatusMilestone,
  type Automation,
  type TaskDepartment,
} from "@/lib/asana";
import { applyAutomationMoves, runAutomationsForTask } from "@/lib/automations";
import { PRIORITIES, PRIORITY_LABEL, type Task } from "@/lib/domain";
import { taskDepartmentIdsOf, useInvalidate } from "@/lib/useData";

export function TaskEditDialog({
  task,
  members,
  onClose,
  onDeleted,
  currentMemberId = null,
}: {
  task: Task;
  members: { id: string; name: string }[];
  onClose: () => void;
  onDeleted?: () => void;
  currentMemberId?: string | null;
}) {
  const invalidateTask = useInvalidate(["tasks"]);
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? "",
    assignee_id: task.assignee_id ?? "",
    priority: task.priority as string,
    due_date: task.due_date ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      await updateTask(task.id, {
        title: form.title.trim(),
        description: form.description,
        assignee_id: form.assignee_id || null,
        priority: form.priority,
        due_date: form.due_date || null,
      });
      await notifyAssignment(
        task,
        form.assignee_id || null,
        currentMemberId,
        members.find((m) => m.id === currentMemberId)?.name ?? null,
      );
    },
    onSuccess: () => {
      invalidateTask();
      toast.success("Tarefa atualizada.");
      onClose();
    },
    onError: () => toast.error("Não foi possível salvar a tarefa."),
  });

  const remove = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      invalidateTask();
      toast.success("Tarefa excluída.");
      onDeleted?.();
      onClose();
    },
    onError: () => toast.error("Não foi possível excluir a tarefa."),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/30 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (form.title.trim().length < 3) {
            toast.error("Informe um título com pelo menos 3 caracteres.");
            return;
          }
          save.mutate();
        }}
        className="w-full max-w-lg space-y-3 rounded-lg border border-border bg-card p-5"
      >
        <SectionTitle title="Editar tarefa" description="Nome, responsável, prioridade e briefing." />
        <input
          placeholder="Nome da tarefa"
          maxLength={140}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Briefing / descrição"
          maxLength={2000}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.assignee_id}
            onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
          >
            <option value="">Sem responsável</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
        </div>
        <div className="flex justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              if (confirm("Excluir esta tarefa?")) remove.mutate();
            }}
            className="rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            Excluir
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm hover:bg-secondary">
              Cancelar
            </button>
            <button
              disabled={save.isPending}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {save.isPending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function TaskCheck({
  task,
  className = "",
  currentMemberId = null,
  currentMemberName = null,
  automations = [],
  taskDepartments = [],
}: {
  task: Task;
  className?: string;
  currentMemberId?: string | null;
  currentMemberName?: string | null;
  /** Automações do projeto/departamento da tarefa — sem isso, concluir por aqui não move a tarefa (ex.: regra "concluído → seção Concluído"), diferente do toggle do Quadro/Lista. */
  automations?: Automation[];
  taskDepartments?: TaskDepartment[];
}) {
  const invalidateTaskAuto = useInvalidate(["tasks", "task_projects", "task_departments", "task_field_values", "notifications"]);
  const comments = useQuery(commentsQuery).data ?? [];
  const mentions = useQuery(mentionsQuery).data ?? [];
  const done = task.status === "concluido";
  const toggle = useMutation({
    mutationFn: async () => {
      const nextStatus = done ? "em_andamento" : "concluido";
      const { patch, applied, moves } = runAutomationsForTask(
        automations,
        "status_changed",
        { ...task, status: nextStatus as Task["status"] },
        { projectId: task.project_id, departmentIds: taskDepartmentIdsOf(task, taskDepartments) },
      );
      if (applied.length) toast.info(`Automação aplicada: ${applied.join(", ")}`);
      await updateTask(task.id, { status: nextStatus, completed: nextStatus === "concluido", ...patch });
      await applyAutomationMoves(task.id, { projectId: task.project_id, departmentId: task.department_id }, moves);
      const finalStatus = (patch["status"] as Task["status"] | undefined) ?? nextStatus;
      await notifyStatusMilestone(task, finalStatus, comments, mentions, currentMemberId, currentMemberName);
    },
    onSuccess: () => {
      invalidateTaskAuto();
      toast.success(done ? "Tarefa reaberta." : "Tarefa concluída.");
    },
    onError: () => toast.error("Não foi possível atualizar a tarefa."),
  });

  return (
    <button
      type="button"
      aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
      title={done ? "Reabrir tarefa" : "Marcar como concluída"}
      disabled={toggle.isPending}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggle.mutate();
      }}
      className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
        done ? "border-success bg-success/15 text-success" : "border-input hover:border-primary hover:bg-secondary"
      } ${className}`}
    >
      {done ? (
        <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}
