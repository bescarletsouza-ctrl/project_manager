import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarDays,
  Columns3,
  GanttChartSquare,
  LayoutGrid,
  List,
  Search,
  Settings2,
  SlidersHorizontal,
  Table2,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Avatar, AvatarStack } from "@/components/Avatar";
import { Bar, EmptyState, Field, MetaItem, Modal, Pill, RowMenu, SectionTitle } from "@/components/ui-bits";
import { TaskPane } from "@/components/TaskPane";
import { BoardView, CalendarView, ListView, TimelineView } from "@/components/project/ProjectViews";
import { useWorkspaceData, nameById } from "@/lib/useData";
import { useAsanaData, useCurrentMember } from "@/lib/useAsana";
import { hasProjectAccess, useAccessRole } from "@/lib/access";
import { deleteProject, updateProject } from "@/lib/data";
import {
  FIELD_TYPE_LABEL,
  TASK_COLUMNS,
  createAutomation,
  createCustomField,
  deleteAutomation,
  deleteCustomField,
  updateAutomation,
  type Automation,
  type CustomFieldType,
} from "@/lib/asana";
import { ACTION_LABEL, TRIGGER_LABEL, type AutoEvent } from "@/lib/automations";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  PROJECT_STATUS,
  PROJECT_STATUS_LABEL,
  STATUS_META,
  STATUS_ORDER,
  isLate,
  isOpen,
  projectHealth,
  type Member,
  type Priority,
  type Project,
  type Task,
} from "@/lib/domain";
import { COLOR_KEYS, dotClass, softClass } from "@/lib/colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/projetos/$projectId")({
  head: () => ({
    meta: [
      { title: "Projeto — Lista, Quadro, Timeline e Calendário — Fluxo" },
      {
        name: "description",
        content:
          "Gerencie o projeto em Lista, Quadro, Timeline ou Calendário, com seções, subtarefas, dependências, marcos, colunas configuráveis e automações.",
      },
      { property: "og:title", content: "Projeto — Fluxo" },
      { property: "og:description", content: "Colunas configuráveis, automações, dependências e campos personalizados." },
    ],
  }),
  component: ProjectDetail,
});

const VIEWS = [
  { id: "overview", label: "Visão geral", icon: LayoutGrid },
  { id: "list", label: "Lista", icon: List },
  { id: "board", label: "Quadro", icon: Columns3 },
  { id: "timeline", label: "Timeline", icon: GanttChartSquare },
  { id: "calendar", label: "Calendário", icon: CalendarDays },
] as const;

type ViewId = (typeof VIEWS)[number]["id"] | "cols" | "config" | "auto";

