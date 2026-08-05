import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TasksByPersonChart } from "@/components/dashboard/TasksByPersonChart";
import { requireRole } from "@/lib/access";
import { StatCard, SectionTitle, StatusBadge, Pill, Bar } from "@/components/ui-bits";
import { useWorkspaceData, nameById } from "@/lib/useData";
import {
  STATUS_META,
  STATUS_ORDER,
  avg,
  cycleTime,
  daysWithoutMovement,
  formatHours,
  isDone,
  isLate,
  isOpen,
  leadTime,
  pct,
  personMetrics,
  projectHealth,
  timeToStart,
  type TaskStatus,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "visualizador"]),
  head: () => ({
    meta: [
      { title: "Dashboard executivo — Fluxo" },
      {
        name: "description",
        content:
          "Indicadores de projetos, tarefas, prazos, gargalos e produtividade da operação em tempo real.",
      },
      { property: "og:title", content: "Dashboard executivo — Fluxo" },
      { property: "og:description", content: "Visão geral da operação e da produtividade da equipe." },
    ],
  }),
  component: Dashboard,
});

const PERIODS = [
  { key: "7", label: "7 dias" },
  { key: "15", label: "15 dias" },
  { key: "30", label: "30 dias" },
  { key: "90", label: "Trimestre" },
  { key: "all", label: "Tudo" },
];

