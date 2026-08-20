import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { useQuery } from "@tanstack/react-query";
import { sectionsQuery, taskDepartmentsQuery } from "@/lib/asana";
import { taskFieldActivityQuery } from "@/lib/data";
import { requireRole } from "@/lib/access";
import { useWorkspaceData, nameById, taskDepartmentIdsOf } from "@/lib/useData";
import { cn } from "@/lib/utils";
import {
  STATUS_META,
  STATUS_ORDER,
  avg,
  cycleTime,
  daysWithoutMovement,
  formatHours,
  hoursBetween,
  isDone,
  isLate,
  isOpen,
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

/** Maior contagem de um mapa id→total, resolvido pro nome via a lista de referência (departments/members). */
function topEntry(counts: Map<string, number>, list: { id: string; name: string }[]): { name: string; count: number } | null {
  let bestId: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  if (!bestId) return null;
  const name = list.find((x) => x.id === bestId)?.name ?? "—";
  return { name, count: bestCount };
}

function ReportsPage() {
  const { tasks: allTasks, members, departments, projects, clients, events, isLoading } = useWorkspaceData();
  const taskDepartments = useQuery(taskDepartmentsQuery).data ?? [];
  const fieldActivity = useQuery(taskFieldActivityQuery).data ?? [];
  const sections = useQuery(sectionsQuery).data ?? [];
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

  /** Departamento é multi-valorado (task_departments); os outros grupos continuam 1-pra-1. */
  const matchesDim = (t: Task, dim: { id: string; key: "assignee_id" | "department_id" | "project_id" | "client_id" }) =>
    dim.key === "department_id" ? taskDepartmentIdsOf(t, taskDepartments).includes(dim.id) : t[dim.key] === dim.id;

  const rows = useMemo(() => {
    return dims.map((d) => {
      const list = tasks.filter((t) => matchesDim(t, d));
      const done = list.filter(isDone);
      const onTime = done.filter((t) => !isLate(t));
      const unplannedTasks = list.filter((t) => t.unplanned);
      return {
        id: d.id,
        name: d.name,
        total: list.length,
        concluidas: done.length,
        pontos: done.reduce((s, t) => s + t.complexity, 0),
        atrasadas: list.filter(isLate).length,
        bloqueadas: list.filter((t) => t.status === "bloqueado").length,
        naoPlanejadas: unplannedTasks.length,
        naoPlanejadasPct: list.length ? pct(unplannedTasks.length, list.length) : 0,
        prazo: done.length ? pct(onTime.length, done.length) : 0,
        leadTime: avg(done.map(leadTime)),
        cycleTime: avg(done.map(cycleTime)),
        inicio: avg(list.map(timeToStart)),
        retrabalho: list.length ? pct(list.filter((t) => t.reopen_count > 0).length, list.length) : 0,
        unplannedTasks,
      };
    });
  }, [dims, tasks, taskDepartments]);

  const openRow = (dimId: string, name: string) => {
    const dim = dims.find((d) => d.id === dimId);
    if (!dim) return;
    openSelection(`Tarefas — ${name}`, tasks.filter((t) => matchesDim(t, dim)));
  };

  const openUnplannedRow = (dimId: string, name: string) => {
    const row = rows.find((r) => r.id === dimId);
    if (row) openSelection(`Fora do planejamento — ${name}`, row.unplannedTasks);
  };

  const projectCharts = useMemo(() => {
    if (group !== "projeto") return [];
    return projects.map((p) => {
      const list = tasks.filter((t) => t.project_id === p.id);
      const done = list.filter(isDone);
      return {
        id: p.id,
        name: p.name,
        volume: list.length,
        cycleTime: avg(done.map(cycleTime)) ?? 0,
        tasks: list,
      };
    });
  }, [group, projects, tasks]);

  /**
   * Duração, % atrasadas e "quem mais pesa" (departamento/responsável com
   * mais tarefas) por projeto. Duração só existe pra projeto "pontual" (tem
   * started_at/finished_at, ver botão Iniciar/Finalizar no projeto) —
   * recorrente não tem início/fim real, então mostra "—" em vez de inventar
   * um número. "Quem mais pesa" usa o departamento PRINCIPAL da tarefa
   * (task.department_id), não os secundários — evita contar a mesma tarefa
   * em mais de um departamento na hora de decidir quem carrega mais.
   */
  const projectBurden = useMemo(() => {
    if (group !== "projeto") return [];
    return projects.map((p) => {
      const list = tasks.filter((t) => t.project_id === p.id);
      const pctAtrasadas = list.length ? pct(list.filter(isLate).length, list.length) : null;

      let duracaoLabel = "—";
      if (p.tipo === "pontual") {
        if (p.started_at && p.finished_at) {
          duracaoLabel = formatHours(hoursBetween(p.started_at, p.finished_at));
        } else if (p.started_at) {
          duracaoLabel = `${formatHours(hoursBetween(p.started_at, new Date().toISOString()))} (em andamento)`;
        } else {
          duracaoLabel = "Não iniciado";
        }
      }

      const deptCounts = new Map<string, number>();
      const memberCounts = new Map<string, number>();
      for (const t of list) {
        if (t.department_id) deptCounts.set(t.department_id, (deptCounts.get(t.department_id) ?? 0) + 1);
        if (t.assignee_id) memberCounts.set(t.assignee_id, (memberCounts.get(t.assignee_id) ?? 0) + 1);
      }
      const topDept = topEntry(deptCounts, departments);
      const topMember = topEntry(memberCounts, members);

      return { id: p.id, name: p.name, duracaoLabel, pctAtrasadas, topDept, topMember, tasks: list };
    });
  }, [group, projects, tasks, departments, members]);

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const done = tasks.filter(isDone);
  /** Planejadas x fora do planejamento entre as concluídas — mede o impacto de verdade (o que já foi entregue), não só o que está aberto/na fila. */
  const unplannedDone = done.filter((t) => t.unplanned);
  const plannedDone = done.filter((t) => !t.unplanned);
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
    const csvRows = rows.map(({ id: _id, unplannedTasks: _u, ...rest }) => rest);
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
        <StatCard
          label="Fora do planejamento"
          value={`${done.length ? pct(unplannedDone.length, done.length) : 0}%`}
          hint="das concluídas · criadas fora de uma seção de planejamento"
          tone="warning"
        />
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
              <th className="px-4 py-2 font-medium">Fora do plan.</th>
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
                <td
                  className={cn("px-4 py-2 tabular-nums", r.naoPlanejadas > 0 && "text-warning")}
                  onClick={(e) => {
                    if (!r.naoPlanejadas) return;
                    e.stopPropagation();
                    openUnplannedRow(r.id, r.name);
                  }}
                  title={r.naoPlanejadas ? "Ver tarefas fora do planejamento" : undefined}
                >
                  {r.naoPlanejadas} {r.naoPlanejadas > 0 && <span className="text-muted-foreground">({r.naoPlanejadasPct}%)</span>}
                </td>
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

      <UnplannedPanel group={group} rows={rows} plannedDone={plannedDone} unplannedDone={unplannedDone} onSelectDim={openUnplannedRow} />

      {group === "projeto" && <ProjectChartsPanel data={projectCharts} onSelect={openSelection} />}
      {group === "projeto" && <ProjectBurdenPanel data={projectBurden} onSelect={openSelection} />}

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
        {Math.round(avg(members.map((m) => personMetrics(m, tasks, fieldActivity, sections).index)) ?? 0)} / 100 — referência operacional, não
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
  tasks: Task[];
};

/** Volume e cycle time médio por projeto. */
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
    </div>
  );
}

