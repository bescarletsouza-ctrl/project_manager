import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarDays,
  Columns3,
  Copy,
  GanttChartSquare,
  LayoutGrid,
  List,
  Pencil,
  Play,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Table2,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Avatar, AvatarStack } from "@/components/Avatar";
import { Bar, EmptyState, Field, MetaItem, Modal, Pill, RowMenu, SectionTitle } from "@/components/ui-bits";
import { TaskPane } from "@/components/TaskPane";
import { AutomationsPanel } from "@/components/AutomationsPanel";
import { BoardView, CalendarView, ListView, TimelineView } from "@/components/project/ProjectViews";
import { useInvalidate, useWorkspaceData, nameById } from "@/lib/useData";
import { useAsanaData, useCurrentMember } from "@/lib/useAsana";
import { hasProjectAccess, useAccessRole } from "@/lib/access";
import { deleteProject, duplicateProject, updateProject } from "@/lib/data";
import {
  FIELD_TYPE_LABEL,
  TASK_COLUMNS,
  createCustomField,
  deleteCustomField,
  type CustomFieldType,
} from "@/lib/asana";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  PROJECT_STATUS,
  PROJECT_STATUS_LABEL,
  PROJECT_TYPES,
  PROJECT_TYPE_LABEL,
  STATUS_META,
  STATUS_ORDER,
  formatHours,
  hoursBetween,
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
      { title: "Projeto — Lista, Quadro, Timeline e Calendário — Alana" },
      {
        name: "description",
        content:
          "Gerencie o projeto em Lista, Quadro, Timeline ou Calendário, com seções, subtarefas, dependências, marcos, colunas configuráveis e automações.",
      },
      { property: "og:title", content: "Projeto — Alana" },
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
type ViewTabId = (typeof VIEWS)[number]["id"];

/**
 * Ordem das abas de visualização. Fica no localStorage por projeto — cada
 * pessoa arruma como prefere. Se a ordem salva estiver desatualizada (aba
 * removida ou adicionada em versão nova do app), completa com o restante na
 * ordem canônica sem descartar a preferência da pessoa.
 */
function useViewTabOrder(projectId: string): [ViewTabId[], (order: ViewTabId[]) => void] {
  const storageKey = `fluxo:view-order:${projectId}`;
  const canonical = VIEWS.map((v) => v.id) as ViewTabId[];
  const [order, setOrder] = useState<ViewTabId[]>(canonical);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setOrder(canonical);
        return;
      }
      const saved = JSON.parse(raw) as string[];
      const known = new Set(canonical);
      const filtered = saved.filter((id): id is ViewTabId => known.has(id as ViewTabId));
      const missing = canonical.filter((id) => !filtered.includes(id));
      setOrder([...filtered, ...missing]);
    } catch {
      setOrder(canonical);
    }
    // canonical é derivado de VIEWS (constante do módulo), não muda entre renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const update = (next: ViewTabId[]) => {
    setOrder(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* modo privado ou cota cheia: só afeta esta sessão */
    }
  };

  return [order, update];
}

const PANELS: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "cols", label: "Colunas e campos", icon: Table2 },
  { id: "auto", label: "Automações", icon: Zap },
  { id: "config", label: "Configuração", icon: Settings2 },
];

/**
 * Nome do projeto editável direto no cabeçalho — sem abrir "Editar projeto".
 * Manda só {name} no patch (as outras configurações não são tocadas).
 */