function Dashboard() {
  const { tasks, projects, members, departments, events, isLoading } = useWorkspaceData();
  const [period, setPeriod] = useState("30");

  const filtered = useMemo(() => {
    if (period === "all") return tasks;
    const days = Number(period);
    const from = Date.now() - days * 24 * 3600 * 1000;
    return tasks.filter((t) => new Date(t.created_at).getTime() >= from);
  }, [tasks, period]);

  if (isLoading) return <SkeletonGrid />;

  const done = filtered.filter(isDone);
  const open = filtered.filter(isOpen);
  const late = filtered.filter(isLate);
  const blocked = filtered.filter((t) => t.status === "bloqueado");
  const onTime = done.filter((t) => !isLate(t));

  const byStatus = STATUS_ORDER.map((s) => ({
    name: STATUS_META[s].label,
    value: filtered.filter((t) => t.status === s).length,
  })).filter((d) => d.value > 0);

  const byDepartment = departments.map((d) => ({
    name: d.name,
    abertas: filtered.filter((t) => t.department_id === d.id && isOpen(t)).length,
    concluidas: filtered.filter((t) => t.department_id === d.id && isDone(t)).length,
  }));

  const evolution = buildEvolution(done);

  const attention = {
    stalled: filtered
      .filter((t) => isOpen(t) && daysWithoutMovement(events, t) > 5)
      .slice(0, 6),
    riskProjects: projects
      .map((p) => ({ p, h: projectHealth(p, tasks) }))
      .filter((x) => x.h.score < 70)
      .sort((a, b) => a.h.score - b.h.score)
      .slice(0, 4),
    overloaded: members
      .map((m) => personMetrics(m, tasks))
      .filter((m) => m.load >= 0.85)
      .sort((a, b) => b.load - a.load)
      .slice(0, 4),
  };

  const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard executivo</h1>
          <p className="text-sm text-muted-foreground">
            Tempos calculados automaticamente pelo histórico de movimentações — sem cronômetro.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-border p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${period === p.key ? "bg-secondary" : "text-muted-foreground"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Projetos ativos" value={projects.filter((p) => !["concluido", "cancelado"].includes(p.status)).length} />
        <StatCard label="Tarefas abertas" value={open.length} />
        <StatCard label="Tarefas atrasadas" value={late.length} tone={late.length ? "danger" : "success"} hint={`${pct(late.length, filtered.length)}%`} />
        <StatCard label="Bloqueadas" value={blocked.length} tone={blocked.length ? "warning" : "success"} />
        <StatCard label="Taxa de conclusão" value={`${pct(done.length, filtered.length)}%`} />
        <StatCard label="Cumprimento de prazo" value={`${done.length ? pct(onTime.length, done.length) : 0}%`} tone="success" />
        <StatCard label="Tempo médio de conclusão" value={formatHours(avg(done.map(leadTime)))} hint="Lead time" />
        <StatCard label="Tempo médio até iniciar" value={formatHours(avg(filtered.map(timeToStart)))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-surface p-4 lg:col-span-2">
          <SectionTitle title="Evolução das entregas" description="Tarefas e pontos concluídos por semana" />
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolution}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="tarefas" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="pontos" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-surface p-4">
          <SectionTitle title="Distribuição por status" />
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byStatus} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {byStatus.map((_, i) => (
                    <Cell key={i} fill={chartColors[i % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <TasksByPersonChart tasks={filtered} members={members} projects={projects} />

      <div className="card-surface p-4">
        <SectionTitle title="Demanda por departamento" />
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDepartment}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <Legend />
              <RBar dataKey="abertas" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <RBar dataKey="concluidas" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-surface p-4">
          <SectionTitle title="Atenção do gestor" description="Tarefas sem movimentação há mais de 5 dias" />
          <ul className="mt-3 space-y-2">
            {attention.stalled.length === 0 && <li className="text-sm text-muted-foreground">Nenhuma tarefa parada.</li>}
            {attention.stalled.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{t.title}</span>
                <Pill tone="warning">{Math.round(daysWithoutMovement(events, t))}d</Pill>
              </li>
            ))}
          </ul>
        </div>

        <div className="card-surface p-4">
          <SectionTitle title="Projetos em risco" />
          <ul className="mt-3 space-y-3">
            {attention.riskProjects.map(({ p, h }) => (
              <li key={p.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <Link to="/projetos" className="truncate hover:underline">
                    {p.name}
                  </Link>
                  <Pill tone={h.score >= 50 ? "warning" : "danger"}>{h.health}</Pill>
                </div>
                <Bar value={h.progress} />
                <p className="text-xs text-muted-foreground">
                  {h.progress}% concluído · {h.late} atrasadas · {h.blocked} bloqueadas
                </p>
              </li>
            ))}
            {attention.riskProjects.length === 0 && (
              <li className="text-sm text-muted-foreground">Todos os projetos saudáveis.</li>
            )}
          </ul>
        </div>

        <div className="card-surface p-4">
          <SectionTitle title="Colaboradores sobrecarregados" />
          <ul className="mt-3 space-y-3">
            {attention.overloaded.map((m) => (
              <li key={m.member.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate">{m.member.name}</span>
                  <Pill tone={m.load >= 1.15 ? "danger" : "warning"}>{m.loadLabel}</Pill>
                </div>
                <Bar value={m.load * 100} />
                <p className="text-xs text-muted-foreground">
                  {m.open} tarefas abertas · {m.openPoints} pts / {m.member.capacity_points} pts
                </p>
              </li>
            ))}
            {attention.overloaded.length === 0 && (
              <li className="text-sm text-muted-foreground">Nenhuma sobrecarga detectada.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="p-4">
          <SectionTitle title="Tarefas críticas" description="Atrasadas ou bloqueadas com maior prioridade" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Tarefa</th>
                <th className="px-4 py-2 font-medium">Responsável</th>
                <th className="px-4 py-2 font-medium">Projeto</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Prazo</th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .filter((t) => isOpen(t) && (isLate(t) || t.status === "bloqueado"))
                .slice(0, 8)
                .map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="max-w-[280px] truncate px-4 py-2">{t.title}</td>
                    <td className="px-4 py-2">{nameById(members, t.assignee_id)}</td>
                    <td className="px-4 py-2">{nameById(projects, t.project_id)}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={t.status as TaskStatus} />
                    </td>
                    <td className="px-4 py-2 text-destructive">{t.due_date ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Cycle time médio das entregas: {formatHours(avg(done.map(cycleTime)))} · Throughput no período:{" "}
        {done.length} tarefas · Velocity: {done.reduce((s, t) => s + t.complexity, 0)} pontos.
      </p>
    </div>
  );
}

function buildEvolution(done: { completed_at: string | null; complexity: number }[]) {
  const weeks: Record<string, { tarefas: number; pontos: number }> = {};
  for (const t of done) {
    if (!t.completed_at) continue;
    const d = new Date(t.completed_at);
    const key = `${d.getFullYear()}-W${String(Math.ceil(((+d - +new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, "0")}`;
    weeks[key] = weeks[key] ?? { tarefas: 0, pontos: 0 };
    weeks[key].tarefas += 1;
    weeks[key].pontos += t.complexity;
  }
  return Object.entries(weeks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, v]) => ({ label: label.split("-")[1], ...v }));
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card-surface h-24 animate-pulse" />
      ))}
    </div>
  );
}
