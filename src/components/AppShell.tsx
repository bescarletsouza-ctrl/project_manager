import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronsLeft,
  FolderKanban,
  Gauge,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar } from "@/components/Avatar";
import { NewProjectDialog, NewTaskDialog } from "@/components/dialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { projectsQuery, tasksQuery } from "@/lib/data";
import { notificationsQuery, portfoliosQuery } from "@/lib/asana";
import { useCurrentMember } from "@/lib/useAsana";
import { dotClass } from "@/lib/colors";
import { isOpen, type Project, type Task } from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Rotas sem parâmetros usadas na navegação lateral. */
type StaticRoute =
  | "/minhas-tarefas"
  | "/caixa-de-entrada"
  | "/tarefas"
  | "/dashboard"
  | "/relatorios"
  | "/workload"
  | "/pessoas"
  | "/projetos"
  | "/portfolios"
  | "/configuracoes";

const MAIN_NAV = [
  { to: "/minhas-tarefas", label: "Minhas Tarefas", icon: CheckCircle2 },
  { to: "/caixa-de-entrada", label: "Caixa de entrada", icon: Inbox },
  { to: "/tarefas", label: "Todas as tarefas", icon: ListChecks },
] as const;

const INSIGHTS_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/workload", label: "Workload", icon: Gauge },
  { to: "/pessoas", label: "Produtividade", icon: Users },
] as const;

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const isDark = saved ? saved === "dark" : false;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);
  const toggle = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };
  return { dark, toggle };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState<"task" | "project" | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border bg-sidebar md:flex",
          collapsed ? "w-[60px]" : "w-[248px]",
        )}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onCreateProject={() => setCreating("project")}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-foreground/30" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex w-[268px] border-r border-sidebar-border bg-sidebar">
            <SidebarContent
              collapsed={false}
              onClose={() => setMobileOpen(false)}
              onCreateProject={() => {
                setMobileOpen(false);
                setCreating("project");
              }}
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={() => setMobileOpen(true)} onCreate={(kind) => setCreating(kind)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-7">{children}</div>
        </main>
      </div>

      {creating === "task" && <NewTaskDialog onClose={() => setCreating(null)} />}
      {creating === "project" && <NewProjectDialog onClose={() => setCreating(null)} />}
    </div>
  );
}

/* ---------------------------- sidebar ---------------------------- */

function SidebarContent({
  collapsed,
  onToggleCollapse,
  onClose,
  onCreateProject,
}: {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
  onCreateProject: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projects = useQuery(projectsQuery).data ?? [];
  const portfolios = useQuery(portfoliosQuery).data ?? [];
  const notifications = useQuery(notificationsQuery).data ?? [];
  const { member } = useCurrentMember();

  const unread = member
    ? notifications.filter((n) => n.member_id === member.id && !n.read_at && !n.archived_at).length
    : 0;

  const [open, setOpen] = useState({ insights: true, projects: true, portfolios: false });

  return (
    <div className="flex h-full w-full flex-col">
      <div className={cn("flex h-14 items-center gap-2.5 px-3", collapsed && "justify-center px-0")}>
        <Link to="/minhas-tarefas" className="flex items-center gap-2.5" aria-label="Início">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand text-[13px] font-bold text-brand-foreground">
            F
          </span>
          {!collapsed && <span className="text-[15px] font-semibold tracking-tight">Fluxo</span>}
        </Link>
        {!collapsed && onClose && (
          <button onClick={onClose} aria-label="Fechar menu" className="btn btn-ghost ml-auto p-1.5">
            <X className="size-4" />
          </button>
        )}
        {!collapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label="Recolher menu"
            className="btn btn-ghost ml-auto p-1.5"
            title="Recolher menu"
          >
            <ChevronsLeft className="size-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {MAIN_NAV.map((item) => (
          <NavItem
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            collapsed={collapsed}
            active={pathname.startsWith(item.to)}
            badge={item.to === "/caixa-de-entrada" && unread > 0 ? unread : undefined}
          />
        ))}

        {collapsed ? (
          <div className="space-y-0.5 pt-2">
            {INSIGHTS_NAV.map((item) => (
              <NavItem
                key={item.to}
                to={item.to}
                label={item.label}
                icon={item.icon}
                collapsed
                active={pathname.startsWith(item.to)}
              />
            ))}
            <NavItem to="/projetos" label="Projetos" icon={FolderKanban} collapsed active={pathname.startsWith("/projetos")} />
          </div>
        ) : (
          <>
            <Group
              label="Insights"
              open={open.insights}
              onToggle={() => setOpen((o) => ({ ...o, insights: !o.insights }))}
            >
              {INSIGHTS_NAV.map((item) => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  collapsed={false}
                  active={pathname.startsWith(item.to)}
                />
              ))}
            </Group>

            <Group
              label="Projetos"
              open={open.projects}
              onToggle={() => setOpen((o) => ({ ...o, projects: !o.projects }))}
              action={
                <button
                  onClick={onCreateProject}
                  aria-label="Novo projeto"
                  title="Novo projeto"
                  className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              }
            >
              {projects.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum projeto ainda</p>
              )}
              {projects.slice(0, 12).map((p) => (
                <Link
                  key={p.id}
                  to="/projetos/$projectId"
                  params={{ projectId: p.id }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                    pathname === `/projetos/${p.id}` && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                  )}
                >
                  <span className={cn("size-2.5 shrink-0 rounded-[3px]", dotClass(p.color))} />
                  <span className="truncate">{p.name}</span>
                </Link>
              ))}
              <Link
                to="/projetos"
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <FolderKanban className="size-3.5" /> Ver todos os projetos
              </Link>
            </Group>

            <Group
              label="Portfólios"
              open={open.portfolios}
              onToggle={() => setOpen((o) => ({ ...o, portfolios: !o.portfolios }))}
            >
              {portfolios.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum portfólio ainda</p>
              )}
              {portfolios.map((p) => (
                <Link
                  key={p.id}
                  to="/portfolios/$portfolioId"
                  params={{ portfolioId: p.id }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                    pathname === `/portfolios/${p.id}` && "bg-sidebar-accent font-medium",
                  )}
                >
                  <span className={cn("size-2.5 shrink-0 rounded-full", dotClass(p.color))} />
                  <span className="truncate">{p.name}</span>
                </Link>
              ))}
            </Group>
          </>
        )}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <NavItem
          to="/configuracoes"
          label="Configurações"
          icon={Settings}
          collapsed={collapsed}
          active={pathname.startsWith("/configuracoes")}
        />
        {collapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label="Expandir menu"
            className="mt-0.5 flex w-full items-center justify-center rounded-md px-2 py-2 text-muted-foreground hover:bg-sidebar-accent"
          >
            <ChevronsLeft className="size-4 rotate-180" />
          </button>
        )}
      </div>
    </div>
  );
}

