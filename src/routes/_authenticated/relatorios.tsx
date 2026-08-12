import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionTitle, StatCard } from "@/components/ui-bits";
import { DrilldownPanel, type Selection } from "@/components/dashboard/DrilldownPanel";
import { requireRole } from "@/lib/access";
import { useWorkspaceData, nameById } from "@/lib/useData";
import { sectionsQuery } from "@/lib/asana";
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
  isUnplannedSectionName,
  leadTime,
  pct,
  personMetrics,
  timeInStatus,
  timeToStart,
  type Task,
  type TaskStatus,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/relatorios")({
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "visualizador"]),
  head: () => ({
    meta: [
      { title: "Relatórios operacionais — Alana" },
      {
        name: "description",
        content:
          "Lead time, cycle time, throughput, velocity, SLA, retrabalho e produtividade por equipe, projeto e cliente.",
      },
      { property: "og:title", content: "Relatórios operacionais — Alana" },
      { property: "og:description", content: "Indicadores completos e exportação em CSV." },
    ],
  }),
  component: ReportsPage,
});

type Group = "colaborador" | "departamento" | "projeto" | "cliente";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function ReportsPage() {
  const { tasks: allTasks, members, departments, projects, clients, events, isLoading } = useWorkspaceData();
  const sectionsQ = useQuery(sectionsQuery);
  const sections = sectionsQ.data ?? [];
  const [group, setGroup] = useState<Group>("colaborador");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selection, setSelection] = useState<Selection>(null);

  const tasks = useMemo(
    () =>
      allTasks.filter((t) => {
        // Tarefa aberta (inclui atrasada/bloqueada) sempre conta, não importa quando foi
        // criada — são pendências de AGORA, filtrar por período de criação as esconderia
        // do relatório inteiro (não só da coluna "Atrasadas"). O filtro de data só decide
        // que tarefas JÁ CONCLUÍDAS/CANCELADAS entram na foto do período escolhido.
        if (isOpen(t)) return true;
        const d = t.created_at.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      }),
    [allTasks, dateFrom, dateTo],
  );

  const openSelection = (title: string, list: Task[]) => setSelection({ title, tasks: list });

  const dims = useMemo(
    () =>
      group === "colaborador"
        ? members.map((m) => ({ id: m.id, name: m.name, key: "assignee_id" as const }))
        : group === "departamento"
          ? departments.map((d) => ({ id: d.id, name: d.name, key: "department_id" as const }))
          : group === "projeto"
            ? projects.map((p) => ({ id: p.id, name: p.name, key: "project_id" as const }))
            : clients.map((c) => ({ id: c.id, name: c.name, key: "client_id" as const })),
    [group, members, departments, projects, clients],
  );

  const rows = useMemo(() => {
    return dims.map((d) => {
      const list = tasks.filter((t) => t[d.key] === d.id);
      const done = list.filter(isDone);
      const onTime = done.filter((t) => !isLate(t));
      return {
        id: d.id,
        name: d.name,
        total: list.length,
        concluidas: done.length,
        pontos: done.reduce((s, t) => s + t.complexity, 0),
        atrasadas: list.filter(isLate).length,
        bloqueadas: list.filter((t) => t.status === "bloqueado").length,
        prazo: done.length ? pct(onTime.length, done.length) : 0,
        leadTime: avg(done.map(leadTime)),
        cycleTime: avg(done.map(cycleTime)),
        inicio: avg(list.map(timeToStart)),
        retrabalho: list.length ? pct(list.filter((t) => t.reopen_count > 0).length, list.length) : 0,
      };
    });
  }, [dims, tasks]);

  const openRow = (dimId: string, name: string) => {
    const dim = dims.find((d) => d.id === dimId);
    if (!dim) return;
    openSelection(`Tarefas — ${name}`, tasks.filter((t) => t[dim.key] === dimId));
  };

  const projectCharts = useMemo(() => {
    if (group !== "projeto") return [];
    return projects.map((p) => {
      const list = tasks.filter((t) => t.project_id === p.id);
      const done = list.filter(isDone);
      const unplannedSectionIds = new Set(
        sections.filter((s) => s.project_id === p.id && isUnplannedSectionName(s.name)).map((s) => s.id),
      );
      const unplannedTasks = list.filter((t) => t.section_id && unplannedSectionIds.has(t.section_id));
      return {
        id: p.id,
        name: p.name,
        volume: list.length,
        cycleTime: avg(done.map(cycleTime)) ?? 0,
        naoPlanejadas: unplannedTasks.length,
        tasks: list,
        unplannedTasks,
      };
    });
  }, [group, projects, tasks, sections]);

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const done = tasks.filter(isDone);
  const statusTimes = STATUS_ORDER.map((s) => {
    const totals = tasks.map((t) => timeInStatus(events, t)[s]).filter(Boolean) as number[];
    return {
      status: s,
      name: STATUS_META[s].label,
      horas: totals.length ? Number(avg(totals)!.toFixed(1)) : 0,
    };
  }).filter((s) => s.horas > 0);

  const stalled = tasks.filter((t) => isOpen(t) && daysWithoutMovement(events, t) > 5).length;

  function exportCsv() {
    const csvRows = rows.map(({ id: _id, ...rest }) => rest);
    const header = Object.keys(csvRows[0] ?? { name: "" }).join(";");
    const body = csvRows
      .map((r) =>
        Object.values(r)
          .map((v) => (typeof v === "number" ? v.toFixed(1).replace(".", ",") : (v ?? "")))
          .join(";"),
      )
      .join("\n");
    const blob = new Blob([`\ufeff${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${group}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            Indicadores derivados das movimentações registradas — sem apontamento de horas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            De
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-2 text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Até
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-2 text-xs"
            />
          </label>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="rounded-md border border-input px-2.5 py-2 text-xs hover:bg-secondary"
            >
              Limpar
            </button>
          )}
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value as Group)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="colaborador">Por colaborador</option>
            <option value="departamento">Por departamento</option>
            <option value="projeto">Por projeto</option>
            <option value="cliente">Por cliente</option>
          </select>
          <button onClick={exportCsv} className="rounded-md border border-input px-3 py-2 text-sm hover:bg-secondary">
            Exportar CSV
          </button>
          <button onClick={() => window.print()} className="rounded-md border border-input px-3 py-2 text-sm hover:bg-secondary">
            Exportar PDF
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Throughput" value={done.length} hint="tarefas concluídas" />
        <StatCard label="Velocity" value={done.reduce((s, t) => s + t.complexity, 0)} hint="pontos" tone="info" />
        <StatCard label="Lead time médio" value={formatHours(avg(done.map(leadTime)))} />
        <StatCard label="Cycle time médio" value={formatHours(avg(done.map(cycleTime)))} />
        <StatCard label="SLA cumprido" value={`${done.length ? pct(done.filter((t) => !isLate(t)).length, done.length) : 0}%`} tone="success" />
        <StatCard label="SLA não cumprido" value={`${done.length ? pct(done.filter(isLate).length, done.length) : 0}%`} tone="danger" />
        <StatCard label="Retrabalho" value={`${pct(tasks.filter((t) => t.reopen_count > 0).length, tasks.length || 1)}%`} tone="warning" />
        <StatCard label="Sem movimentação (+5d)" value={stalled} tone={stalled ? "warning" : "success"} />
      </div>

      <div className="card-surface overflow-x-auto">
        <div className="p-4">
          <SectionTitle title={`Produtividade por ${group}`} description="Clique numa linha para ver as tarefas" />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Tarefas</th>
              <th className="px-4 py-2 font-medium">Concluídas</th>
              <th className="px-4 py-2 font-medium">Pontos</th>
              <th className="px-4 py-2 font-medium">Atrasadas</th>
              <th className="px-4 py-2 font-medium">Bloqueadas</th>
              <th className="px-4 py-2 font-medium">Prazo</th>
              <th className="px-4 py-2 font-medium">Lead time</th>
              <th className="px-4 py-2 font-medium">Cycle time</th>
              <th className="px-4 py-2 font-medium">Até iniciar</th>
              <th className="px-4 py-2 font-medium">Retrabalho</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => openRow(r.id, r.name)}
                className="cursor-pointer border-t border-border hover:bg-secondary/50"
              >
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="px-4 py-2 tabular-nums">{r.total}</td>
                <td className="px-4 py-2 tabular-nums">{r.concluidas}</td>
                <td className="px-4 py-2 tabular-nums">{r.pontos}</td>
                <td className="px-4 py-2 tabular-nums">{r.atrasadas}</td>
                <td className="px-4 py-2 tabular-nums">{r.bloqueadas}</td>
                <td className="px-4 py-2 tabular-nums">{r.prazo}%</td>
                <td className="px-4 py-2 tabular-nums">{formatHours(r.leadTime)}</td>
                <td className="px-4 py-2 tabular-nums">{formatHours(r.cycleTime)}</td>
                <td className="px-4 py-2 tabular-nums">{formatHours(r.inicio)}</td>
                <td className="px-4 py-2 tabular-nums">{r.retrabalho}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {group === "projeto" && <ProjectChartsPanel data={projectCharts} onSelect={openSelection} />}

      <DrilldownPanel selection={selection} onClose={() => setSelection(null)} members={members} projects={projects} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-surface p-4">
          <SectionTitle title="Tempo médio por status" description="Onde estão os gargalos do processo — clique numa barra para ver as tarefas" />
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusTimes} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis type="category" dataKey="name" fontSize={11} width={130} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <RBar
                  dataKey="horas"
                  fill="var(--chart-3)"
                  radius={[0, 4, 4, 0]}
                  className="cursor-pointer"
                  onClick={(d: unknown) => {
                    const row = d as { payload?: { status: TaskStatus; name: string } };
                    if (row.payload) {
                      openSelection(
                        `Tarefas — ${row.payload.name}`,
                        tasks.filter((t) => t.status === row.payload!.status),
                      );
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-surface p-4">
          <SectionTitle title="Burnup de entregas" description="Acúmulo de pontos concluídos" />
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={burnup(done)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="acumulado" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Índice de produtividade da equipe:{" "}
        {Math.round(avg(members.map((m) => personMetrics(m, tasks).index)) ?? 0)} / 100 — referência operacional, não
        avaliação isolada de desempenho.
      </p>
    </div>
  );
}

type ProjectChartRow = {
  id: string;
  name: string;
  volume: number;
  cycleTime: number;
  naoPlanejadas: number;
  tasks: Task[];
  unplannedTasks: Task[];
};

/** Volume, cycle time médio e tarefas fora do planejamento (seção "Não planejado"), por projeto. */
function ProjectChartsPanel({
  data,
  onSelect,
}: {
  data: ProjectChartRow[];
  onSelect: (title: string, tasks: Task[]) => void;
}) {
  const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
  const openAll = (d: unknown) => {
    const row = d as { payload?: ProjectChartRow };
    if (row.payload) onSelect(`Tarefas — ${row.payload.name}`, row.payload.tasks);
  };
  const openUnplanned = (d: unknown) => {
    const row = d as { payload?: ProjectChartRow };
    if (row.payload) onSelect(`Fora do planejamento — ${row.payload.name}`, row.payload.unplannedTasks);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card-surface p-4">
        <SectionTitle title="Volume por projeto" description="Quantas tarefas cada projeto tem" />
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
              <YAxis type="category" dataKey="name" fontSize={11} width={100} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <RBar dataKey="volume" name="Tarefas" radius={[0, 4, 4, 0]} className="cursor-pointer" onClick={openAll}>
                {data.map((_, i) => (
                  <Cell key={i} fill={chartColors[i % chartColors.length]} />
                ))}
              </RBar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card-surface p-4">
        <SectionTitle title="Cycle time por projeto" description="Tempo médio para terminar uma tarefa — clique para ver as concluídas" />
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis type="category" dataKey="name" fontSize={11} width={100} stroke="var(--muted-foreground)" />
              <Tooltip
                formatter={(v: number) => formatHours(v)}
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
              />
              <RBar
                dataKey="cycleTime"
                name="Cycle time (h)"
                fill="var(--chart-2)"
                radius={[0, 4, 4, 0]}
                className="cursor-pointer"
                onClick={(d: unknown) => {
                  const row = d as { payload?: ProjectChartRow };
                  if (row.payload) onSelect(`Concluídas — ${row.payload.name}`, row.payload.tasks.filter(isDone));
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card-surface p-4">
        <SectionTitle title="Fora do planejamento por projeto" description='Tarefas na seção "Não planejado"' />
        <div className="mt-4 h-64">
          {data.every((d) => d.naoPlanejadas === 0) ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Nenhuma seção "Não planejado" com tarefas.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
                <YAxis type="category" dataKey="name" fontSize={11} width={100} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <RBar
                  dataKey="naoPlanejadas"
                  name="Não planejadas"
                  fill="var(--chart-4)"
                  radius={[0, 4, 4, 0]}
                  className="cursor-pointer"
                  onClick={openUnplanned}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function burnup(done: { completed_at: string | null; complexity: number }[]) {
  const byDay: Record<string, number> = {};
  for (const t of done) {
    if (!t.completed_at) continue;
    const key = t.completed_at.slice(0, 10);
    byDay[key] = (byDay[key] ?? 0) + t.complexity;
  }
  let acc = 0;
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, v]) => {
      acc += v;
      return { label: label.slice(5), acumulado: acc };
    });
}