const PANELS: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "cols", label: "Colunas e campos", icon: Table2 },
  { id: "auto", label: "Automações", icon: Zap },
  { id: "config", label: "Configuração", icon: Settings2 },
];

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { projects, tasks, members, isLoading } = useWorkspaceData();
  const { sections, fields, fieldValues, comments, dependencies, portfolios, taskProjects, automations } =
    useAsanaData();
  const { member: currentMember, userId } = useCurrentMember();
  const { role, isAdmin } = useAccessRole();

  const [view, setView] = useState<ViewId>("list");
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [editing, setEditing] = useState(false);
  const [filters, setFilters] = useState({ term: "", assignee: "", status: "", hideDone: false });

  const remove = useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Projeto excluído.");
      navigate({ to: "/projetos" });
    },
    onError: () => toast.error("Não foi possível excluir o projeto."),
  });

  const project = projects.find((p) => p.id === projectId);

  const links = useMemo(() => taskProjects.filter((l) => l.project_id === projectId), [taskProjects, projectId]);
  const projectTasks = useMemo(() => {
    const linkedIds = new Set(links.map((l) => l.task_id));
    return tasks.filter((t) => linkedIds.has(t.id) || t.project_id === projectId);
  }, [tasks, links, projectId]);

  const filtered = useMemo(() => {
    const term = filters.term.trim().toLowerCase();
    return projectTasks.filter((t) => {
      if (term && !t.title.toLowerCase().includes(term)) return false;
      if (filters.assignee && t.assignee_id !== filters.assignee) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.hideDone && t.status === "concluido") return false;
      return true;
    });
  }, [projectTasks, filters]);

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  if (!project) {
    return (
      <EmptyState
        title="Projeto não encontrado"
        description="Ele pode ter sido excluído ou você não tem acesso."
        action={
          <Link to="/projetos" className="btn btn-outline">
            Voltar para projetos
          </Link>
        }
      />
    );
  }

  const projectSections = sections.filter((s) => s.project_id === projectId);
  const projectSectionIds = new Set(projectSections.map((s) => s.id));
  const firstSectionId = projectSections[0]?.id ?? "";
  const sectionOf = (t: Task) => {
    const link = links.find((l) => l.task_id === t.id);
    if (link?.section_id && projectSectionIds.has(link.section_id)) return link.section_id;
    if (t.section_id && projectSectionIds.has(t.section_id)) return t.section_id;
    // tarefa de outro projeto (ou sem seção): entra na 1ª seção do projeto
    return firstSectionId;
  };

  const projectFields = fields.filter((f) => f.project_id === projectId);
  const projectAutomations = automations.filter((a) => a.project_id === projectId);
  const health = projectHealth(project, projectTasks.map((t) => ({ ...t, project_id: projectId })));
  const live = openTask ? (tasks.find((t) => t.id === openTask.id) ?? null) : null;
  const filtersOn = Boolean(filters.term || filters.assignee || filters.status || filters.hideDone);

  const team = members.filter((m) => projectTasks.some((t) => t.assignee_id === m.id));
  const hasAccess = hasProjectAccess(role, currentMember?.id ?? null, project, tasks, taskProjects);

  const viewProps = {
    projectId,
    project,
    sections: projectSections,
    tasks: filtered,
    members,
    fields: projectFields,
    fieldValues,
    automations: projectAutomations,
    sectionOf,
    onOpenTask: (t: Task) => setOpenTask(t),
  };

  const showToolbar = view === "list" || view === "board" || view === "calendar" || view === "timeline";

  return (
    <div className="space-y-4">
      {/* cabeçalho */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link to="/projetos" className="hover:text-foreground hover:underline">
            Projetos
          </Link>
          {project.portfolio_id && (
            <>
              <span>/</span>
              <Link
                to="/portfolios/$portfolioId"
                params={{ portfolioId: project.portfolio_id }}
                className="hover:text-foreground hover:underline"
              >
                {nameById(portfolios, project.portfolio_id)}
              </Link>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg text-base font-semibold",
              softClass(project.color),
            )}
          >
            {project.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
            <p className="text-xs text-muted-foreground">
              {health.done} de {health.total} tarefas · {health.progress}% concluído
              {project.due_date ? ` · entrega ${new Date(`${project.due_date}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
          <Pill tone={health.score >= 75 ? "success" : health.score >= 50 ? "warning" : "danger"}>{health.health}</Pill>
          <Pill>{PROJECT_STATUS_LABEL[project.status] ?? project.status}</Pill>

          <div className="ml-auto flex items-center gap-2">
            {team.length > 0 && <AvatarStack people={team} />}
            {hasAccess && (
              <button onClick={() => setEditing(true)} className="btn btn-outline">
                Editar projeto
              </button>
            )}
            <RowMenu
              actions={[
                ...(hasAccess ? PANELS.map((p) => ({ label: p.label, icon: p.icon, onSelect: () => setView(p.id) })) : []),
                ...(isAdmin
                  ? [
                      {
                        label: "Excluir projeto",
                        icon: Trash2,
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () =>
                          confirm("Excluir este projeto e todas as tarefas?") ? remove.mutate() : undefined,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
      </div>

      {/* abas */}
      <nav className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] transition-colors",
              view === v.id
                ? "border-brand font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <v.icon className="size-4" /> {v.label}
          </button>
        ))}
        {PANELS.some((p) => p.id === view) && (
          <button
            className="-mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-brand px-3 py-2 text-[13.5px] font-medium"
            onClick={() => setView("list")}
          >
            <SlidersHorizontal className="size-4" />
            {PANELS.find((p) => p.id === view)?.label}
            <X className="size-3.5 text-muted-foreground" />
          </button>
        )}
      </nav>

      {/* barra de ferramentas */}
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filters.term}
              onChange={(e) => setFilters({ ...filters, term: e.target.value })}
              placeholder="Buscar tarefa"
              className="field h-8 w-48 pl-7"
            />
          </div>
          <select
            aria-label="Filtrar por responsável"
            value={filters.assignee}
            onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}
            className="field h-8 w-auto"
          >
            <option value="">Todos os responsáveis</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por status"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="field h-8 w-auto"
          >
            <option value="">Todos os status</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={filters.hideDone}
              onChange={(e) => setFilters({ ...filters, hideDone: e.target.checked })}
            />
            Ocultar concluídas
          </label>
          {filtersOn && (
            <button
              onClick={() => setFilters({ term: "", assignee: "", status: "", hideDone: false })}
              className="btn btn-ghost px-2 py-1 text-xs"
            >
              Limpar filtros
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} de {projectTasks.length} tarefas
          </span>
        </div>
      )}

      {view === "overview" && (
        <OverviewPanel project={project} tasks={projectTasks} members={members} onOpenTask={(t) => setOpenTask(t)} />
      )}
      {view === "list" && <ListView {...viewProps} />}
      {view === "board" && <BoardView {...viewProps} />}
      {view === "timeline" && <TimelineView {...viewProps} dependencies={dependencies} />}
      {view === "calendar" && <CalendarView {...viewProps} />}
      {/* Colunas, configuração e automações mexem no projeto — quem não tem
          acesso a ele (RLS barra a escrita mesmo assim) nem vê a tela. */}
      {!hasAccess && (view === "cols" || view === "config" || view === "auto") ? (
        <EmptyState title="Sem acesso a esta área" description="Fale com um administrador se precisar mexer aqui." />
      ) : (
        <>
          {view === "cols" && (
            <div className="space-y-4">
              <ColumnsPanel project={project} fields={projectFields} />
              <CustomFieldsPanel projectId={projectId} fields={projectFields} />
            </div>
          )}
          {view === "config" && <ProjectSettings project={project} members={members} />}
          {view === "auto" && (
            <AutomationsPanel
              projectId={projectId}
              automations={projectAutomations}
              members={members}
              sections={projectSections}
              projects={projects.filter((p) => p.id !== projectId)}
            />
          )}
        </>
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
          automations={automations}
          currentMember={currentMember}
          currentUserId={userId}
          onClose={() => setOpenTask(null)}
          onOpenTask={(t) => setOpenTask(t)}
        />
      )}

      {editing && (
        <EditProject
          project={project}
          portfolios={portfolios}
          members={members}
          onClose={() => setEditing(false)}
          onDelete={() => confirm("Excluir este projeto e todas as tarefas?") && remove.mutate()}
        />
      )}
    </div>
  );
}