function EditableProjectName({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const invalidateProjects = useInvalidate(["projects"]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.name);

  const save = useMutation({
    mutationFn: (name: string) => updateProject(project.id, { name }),
    onSuccess: () => {
      invalidateProjects();
      setEditing(false);
    },
    onError: () => {
      toast.error("Não foi possível renomear o projeto.");
      setEditing(false);
    },
  });

  const commit = () => {
    if (save.isPending) return;
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error("O nome do projeto não pode ficar vazio.");
      setValue(project.name);
      setEditing(false);
      return;
    }
    if (trimmed === project.name) {
      setEditing(false);
      return;
    }
    save.mutate(trimmed);
  };

  const cancel = () => {
    setValue(project.name);
    setEditing(false);
  };

  if (!canEdit) {
    return <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>;
  }

  if (editing) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          autoFocus
          value={value}
          maxLength={120}
          disabled={save.isPending}
          aria-label="Nome do projeto"
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-ring bg-background px-1.5 py-0.5 text-xl font-semibold tracking-tight outline-none disabled:opacity-60"
        />
        {save.isPending && <span className="shrink-0 text-xs text-muted-foreground">Salvando…</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(project.name);
        setEditing(true);
      }}
      title="Clique para renomear"
      className="group -mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-secondary"
    >
      <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
      <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/**
 * Iniciar/Finalizar manual de projetos PONTUAIS (início e fim definidos) —
 * grava started_at/finished_at só pra medir a duração real de execução.
 * Projetos recorrentes nunca renderizam isso (o container já filtra por
 * project.tipo === "pontual" antes de montar este componente).
 */
