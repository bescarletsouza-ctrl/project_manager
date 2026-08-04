import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  CircleSlash,
  Flag,
  Link2,
  MessageSquare,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Pill, RowMenu } from "@/components/ui-bits";
import { createTask, deleteTask, statusEventsQuery, updateTask } from "@/lib/data";
import {
  FIELD_TYPE_LABEL,
  addDependency,
  createComment,
  createNotifications,
  linkTaskToProject,
  removeDependency,
  resolveMentions,
  setFieldValue,
  unlinkTaskFromProject,
  type Automation,
  type CustomField,
  type Section,
  type TaskComment,
  type TaskDependency,
  type TaskFieldValue,
  type TaskProject,
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
  type Project,
  type Task,
} from "@/lib/domain";
import { dotClass } from "@/lib/colors";
import { cn } from "@/lib/utils";

type Props = {
  task: Task;
  tasks: Task[];
  members: Member[];
  sections: Section[];
  fields: CustomField[];
  fieldValues: TaskFieldValue[];
  comments: TaskComment[];
  dependencies: TaskDependency[];
  projects?: Project[];
  taskProjects?: TaskProject[];
  automations?: Automation[];
  currentMember: Member | null;
  currentUserId: string | null;
  onClose: () => void;
  onOpenTask: (task: Task) => void;
};

/** Controle que se parece com texto e vira campo ao passar o mouse (padrão Asana). */
const ctl =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm transition-colors hover:border-input focus:border-ring focus:outline-none";