/* ---------------- visão geral ---------------- */

function OverviewPanel({
  project,
  tasks,
  members,
  onOpenTask,
}: {
  project: Project;
  tasks: Task[];
  members: Member[];
  onOpenTask: (t: Task) => void;
}) {
  const health = projectHealth(project, tasks.map((t) => ({ ...t, project_id: project.id })));
  const upcoming = tasks
    .filter((t) => isOpen(t) && t.due_date)
    .slice()
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 6);

  const byStatus = STATUS_ORDER.map((s) => ({
    status: s,
    count: tasks.filter((t) => t.status === s).length,
  })).filter((x) => x.count > 0);

  const team = members.filter((m) => tasks.some((t) => t.assignee_id === m.id));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="card-surface space-y-2 p-4">
          <SectionTitle title="Sobre o projeto" />
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {project.description?.trim() || "Sem descrição ainda. Use “Editar projeto” para contar o que ele entrega."}
          </p>
        </div>

        <div className="card-surface space-y-3 p-4">
          <SectionTitle title="Progresso" description={`${health.done} de ${health.total} tarefas concluídas`} />
          <Bar value={health.progress} tone={health.score >= 75 ? "success" : health.score >= 50 ? "warning" : "danger"} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {byStatus.map((s) => (
              <Pill key={s.status} tone={STATUS_META[s.status]?.tone as never}>
                {STATUS_META[s.status]?.label}: {s.count}
              </Pill>
            ))}
            {health.late > 0 && <Pill tone="danger">{health.late} atrasadas</Pill>}
            {health.blocked > 0 && <Pill tone="warning">{health.blocked} bloqueadas</Pill>}
          </div>
        </div>

        <div className="card-surface overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <SectionTitle title="Próximas entregas" />
          </div>
          {upcoming.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Nenhuma tarefa aberta com prazo definido.</p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((t) => {
                const assignee = members.find((m) => m.id === t.assignee_id);
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => onOpenTask(t)}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-secondary/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                      <Pill tone={isLate(t) ? "danger" : "neutral"}>
                        {new Date(`${t.due_date}T12:00:00`).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </Pill>
                      <Avatar name={assignee?.name} color={assignee?.avatar_color} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card-surface space-y-3 p-4">
          <SectionTitle title="Detalhes" />
          <div className="grid grid-cols-2 gap-3">
            <MetaItem label="Status">{PROJECT_STATUS_LABEL[project.status] ?? project.status}</MetaItem>
            <MetaItem label="Prioridade">
              {PRIORITY_LABEL[project.priority as Priority] ?? project.priority}
            </MetaItem>
            <MetaItem label="Gestor">{nameById(members, project.manager_id)}</MetaItem>
            <MetaItem label="Saúde">{health.health}</MetaItem>
            <MetaItem label="Início">
              {project.start_date ? new Date(`${project.start_date}T12:00:00`).toLocaleDateString("pt-BR") : "—"}
            </MetaItem>
            <MetaItem label="Entrega">
              {project.due_date ? new Date(`${project.due_date}T12:00:00`).toLocaleDateString("pt-BR") : "—"}
            </MetaItem>
          </div>
        </div>

        <div className="card-surface space-y-2 p-4">
          <SectionTitle title="Equipe" description={`${team.length} pessoa(s) com tarefas neste projeto`} />
          <ul className="space-y-1.5 pt-1">
            {team.map((m) => {
              const mine = tasks.filter((t) => t.assignee_id === m.id);
              return (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <Avatar name={m.name} color={m.avatar_color} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {mine.filter(isOpen).length} abertas / {mine.length}
                  </span>
                </li>
              );
            })}
            {team.length === 0 && <li className="text-sm text-muted-foreground">Ninguém atribuído ainda.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------------- configuração do projeto ---------------- */

function ProjectSettings({ project, members }: { project: Project; members: Member[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    default_assignee_id: project.default_assignee_id ?? "",
    default_due_days: project.default_due_days?.toString() ?? "",
  });

  const save = useMutation({
    mutationFn: () =>
      updateProject(project.id, {
        default_assignee_id: form.default_assignee_id || null,
        default_due_days: form.default_due_days ? Number(form.default_due_days) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Configuração salva.");
    },
    onError: () => toast.error("Não foi possível salvar a configuração."),
  });

  return (
    <div className="card-surface max-w-2xl space-y-4 p-4">
      <SectionTitle
        title="Padrões de novas tarefas"
        description="Toda tarefa criada neste projeto já nasce com estes valores."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Responsável padrão">
          <select
            className="field w-full"
            value={form.default_assignee_id}
            onChange={(e) => setForm({ ...form, default_assignee_id: e.target.value })}
          >
            <option value="">Sem responsável</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prazo padrão (dias a partir de hoje)">
          <input
            type="number"
            min={0}
            max={365}
            placeholder="Ex.: 7"
            className="field w-full"
            value={form.default_due_days}
            onChange={(e) => setForm({ ...form, default_due_days: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn btn-primary">
          {save.isPending ? "Salvando..." : "Salvar configuração"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- colunas (padrão + personalizadas) ---------------- */

function ColumnsPanel({
  project,
  fields,
}: {
  project: Project;
  fields: { id: string; name: string; field_type: CustomFieldType }[];
}) {
  const qc = useQueryClient();
  const saved = project.visible_columns ?? ["assignee", "due_date", "status"];
  const anyCustomPicked = saved.some((c) => c.startsWith("cf:"));
  const initial = anyCustomPicked ? saved : [...saved, ...fields.map((f) => `cf:${f.id}`)];
  const [selected, setSelected] = useState<string[]>(initial);

  const save = useMutation({
    mutationFn: () => updateProject(project.id, { visible_columns: selected }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Colunas atualizadas.");
    },
    onError: () => toast.error("Não foi possível salvar as colunas."),
  });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((c) => c !== id) : [...s, id]));

  const chip = (id: string, label: string) => (
    <label
      key={id}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
        selected.includes(id) ? "border-brand bg-brand/10 text-foreground" : "border-border text-muted-foreground",
      )}
    >
      <input type="checkbox" className="size-3" checked={selected.includes(id)} onChange={() => toggle(id)} />
      {label}
    </label>
  );

  return (
    <div className="card-surface space-y-4 p-4">
      <SectionTitle title="Colunas visíveis" description="Escolha o que aparece na lista e no quadro." />
      <div className="flex flex-wrap gap-2">{TASK_COLUMNS.map((c) => chip(c.id, c.label))}</div>

      <div className="space-y-2 border-t border-border pt-4">
        <SectionTitle
          title="Colunas personalizadas"
          description="Campos personalizados deste projeto exibidos como colunas."
        />
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma coluna personalizada ainda — crie uma abaixo.</p>
        ) : (
          <div className="flex flex-wrap gap-2">{fields.map((f) => chip(`cf:${f.id}`, f.name))}</div>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn btn-primary">
          {save.isPending ? "Salvando..." : "Salvar colunas"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- automações ---------------- */

function AutomationsPanel({
  projectId,
  automations,
  members,
  sections,
  projects,
}: {
  projectId: string;
  automations: Automation[];
  members: Member[];
  sections: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    trigger_type: "task_created" as AutoEvent,
    trigger_value: "",
    action_type: "set_status",
    action_value: "",
  });

  const add = useMutation({
    mutationFn: () =>
      createAutomation({
        project_id: projectId,
        name: form.name.trim(),
        trigger_type: form.trigger_type,
        trigger_value: form.trigger_value || null,
        action_type: form.action_type,
        action_value: form.action_value || null,
      }),
    onSuccess: () => {
      setForm({ name: "", trigger_type: "task_created", trigger_value: "", action_type: "set_status", action_value: "" });
      qc.invalidateQueries();
      toast.success("Automação criada.");
    },
    onError: () => toast.error("Não foi possível criar a automação."),
  });

  const toggle = useMutation({
    mutationFn: (a: Automation) => updateAutomation(a.id, { active: !a.active }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: () => qc.invalidateQueries(),
  });

  const actionOptions = () => {
    switch (form.action_type) {
      case "set_status":
        return STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label }));
      case "set_assignee":
        return members.map((m) => ({ value: m.id, label: m.name }));
      case "set_priority":
        return PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
      case "move_section":
      case "set_section":
        return sections.map((s) => ({ value: s.id, label: s.name }));
      case "move_project":
      case "add_project":
        return projects.map((p) => ({ value: p.id, label: p.name }));
      default:
        return null;
    }
  };
  const options = actionOptions();

  const describe = (a: Automation) => {
    const trigger = TRIGGER_LABEL[a.trigger_type as AutoEvent] ?? a.trigger_type;
    const cond = a.trigger_value ? ` (${STATUS_META[a.trigger_value as Task["status"]]?.label ?? a.trigger_value})` : "";
    const action = ACTION_LABEL[a.action_type] ?? a.action_type;
    const value =
      a.action_type === "set_assignee"
        ? (members.find((m) => m.id === a.action_value)?.name ?? "—")
        : a.action_type === "move_section" || a.action_type === "set_section"
          ? (sections.find((s) => s.id === a.action_value)?.name ?? "—")
          : a.action_type === "move_project" || a.action_type === "add_project"
            ? (projects.find((p) => p.id === a.action_value)?.name ?? "—")
            : (a.action_value ?? "");
    return `${trigger}${cond} → ${action} ${value}`.trim();
  };

  return (
    <div className="card-surface space-y-4 p-4">
      <SectionTitle
        title="Automações"
        description="Regras que rodam quando a tarefa é criada ou muda de status/responsável."
      />
      <ul className="divide-y divide-border">
        {automations.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{a.name}</p>
              <p className="truncate text-xs text-muted-foreground">{describe(a)}</p>
            </div>
            <button
              onClick={() => toggle.mutate(a)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                a.active ? "border-success/40 bg-success/10 text-success" : "border-border text-muted-foreground",
              )}
            >
              {a.active ? "Ativa" : "Pausada"}
            </button>
            <button
              onClick={() => remove.mutate(a.id)}
              aria-label="Excluir automação"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {automations.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nenhuma automação ainda.</li>}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim().length < 3) {
            toast.error("Dê um nome à automação.");
            return;
          }
          add.mutate();
        }}
        className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          placeholder="Nome da regra"
          maxLength={80}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="field w-full"
        />
        <select
          aria-label="Gatilho"
          value={form.trigger_type}
          onChange={(e) => setForm({ ...form, trigger_type: e.target.value as AutoEvent, trigger_value: "" })}
          className="field w-full"
        >
          {(Object.keys(TRIGGER_LABEL) as AutoEvent[]).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="Condição"
          value={form.trigger_value}
          onChange={(e) => setForm({ ...form, trigger_value: e.target.value })}
          disabled={form.trigger_type !== "status_changed"}
          className="field w-full"
        >
          <option value="">Qualquer status</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <select
          aria-label="Ação"
          value={form.action_type}
          onChange={(e) => setForm({ ...form, action_type: e.target.value, action_value: "" })}
          className="field w-full"
        >
          {Object.keys(ACTION_LABEL).map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
        {options ? (
          <select
            aria-label="Valor da ação"
            value={form.action_value}
            onChange={(e) => setForm({ ...form, action_value: e.target.value })}
            className="field w-full"
          >
            <option value="">Selecione…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Valor da ação"
            placeholder={form.action_type === "notify_assignee" ? "—" : "Valor"}
            value={form.action_value}
            disabled={form.action_type === "notify_assignee"}
            onChange={(e) => setForm({ ...form, action_value: e.target.value })}
            className="field w-full"
          />
        )}
        <button className="btn btn-primary lg:col-span-5">Criar automação</button>
      </form>
    </div>
  );
}

/* ---------------- campos personalizados ---------------- */

function CustomFieldsPanel({
  projectId,
  fields,
}: {
  projectId: string;
  fields: { id: string; name: string; field_type: CustomFieldType; options: string[] }[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", field_type: "text" as CustomFieldType, options: "" });

  const add = useMutation({
    mutationFn: () =>
      createCustomField({
        project_id: projectId,
        name: form.name.trim(),
        field_type: form.field_type,
        options: form.options
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      setForm({ name: "", field_type: "text", options: "" });
      qc.invalidateQueries();
      toast.success("Campo criado.");
    },
    onError: () => toast.error("Não foi possível criar o campo."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCustomField(id),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="card-surface space-y-3 p-4">
      <SectionTitle title="Campos personalizados" description="Valem para todas as tarefas deste projeto." />
      <ul className="flex flex-wrap gap-2">
        {fields.map((f) => (
          <li key={f.id} className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
            <span className="font-medium">{f.name}</span>
            <span className="text-muted-foreground">{FIELD_TYPE_LABEL[f.field_type]}</span>
            <button
              onClick={() => remove.mutate(f.id)}
              aria-label={`Excluir campo ${f.name}`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          </li>
        ))}
        {fields.length === 0 && <li className="text-sm text-muted-foreground">Nenhum campo ainda.</li>}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim().length < 2) return;
          add.mutate();
        }}
        className="grid gap-2 sm:grid-cols-4"
      >
        <input
          placeholder="Nome do campo"
          maxLength={60}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="field w-full"
        />
        <select
          aria-label="Tipo do campo"
          value={form.field_type}
          onChange={(e) => setForm({ ...form, field_type: e.target.value as CustomFieldType })}
          className="field w-full"
        >
          {(Object.keys(FIELD_TYPE_LABEL) as CustomFieldType[]).map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <input
          placeholder="Opções (separadas por vírgula)"
          value={form.options}
          onChange={(e) => setForm({ ...form, options: e.target.value })}
          disabled={form.field_type !== "select"}
          className="field w-full"
        />
        <button className="btn btn-primary">Adicionar campo</button>
      </form>
    </div>
  );
}

/* ---------------- editar projeto ---------------- */

function EditProject({
  project,
  portfolios,
  members,
  onClose,
  onDelete,
}: {
  project: Project;
  portfolios: { id: string; name: string }[];
  members: { id: string; name: string }[];
  onClose: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? "",
    portfolio_id: project.portfolio_id ?? "",
    manager_id: project.manager_id ?? "",
    status: project.status,
    priority: project.priority,
    start_date: project.start_date ?? "",
    due_date: project.due_date ?? "",
    color: project.color ?? "indigo",
  });

  const save = useMutation({
    mutationFn: () =>
      updateProject(project.id, {
        name: form.name.trim(),
        description: form.description,
        portfolio_id: form.portfolio_id || null,
        manager_id: form.manager_id || null,
        status: form.status,
        priority: form.priority,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        color: form.color,
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Projeto atualizado.");
      onClose();
    },
    onError: () => toast.error("Não foi possível salvar."),
  });

  return (
    <Modal
      title="Editar projeto"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onDelete} className="btn btn-ghost mr-auto text-destructive">
            Excluir projeto
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button
            onClick={() => form.name.trim().length >= 3 && save.mutate()}
            disabled={save.isPending}
            className="btn btn-primary"
          >
            {save.isPending ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      <Field label="Nome">
        <input
          value={form.name}
          maxLength={120}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="field w-full"
        />
      </Field>
      <Field label="Descrição">
        <textarea
          value={form.description}
          maxLength={1000}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="field h-20 w-full"
        />
      </Field>
      <Field label="Cor">
        <div className="flex flex-wrap gap-1.5 pt-1">
          {COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setForm({ ...form, color: c })}
              className={cn(
                "size-6 rounded-md ring-offset-2 ring-offset-background transition",
                dotClass(c),
                form.color === c && "ring-2 ring-foreground/40",
              )}
            />
          ))}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Portfólio">
          <select
            className="field w-full"
            value={form.portfolio_id}
            onChange={(e) => setForm({ ...form, portfolio_id: e.target.value })}
          >
            <option value="">Sem portfólio</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gestor">
          <select
            className="field w-full"
            value={form.manager_id}
            onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
          >
            <option value="">Sem gestor</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="field w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {PROJECT_STATUS.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prioridade">
          <select
            className="field w-full"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Início">
          <input
            type="date"
            className="field w-full"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
        </Field>
        <Field label="Entrega">
          <input
            type="date"
            className="field w-full"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}