function ProjectStartFinish({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const invalidateProjects = useInvalidate(["projects"]);

  const start = useMutation({
    mutationFn: () => updateProject(project.id, { started_at: new Date().toISOString() }),
    onSuccess: () => {
      invalidateProjects();
      toast.success("Projeto iniciado.");
    },
    onError: () => toast.error("Não foi possível iniciar o projeto."),
  });

  const finish = useMutation({
    // status: "concluido" junto — é o que move o projeto pro cluster de
    // Concluídos na lista de projetos (ver projetos.index.tsx).
    mutationFn: () => updateProject(project.id, { finished_at: new Date().toISOString(), status: "concluido" }),
    onSuccess: () => {
      invalidateProjects();
      toast.success("Projeto finalizado.");
    },
    onError: () => toast.error("Não foi possível finalizar o projeto."),
  });

  if (project.started_at && project.finished_at) {
    return <Pill tone="success">Duração: {formatHours(hoursBetween(project.started_at, project.finished_at))}</Pill>;
  }

  if (!canEdit) return null;

  if (project.started_at) {
    return (
      <button
        type="button"
        onClick={() =>
          confirm("Finalizar o projeto agora? Isso encerra a contagem de duração.") && finish.mutate()
        }
        disabled={finish.isPending}
        className="btn btn-outline gap-1.5"
      >
        <Square className="size-3.5" />
        {finish.isPending ? "Finalizando…" : "Finalizar"}
      </button>
    );
  }

  return (
    <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className="btn btn-outline gap-1.5">
      <Play className="size-3.5" />
      {start.isPending ? "Iniciando…" : "Iniciar"}
    </button>
  );
}

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  // Excluir/duplicar projeto é raro e mexe em muita coisa (tarefas, seções,
  // vínculos, automações, campos) — invalidar esse conjunto amplo aqui é
  // seguro; o ganho de performance da tela vem das ações frequentes
  // (editar campo, marcar concluído, arrastar), escopadas mais abaixo.
  const invalidateProjectCascade = useInvalidate([
    "projects",
    "tasks",
    "sections",
    "task_projects",
    "automations",
    "custom_fields",
    "task_field_values",
  ]);
  const { projects, tasks, members, departments, isLoading } = useWorkspaceData();
  const {
    sections,
    fields,
    fieldValues,
    comments,
    dependencies,
    portfolios,
    taskProjects,
    taskDepartments,
    automations,
    attachments,
  } = useAsanaData();
  const { member: currentMember, userId } = useCurrentMember();
  const { role, isAdmin } = useAccessRole();

  const [view, setView] = useState<ViewId>("list");
  const [tabOrder, setTabOrder] = useViewTabOrder(projectId);
  const [dragTab, setDragTab] = useState<ViewTabId | null>(null);
  const orderedViews = tabOrder
    .map((id) => VIEWS.find((v) => v.id === id))
    .filter((v): v is (typeof VIEWS)[number] => Boolean(v));
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [editing, setEditing] = useState(false);
  const [filters, setFilters] = useState({ term: "", assignee: "", status: "", hideDone: false, from: "", to: "" });

  const remove = useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => {
      invalidateProjectCascade();
      toast.success("Projeto excluído.");
      navigate({ to: "/projetos" });
    },
    onError: () => toast.error("Não foi possível excluir o projeto."),
  });

  const duplicate = useMutation({
    mutationFn: () => duplicateProject(projectId),
    onSuccess: (newId) => {
      invalidateProjectCascade();
      toast.success("Projeto duplicado.");
      // A duplicação já apaga cópia parcial em caso de erro (ver duplicateProject),
      // então aqui podemos navegar direto sem risco de mandar o usuário para um ID quebrado.
      navigate({ to: "/projetos/$projectId", params: { projectId: newId } });
    },
    onError: (e: unknown) =>
      toast.error(`Não foi possível duplicar: ${(e as { message?: string })?.message ?? "erro"}`),
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
      // Filtra por PRAZO (due_date), não por data de criação — sem isso,
      // De/Até parecia não fazer nada quando as tarefas foram todas criadas
      // no mesmo período mas com prazos espalhados. Sem prazo não entra
      // quando o filtro está ativo (não dá pra confirmar se cai no intervalo).
      if (filters.from && (!t.due_date || t.due_date < filters.from)) return false;
      if (filters.to && (!t.due_date || t.due_date > filters.to)) return false;
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
  const filtersOn = Boolean(filters.term || filters.assignee || filters.status || filters.hideDone || filters.from || filters.to);

  const team = members.filter((m) => projectTasks.some((t) => t.assignee_id === m.id));
  const hasAccess = hasProjectAccess(role, currentMember?.id ?? null, project, tasks, taskProjects);

  const viewProps = {
    projectId,
    project,
    sections: projectSections,
    // Lista completa de seções do workspace — a coluna "Seção" da Lista
    // precisa mostrar/editar seções de departamento também (mesma mescla
    // que o TaskPane já faz), não só as do projeto.
    allSections: sections,
    tasks: filtered,
    members,
    departments,
    fields: projectFields,
    fieldValues,
    // Lista completa (não só projectAutomations): uma tarefa pode ter
    // department_id além do project_id, e o runAutomations decide sozinho
    // (via containerMatches) quais regras de projeto E de departamento
    // se aplicam a cada tarefa. Mesmo padrão já usado no TaskPane.
    automations,
    sectionOf,
    onOpenTask: (t: Task) => setOpenTask(t),
    currentMemberId: currentMember?.id ?? null,
    taskProjects,
    taskDepartments,
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
          <div className="min-w-0 flex-1">
            <EditableProjectName project={project} canEdit={hasAccess} />
            <p className="text-xs text-muted-foreground">
              {health.done} de {health.total} tarefas · {health.progress}% concluído
              {project.due_date ? ` · entrega ${new Date(`${project.due_date}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
          <Pill tone={health.score >= 75 ? "success" : health.score >= 50 ? "warning" : "danger"}>{health.health}</Pill>
          <Pill>{PROJECT_STATUS_LABEL[project.status] ?? project.status}</Pill>

          <div className="ml-auto flex items-center gap-2">
            {team.length > 0 && <AvatarStack people={team} />}
            {project.tipo === "pontual" && <ProjectStartFinish project={project} canEdit={hasAccess} />}
            {hasAccess && (
              <button onClick={() => setEditing(true)} className="btn btn-outline">
                Editar projeto
              </button>
            )}
            <RowMenu
              actions={[
                ...(hasAccess ? PANELS.map((p) => ({ label: p.label, icon: p.icon, onSelect: () => setView(p.id) })) : []),
                ...(hasAccess
                  ? [
                      {
                        label: duplicate.isPending ? "Duplicando…" : "Duplicar projeto",
                        icon: Copy,
                        separatorBefore: true,
                        onSelect: () => {
                          if (duplicate.isPending) return;
                          if (
                            confirm(
                              `Duplicar "${project.name}"? A cópia leva tarefas, subtarefas, campos personalizados e configurações; comentários e histórico não são copiados.`,
                            )
                          ) {
                            duplicate.mutate();
                          }
                        },
                      },
                    ]
                  : []),
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

      {/* abas — arraste para reordenar; a preferência fica por projeto no navegador */}
      <nav className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {orderedViews.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            draggable
            onDragStart={(e) => {
              setDragTab(v.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDragTab(null)}
            onDragOver={(e) => {
              if (dragTab && dragTab !== v.id) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragTab || dragTab === v.id) return;
              const next = tabOrder.filter((id) => id !== dragTab);
              const at = next.indexOf(v.id);
              next.splice(at < 0 ? next.length : at, 0, dragTab);
              setTabOrder(next);
              setDragTab(null);
            }}
            title="Arraste para reordenar"
            className={cn(
              "-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] transition-colors",
              view === v.id
                ? "border-brand font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
              dragTab === v.id && "opacity-40",
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
          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Filtra por prazo (due_date)">
            De
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="field h-8 w-auto"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Filtra por prazo (due_date)">
            Até
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="field h-8 w-auto"
            />
          </label>
          {filtersOn && (
            <button
              onClick={() => setFilters({ term: "", assignee: "", status: "", hideDone: false, from: "", to: "" })}
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
              container={{ kind: "project", projectId }}
              automations={projectAutomations}
              members={members}
              sections={projectSections}
              projects={projects.filter((p) => p.id !== projectId)}
              fields={projectFields}
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
          taskDepartments={taskDepartments}
          automations={automations}
          attachments={attachments}
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
                      <Avatar name={assignee?.name} color={assignee?.avatar_color} src={assignee?.avatar_url} />
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
                  <Avatar name={m.name} color={m.avatar_color} src={m.avatar_url} />
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
  const invalidateProjects = useInvalidate(["projects"]);
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
      invalidateProjects();
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
  const invalidateProjects = useInvalidate(["projects"]);
  const saved = project.visible_columns ?? ["assignee", "due_date", "status"];
  const anyCustomPicked = saved.some((c) => c.startsWith("cf:"));
  const initial = anyCustomPicked ? saved : [...saved, ...fields.map((f) => `cf:${f.id}`)];
  const [selected, setSelected] = useState<string[]>(initial);

  const save = useMutation({
    mutationFn: () => updateProject(project.id, { visible_columns: selected }),
    onSuccess: () => {
      invalidateProjects();
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


/* ---------------- campos personalizados ---------------- */

function CustomFieldsPanel({
  projectId,
  fields,
}: {
  projectId: string;
  fields: { id: string; name: string; field_type: CustomFieldType; options: string[] }[];
}) {
  const invalidateFields = useInvalidate(["custom_fields"]);
  const invalidateFieldsCascade = useInvalidate(["custom_fields", "task_field_values"]);
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
      invalidateFields();
      toast.success("Campo criado.");
    },
    onError: () => toast.error("Não foi possível criar o campo."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCustomField(id),
    onSuccess: () => invalidateFieldsCascade(),
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
  const invalidateProjects = useInvalidate(["projects"]);
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
    tipo: project.tipo,
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
        tipo: form.tipo,
      }),
    onSuccess: () => {
      invalidateProjects();
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
        <Field label="Tipo de projeto" hint="Pontual ganha um botão pra medir a duração real (início → fim).">
          <select className="field w-full" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as typeof form.tipo })}>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROJECT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