export function TaskPane({
  task,
  tasks,
  members,
  sections,
  fields,
  fieldValues,
  comments,
  dependencies,
  projects = [],
  taskProjects = [],
  automations = [],
  currentMember,
  currentUserId,
  onClose,
  onOpenTask,
}: Props) {
  const qc = useQueryClient();
  const events = useQuery(statusEventsQuery).data ?? [];

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [subtitle, setSubtitle] = useState("");
  const [comment, setComment] = useState("");
  const [depTarget, setDepTarget] = useState("");

  // ao trocar de tarefa dentro do painel, recarrega os campos de texto
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setSubtitle("");
    setComment("");
  }, [task.id, task.title, task.description]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const invalidate = () => qc.invalidateQueries();
  const memberOf = (id?: string | null) => members.find((m) => m.id === id) ?? null;

  const subtasks = tasks.filter((t) => t.parent_task_id === task.id);
  const taskComments = comments.filter((c) => c.task_id === task.id);
  const blockers = dependencies.filter((d) => d.task_id === task.id);
  const blocking = dependencies.filter((d) => d.blocked_by_task_id === task.id);
  const values = useMemo(
    () =>
      Object.fromEntries(
        fieldValues.filter((v) => v.task_id === task.id).map((v) => [v.field_id, v.value ?? ""]),
      ),
    [fieldValues, task.id],
  );

  /** Salvamento imediato: qualquer alteração vai para o banco na hora. */
  const patch = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const extra: Record<string, unknown> = {};

      if ("status" in input) {
        const next = input["status"] as Task["status"];
        const auto = runAutomations(automations, "status_changed", { ...task, status: next }, task.project_id);
        Object.assign(extra, auto.patch);
        await updateTask(task.id, { ...input, ...extra, completed: next === "concluido" });
        await applyAutomationMoves(task.id, task.project_id, auto.moves);
        if (task.assignee_id && task.assignee_id !== currentMember?.id) {
          await createNotifications([
            {
              member_id: task.assignee_id,
              kind: "status",
              title: `"${task.title}" mudou para ${STATUS_META[next]?.label ?? next}`,
              task_id: task.id,
              project_id: task.project_id,
              actor_member_id: currentMember?.id ?? null,
            },
          ]);
        }
        return;
      }

      if ("assignee_id" in input) {
        const next = (input["assignee_id"] as string | null) || null;
        const auto = runAutomations(
          automations,
          "assignee_changed",
          { ...task, assignee_id: next },
          task.project_id,
        );
        Object.assign(extra, auto.patch);
        await updateTask(task.id, { ...input, ...extra });
        await applyAutomationMoves(task.id, task.project_id, auto.moves);
        if (next && next !== task.assignee_id) {
          await createNotifications([
            {
              member_id: next,
              kind: "atribuicao",
              title: `Você foi designado para "${task.title}"`,
              task_id: task.id,
              project_id: task.project_id,
              actor_member_id: currentMember?.id ?? null,
            },
          ]);
        }
        return;
      }

      await updateTask(task.id, input);
    },
    onSuccess: invalidate,
    onError: (e: unknown) =>
      toast.error(`Não foi possível salvar: ${(e as { message?: string })?.message ?? "erro"}`),
  });

  const remove = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      invalidate();
      toast.success("Tarefa excluída.");
      onClose();
    },
    onError: () => toast.error("Não foi possível excluir."),
  });

  const addSubtask = useMutation({
    mutationFn: () =>
      createTask({
        title: subtitle.trim(),
        parent_task_id: task.id,
        project_id: task.project_id,
        section_id: task.section_id,
        department_id: task.department_id,
        client_id: task.client_id,
        assignee_id: task.assignee_id,
        status: "a_fazer",
      }),
    onSuccess: () => {
      setSubtitle("");
      invalidate();
    },
    onError: () => toast.error("Não foi possível criar a subtarefa."),
  });

  const postComment = useMutation({
    mutationFn: async () => {
      const mentioned = resolveMentions(comment, members);
      await createComment({
        task_id: task.id,
        body: comment.trim(),
        author_member_id: currentMember?.id ?? null,
        author_user_id: currentUserId,
        mentions: mentioned,
      });
      const targets = new Set<string>(mentioned);
      if (task.assignee_id && task.assignee_id !== currentMember?.id) targets.add(task.assignee_id);
      await createNotifications(
        [...targets].map((member_id) => ({
          member_id,
          kind: mentioned.includes(member_id) ? "mencao" : "comentario",
          title: `${currentMember?.name ?? "Alguém"} comentou em "${task.title}"`,
          body: comment.trim().slice(0, 240),
          task_id: task.id,
          project_id: task.project_id,
          actor_member_id: currentMember?.id ?? null,
        })),
      );
    },
    onSuccess: () => {
      setComment("");
      invalidate();
    },
    onError: () => toast.error("Não foi possível comentar."),
  });

  const linkDep = useMutation({
    mutationFn: () => addDependency(task.id, depTarget),
    onSuccess: () => {
      setDepTarget("");
      invalidate();
      toast.success("Dependência adicionada.");
    },
    onError: () => toast.error("Dependência inválida ou já existente."),
  });

  const unlinkDep = useMutation({ mutationFn: (id: string) => removeDependency(id), onSuccess: invalidate });

  const saveField = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: string }) =>
      setFieldValue(task.id, fieldId, value || null),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível salvar o campo."),
  });

  const projectFields = fields.filter((f) => f.project_id === task.project_id);
  const projectSections = sections.filter((s) => s.project_id === task.project_id);
  const candidates = tasks.filter((t) => t.id !== task.id && t.project_id === task.project_id);
  const blockedOpen = blockers.some((d) => {
    const b = tasks.find((t) => t.id === d.blocked_by_task_id);
    return b && b.status !== "concluido";
  });
  const done = task.status === "concluido";
  const project = projects.find((p) => p.id === task.project_id) ?? null;

  /** Comentários + mudanças de status em ordem cronológica. */
  const activity = useMemo(() => {
    const fromComments = taskComments.map((c) => ({
      id: `c-${c.id}`,
      at: c.created_at,
      kind: "comment" as const,
      comment: c,
    }));
    const fromEvents = events
      .filter((e) => e.task_id === task.id)
      .map((e) => ({ id: `e-${e.id}`, at: e.entered_at, kind: "status" as const, event: e }));
    return [...fromComments, ...fromEvents].sort((a, b) => a.at.localeCompare(b.at));
  }, [taskComments, events, task.id]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-foreground/20" onMouseDown={onClose}>
      <aside
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[600px] flex-col border-l border-border bg-card shadow-[var(--shadow-pane)]"
      >
        {/* cabeçalho fixo */}
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <button
            onClick={() => patch.mutate({ status: done ? "em_andamento" : "concluido" })}
            className={cn(
              "btn gap-1.5 border px-2.5 py-1.5 text-[13px]",
              done
                ? "border-success/40 bg-success/10 text-success"
                : "border-input text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Check className="size-3.5" />
            {done ? "Concluída" : "Marcar como concluída"}
          </button>
          {blockedOpen && <Pill tone="danger">Bloqueada</Pill>}
          {task.parent_task_id && <Pill>Subtarefa</Pill>}
          <div className="ml-auto flex items-center gap-1">
            <RowMenu
              actions={[
                {
                  label: task.is_milestone ? "Deixar de ser marco" : "Transformar em marco",
                  icon: Flag,
                  onSelect: () => patch.mutate({ is_milestone: !task.is_milestone }),
                },
                {
                  label: "Cancelar tarefa",
                  icon: CircleSlash,
                  onSelect: () => patch.mutate({ status: "cancelado" }),
                },
                {
                  label: "Excluir tarefa",
                  icon: Trash2,
                  destructive: true,
                  separatorBefore: true,
                  onSelect: () => confirm("Excluir esta tarefa?") && remove.mutate(),
                },
              ]}
            />
            <button onClick={onClose} aria-label="Fechar" className="btn btn-ghost p-1.5">
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 px-5 py-4">
            {project && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn("size-2.5 rounded-[3px]", dotClass(project.color))} />
                {project.name}
              </div>
            )}

            <textarea
              value={title}
              rows={1}
              maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim().length >= 3 && title !== task.title && patch.mutate({ title: title.trim() })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
              className={cn(
                "w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold tracking-tight hover:border-input focus:border-ring focus:outline-none",
                done && "text-muted-foreground line-through",
              )}
            />

            {/* campos principais */}
            <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
              <FieldLabel>Responsável</FieldLabel>
              <div className="flex items-center gap-2">
                <Avatar name={memberOf(task.assignee_id)?.name} color={memberOf(task.assignee_id)?.avatar_color} />
                <select
                  aria-label="Responsável"
                  className={ctl}
                  value={task.assignee_id ?? ""}
                  onChange={(e) => patch.mutate({ assignee_id: e.target.value || null })}
                >
                  <option value="">Sem responsável</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <FieldLabel>Prazo</FieldLabel>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="Prazo"
                  className={cn(ctl, isLate(task) && "text-destructive")}
                  value={task.due_date ?? ""}
                  onChange={(e) => patch.mutate({ due_date: e.target.value || null })}
                />
                {isLate(task) && <Pill tone="danger">atrasada</Pill>}
              </div>

              <FieldLabel>Início</FieldLabel>
              <input
                type="date"
                aria-label="Início"
                className={ctl}
                value={task.start_date ?? ""}
                onChange={(e) => patch.mutate({ start_date: e.target.value || null })}
              />

              <FieldLabel>Status</FieldLabel>
              <select
                aria-label="Status"
                className={ctl}
                value={task.status}
                onChange={(e) => patch.mutate({ status: e.target.value })}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>

              <FieldLabel>Prioridade</FieldLabel>
              <select
                aria-label="Prioridade"
                className={ctl}
                value={task.priority}
                onChange={(e) => patch.mutate({ priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>

              {projectSections.length > 0 && (
                <>
                  <FieldLabel>Seção</FieldLabel>
                  <select
                    aria-label="Seção"
                    className={ctl}
                    value={task.section_id ?? ""}
                    onChange={(e) => patch.mutate({ section_id: e.target.value || null })}
                  >
                    <option value="">Sem seção</option>
                    {projectSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <FieldLabel>Tipo</FieldLabel>
              <select
                aria-label="Tipo de tarefa"
                className={ctl}
                value={task.task_type ?? ""}
                onChange={(e) => patch.mutate({ task_type: e.target.value })}
              >
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TASK_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>

              <FieldLabel>Sprint</FieldLabel>
              <input
                aria-label="Sprint"
                placeholder="Ex.: Sprint 12"
                maxLength={40}
                className={ctl}
                defaultValue={task.sprint ?? ""}
                key={`sprint-${task.id}`}
                onBlur={(e) =>
                  e.target.value !== (task.sprint ?? "") && patch.mutate({ sprint: e.target.value || null })
                }
              />

              <FieldLabel>Etiquetas</FieldLabel>
              <input
                aria-label="Etiquetas"
                placeholder="Separadas por vírgula"
                className={ctl}
                key={`tags-${task.id}`}
                defaultValue={(task.tags ?? []).join(", ")}
                onBlur={(e) =>
                  patch.mutate({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />

              {projectFields.map((f) => (
                <div key={f.id} className="contents">
                  <FieldLabel title={FIELD_TYPE_LABEL[f.field_type]}>{f.name}</FieldLabel>
                  {f.field_type === "select" ? (
                    <select
                      aria-label={f.name}
                      className={ctl}
                      value={values[f.id] ?? ""}
                      onChange={(e) => saveField.mutate({ fieldId: f.id, value: e.target.value })}
                    >
                      <option value="">—</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={f.name}
                      type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                      className={ctl}
                      key={`${f.id}-${task.id}`}
                      defaultValue={values[f.id] ?? ""}
                      onBlur={(e) => saveField.mutate({ fieldId: f.id, value: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>

            <div>
              <FieldLabel>Descrição</FieldLabel>
              <textarea
                placeholder="Do que se trata esta tarefa?"
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => description !== (task.description ?? "") && patch.mutate({ description })}
                className={cn(ctl, "mt-1 min-h-24 resize-y")}
              />
            </div>

            <TaskProjectsBlock task={task} projects={projects} taskProjects={taskProjects} />

            {/* subtarefas */}
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">Subtarefas {subtasks.length > 0 && `(${subtasks.length})`}</h3>
              <ul>
                {subtasks.map((s) => (
                  <li key={s.id} className="group flex items-center gap-2 rounded-md py-1 pr-1 hover:bg-secondary/60">
                    <SubtaskCheck task={s} />
                    <button
                      onClick={() => onOpenTask(s)}
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-sm",
                        s.status === "concluido" && "text-muted-foreground line-through",
                      )}
                    >
                      {s.title}
                    </button>
                    {s.due_date && (
                      <span className={cn("text-xs", isLate(s) ? "text-destructive" : "text-muted-foreground")}>
                        {formatDay(s.due_date)}
                      </span>
                    )}
                    <Avatar name={memberOf(s.assignee_id)?.name} color={memberOf(s.assignee_id)?.avatar_color} size="xs" />
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2">
                <Plus className="size-4 shrink-0 text-muted-foreground" />
                <input
                  placeholder="Adicionar subtarefa"
                  value={subtitle}
                  maxLength={140}
                  onChange={(e) => setSubtitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && subtitle.trim().length >= 2) addSubtask.mutate();
                  }}
                  className={ctl}
                />
              </div>
            </section>

            {/* dependências */}
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                <Link2 className="size-3.5" /> Dependências
              </h3>
              {blockers.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma tarefa bloqueando esta.</p>}
              <ul className="space-y-1">
                {blockers.map((d) => {
                  const b = tasks.find((t) => t.id === d.blocked_by_task_id);
                  return (
                    <li key={d.id} className="flex items-center gap-2 text-sm">
                      <Pill tone={b?.status === "concluido" ? "success" : "danger"}>
                        {b?.status === "concluido" ? "liberada" : "bloqueada por"}
                      </Pill>
                      <span className="min-w-0 flex-1 truncate">{b?.title ?? "—"}</span>
                      <button
                        onClick={() => unlinkDep.mutate(d.id)}
                        aria-label="Remover dependência"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {blocking.length > 0 && (
                <p className="text-xs text-muted-foreground">Esta tarefa bloqueia {blocking.length} outra(s).</p>
              )}
              {candidates.length > 0 && (
                <div className="flex gap-2">
                  <select
                    aria-label="Adicionar dependência"
                    className="field w-full"
                    value={depTarget}
                    onChange={(e) => setDepTarget(e.target.value)}
                  >
                    <option value="">Bloqueada por…</option>
                    {candidates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => depTarget && linkDep.mutate()} className="btn btn-outline px-2.5">
                    <Plus className="size-4" />
                  </button>
                </div>
              )}
            </section>

            {/* atividade */}
            <section className="space-y-3 border-t border-border pt-4">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                <MessageSquare className="size-3.5" /> Atividade
              </h3>
              <p className="text-xs text-muted-foreground">
                <CalendarDays className="mr-1 inline size-3" />
                Criada em {new Date(task.created_at).toLocaleDateString("pt-BR")}
              </p>
              <ul className="space-y-3">
                {activity.map((item) =>
                  item.kind === "comment" ? (
                    <li key={item.id} className="flex gap-2">
                      <Avatar
                        name={memberOf(item.comment.author_member_id)?.name}
                        color={memberOf(item.comment.author_member_id)?.avatar_color}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs">
                          <span className="font-medium">{memberOf(item.comment.author_member_id)?.name ?? "Usuário"}</span>
                          <span className="text-muted-foreground">
                            {" · "}
                            {new Date(item.comment.created_at).toLocaleString("pt-BR")}
                          </span>
                        </p>
                        <p className="mt-1 rounded-lg bg-secondary px-3 py-2 text-sm whitespace-pre-wrap">
                          {item.comment.body}
                        </p>
                      </div>
                    </li>
                  ) : (
                    <li key={item.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="size-1.5 shrink-0 rounded-full bg-border" />
                      Movida para{" "}
                      <span className="font-medium text-foreground">
                        {STATUS_META[item.event.to_status as Task["status"]]?.label ?? item.event.to_status}
                      </span>
                      <span>· {new Date(item.event.entered_at).toLocaleString("pt-BR")}</span>
                    </li>
                  ),
                )}
                {activity.length === 0 && <li className="text-sm text-muted-foreground">Sem atividade ainda.</li>}
              </ul>
            </section>
          </div>
        </div>

        {/* composer fixo */}
        <div className="shrink-0 border-t border-border bg-card px-5 py-3">
          <div className="flex items-start gap-2">
            <Avatar name={currentMember?.name} color={currentMember?.avatar_color} />
            <textarea
              placeholder="Escreva um comentário. Use @nome para mencionar alguém."
              value={comment}
              maxLength={2000}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && comment.trim().length > 1) postComment.mutate();
              }}
              className="field h-16 flex-1 resize-none"
            />
            <button
              onClick={() => comment.trim().length > 1 && postComment.mutate()}
              disabled={postComment.isPending || comment.trim().length < 2}
              className="btn btn-primary"
            >
              Enviar
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function FieldLabel({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="truncate py-1.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function formatDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function SubtaskCheck({ task }: { task: Task }) {
  const qc = useQueryClient();
  const done = task.status === "concluido";
  const toggle = useMutation({
    mutationFn: () =>
      updateTask(task.id, { status: done ? "em_andamento" : "concluido", completed: !done }),
    onSuccess: () => qc.invalidateQueries(),
    onError: () => toast.error("Não foi possível atualizar."),
  });
  return (
    <button
      type="button"
      aria-label={done ? "Reabrir subtarefa" : "Concluir subtarefa"}
      onClick={() => toggle.mutate()}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
        done ? "border-success bg-success text-white" : "border-input hover:border-success",
      )}
    >
      {done && <Check className="size-2.5" strokeWidth={3} />}
    </button>
  );
}

/** Vincula a mesma tarefa a vários projetos (visível em todos, sem duplicar). */
function TaskProjectsBlock({
  task,
  projects,
  taskProjects,
}: {
  task: Task;
  projects: Project[];
  taskProjects: TaskProject[];
}) {
  const qc = useQueryClient();
  const [pick, setPick] = useState("");
  const links = taskProjects.filter((l) => l.task_id === task.id);
  const linkedIds = new Set(links.map((l) => l.project_id));

  const add = useMutation({
    mutationFn: (projectId: string) => linkTaskToProject(task.id, projectId),
    onSuccess: () => {
      setPick("");
      qc.invalidateQueries();
      toast.success("Tarefa agora aparece neste projeto também.");
    },
    onError: () => toast.error("Não foi possível vincular ao projeto."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unlinkTaskFromProject(id),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Vínculo removido.");
    },
    onError: () => toast.error("Não foi possível remover o vínculo."),
  });

  if (projects.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <Link2 className="size-3.5" /> Projetos
      </h3>
      <ul className="flex flex-wrap items-center gap-1.5">
        {links.map((l) => {
          const p = projects.find((x) => x.id === l.project_id);
          return (
            <li
              key={l.id}
              className="flex items-center gap-1.5 rounded-full border border-border py-1 pr-1.5 pl-2.5 text-xs"
            >
              <span className={cn("size-2 rounded-[2px]", dotClass(p?.color))} />
              {p?.name ?? "Projeto"}
              <button
                onClick={() => remove.mutate(l.id)}
                aria-label="Remover do projeto"
                className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </li>
          );
        })}
        <li>
          <select
            aria-label="Adicionar a outro projeto"
            className="rounded-full border border-dashed border-input bg-transparent px-2.5 py-1 text-xs text-muted-foreground"
            value={pick}
            onChange={(e) => {
              setPick(e.target.value);
              if (e.target.value) add.mutate(e.target.value);
            }}
          >
            <option value="">+ Adicionar a projeto</option>
            {projects
              .filter((p) => !linkedIds.has(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </li>
      </ul>
    </section>
  );
}