type ProjectBurdenRow = {
  id: string;
  name: string;
  duracaoLabel: string;
  pctAtrasadas: number | null;
  topDept: { name: string; count: number } | null;
  topMember: { name: string; count: number } | null;
  tasks: Task[];
};

/** Duração real (projeto pontual), % de atrasadas e quem mais pesa (departamento/responsável com mais tarefas) — por projeto. */
function ProjectBurdenPanel({
  data,
  onSelect,
}: {
  data: ProjectBurdenRow[];
  onSelect: (title: string, tasks: Task[]) => void;
}) {
  return (
    <div className="card-surface overflow-x-auto">
      <div className="p-4">
        <SectionTitle
          title="Duração, atraso e carga por projeto"
          description="Duração só existe pra projeto pontual (botão Iniciar/Finalizar); recorrente mostra '—'. Clique numa linha para ver as tarefas."
        />
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground uppercase">
          <tr>
            <th className="px-4 py-2 font-medium">Projeto</th>
            <th className="px-4 py-2 font-medium">Duração</th>
            <th className="px-4 py-2 font-medium">% atrasadas</th>
            <th className="px-4 py-2 font-medium">Departamento que mais pesa</th>
            <th className="px-4 py-2 font-medium">Responsável que mais pesa</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(`Tarefas — ${r.name}`, r.tasks)}
              className="cursor-pointer border-t border-border hover:bg-secondary/50"
            >
              <td className="px-4 py-2 font-medium">{r.name}</td>
              <td className="px-4 py-2 tabular-nums">{r.duracaoLabel}</td>
              <td className={cn("px-4 py-2 tabular-nums", r.pctAtrasadas !== null && r.pctAtrasadas > 20 && "text-destructive")}>
                {r.pctAtrasadas === null ? "—" : `${r.pctAtrasadas}%`}
              </td>
              <td className="px-4 py-2">{r.topDept ? `${r.topDept.name} (${r.topDept.count})` : "—"}</td>
              <td className="px-4 py-2">{r.topMember ? `${r.topMember.name} (${r.topMember.count})` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type UnplannedRow = { id: string; name: string; naoPlanejadas: number };

/**
 * Painel de "fora do planejamento" — troca junto com o seletor de agrupamento
 * da página (colaborador/departamento/projeto/cliente), então responde direto
 * a "quem é mais impactado" sem precisar de gráfico dedicado por dimensão.
 */
function UnplannedPanel({
  group,
  rows,
  plannedDone,
  unplannedDone,
  onSelectDim,
}: {
  group: Group;
  rows: UnplannedRow[];
  plannedDone: Task[];
  unplannedDone: Task[];
  onSelectDim: (id: string, name: string) => void;
}) {
  const chartData = rows.filter((r) => r.naoPlanejadas > 0).sort((a, b) => b.naoPlanejadas - a.naoPlanejadas);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card-surface p-4">
        <SectionTitle
          title={`Fora do planejamento por ${group}`}
          description='Tarefas criadas numa seção "Não planejado" — clique numa barra pra ver quais'
        />
        <div className="mt-4 h-64">
          {chartData.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Nenhuma tarefa fora do planejamento no período.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
                <YAxis type="category" dataKey="name" fontSize={11} width={100} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <RBar
                  dataKey="naoPlanejadas"
                  name="Fora do planejamento"
                  fill="var(--chart-4)"
                  radius={[0, 4, 4, 0]}
                  className="cursor-pointer"
                  onClick={(d: unknown) => {
                    const row = d as { payload?: UnplannedRow };
                    if (row.payload) onSelectDim(row.payload.id, row.payload.name);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card-surface p-4">
        <SectionTitle
          title="Impacto na produtividade"
          description="Concluídas planejadas x fora do planejamento, no período"
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <ImpactCol label="Planejadas" tasks={plannedDone} />
          <ImpactCol label="Fora do planejamento" tasks={unplannedDone} warn />
        </div>
      </div>
    </div>
  );
}

/** Coluna de métricas (concluídas, pontos, lead/cycle time, % no prazo) pra um recorte de tarefas concluídas. */
function ImpactCol({ label, tasks, warn }: { label: string; tasks: Task[]; warn?: boolean }) {
  const onTime = tasks.filter((t) => !isLate(t));
  return (
    <div className={cn("rounded-lg border p-3 text-sm", warn ? "border-warning/40 bg-warning/5" : "border-border")}>
      <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
      <dl className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Concluídas</dt>
          <dd className="font-medium tabular-nums">{tasks.length}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Pontos</dt>
          <dd className="font-medium tabular-nums">{tasks.reduce((s, t) => s + t.complexity, 0)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Lead time</dt>
          <dd className="font-medium tabular-nums">{formatHours(avg(tasks.map(leadTime)))}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Cycle time</dt>
          <dd className="font-medium tabular-nums">{formatHours(avg(tasks.map(cycleTime)))}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">No prazo</dt>
          <dd className="font-medium tabular-nums">{tasks.length ? pct(onTime.length, tasks.length) : 0}%</dd>
        </div>
      </dl>
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