function Group({
  label,
  open,
  onToggle,
  action,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-3">
      <div className="flex items-center gap-1 px-2">
        <button
          onClick={onToggle}
          className="flex flex-1 items-center gap-1 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
          <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
          {label}
        </button>
        {action}
      </div>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  collapsed,
  active,
  badge,
}: {
  to: StaticRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
  active: boolean;
  badge?: number | undefined;
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-2 text-[13.5px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-brand")} />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge ? (
        <span className="ml-auto rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

/* ---------------------------- topbar ---------------------------- */

function TopBar({
  onOpenMenu,
  onCreate,
}: {
  onOpenMenu: () => void;
  onCreate: (kind: "task" | "project") => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dark, toggle } = useTheme();
  const { member, email } = useCurrentMember();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-6">
      <button onClick={onOpenMenu} aria-label="Abrir menu" className="btn btn-ghost p-2 md:hidden">
        <Menu className="size-4" />
      </button>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger className="btn btn-brand">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Criar</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => onCreate("task")} className="gap-2 text-sm">
              <CheckCircle2 className="size-4" /> Tarefa
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCreate("project")} className="gap-2 text-sm">
              <FolderKanban className="size-4" /> Projeto
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button onClick={toggle} aria-label="Alternar tema" className="btn btn-ghost p-2">
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Conta" className="rounded-full">
            <Avatar name={member?.name ?? email ?? null} color={member?.avatar_color} size="md" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">
              <span className="block text-sm font-medium">{member?.name ?? "Minha conta"}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{email ?? "—"}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate({ to: "/configuracoes" })} className="gap-2 text-sm">
              <Settings className="size-4" /> Configurações
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={signOut} className="gap-2 text-sm text-destructive focus:text-destructive">
              <LogOut className="size-4" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/** Busca global de projetos e tarefas (Ctrl/Cmd + K). */
function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const projects = useQuery(projectsQuery).data ?? [];
  const tasks = useQuery(tasksQuery).data ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo<{ projects: Project[]; tasks: Task[] }>(() => {
    const q = term.trim().toLowerCase();
    if (q.length < 2) return { projects: [], tasks: [] };
    return {
      projects: projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 4),
      tasks: tasks.filter((t) => isOpen(t) && t.title.toLowerCase().includes(q)).slice(0, 6),
    };
  }, [term, projects, tasks]);

  const goToTask = (projectId: string | null) => {
    setOpen(false);
    setTerm("");
    if (projectId) navigate({ to: "/projetos/$projectId", params: { projectId } });
    else navigate({ to: "/tarefas" });
  };

  const total = results.projects.length + results.tasks.length;

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar projetos e tarefas"
        className="field h-9 w-full rounded-full border-transparent bg-secondary pl-8 focus:bg-background"
      />
      {open && term.trim().length >= 2 && (
        <div className="card-raised absolute top-11 left-0 z-50 max-h-[60vh] w-full overflow-y-auto p-1.5">
          {total === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">Nada encontrado para “{term}”.</p>}
          {results.projects.length > 0 && (
            <>
              <p className="px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Projetos
              </p>
              {results.projects.map((p) => (
                <button
                  key={p.id}
                  onMouseDown={() => {
                    setOpen(false);
                    setTerm("");
                    navigate({ to: "/projetos/$projectId", params: { projectId: p.id } });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
                >
                  <span className={cn("size-2.5 shrink-0 rounded-[3px]", dotClass(p.color))} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </>
          )}
          {results.tasks.length > 0 && (
            <>
              <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Tarefas
              </p>
              {results.tasks.map((t) => (
                <button
                  key={t.id}
                  onMouseDown={() => goToTask(t.project_id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
                >
                  <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                    {projects.find((p) => p.id === t.project_id)?.name ?? "—"}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
