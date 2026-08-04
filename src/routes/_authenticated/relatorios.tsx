import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionTitle, StatCard } from "@/components/ui-bits";
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
  timeInStatus,
  timeToStart,
  type TaskStatus,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios operacionais — Fluxo" },
      {
        name: "description",
        content:
          "Lead time, cycle time, throughput, velocity, SLA, retrabalho e produtividade por equipe, projeto e cliente.",
      },
      { property: "og:title", content: "Relatórios operacionais — Fluxo" },
      { property: "og:description", content: "Indicadores completos e exportação em CSV." },
    ],
  }),
  component: ReportsPage,
});

type Group = "colaborador" | "departamento" | "projeto" | "cliente";

function ReportsPage() {
  const { tasks, members, departments, projects, clients, events, isLoading } = useWorkspaceData();
  const [group, setGroup] = useState<Group>("colaborador");

  const rows = useMemo(() => {
    const dims =
      group === "colaborador"
        ? members.map((m) => ({ id: m.id, name: m.name, key: "assignee_id" as const }))
        : group === "departamento"
          ? departments.map((d) => ({ id: d.id, name: d.name, key: "department_id" as const }))
          : group === "projeto"
            ? projects.map((p) => ({ id: p.id, name: p.name, key: "project_id" as const }))
            : clients.map((c) => ({ id: c.id, name: c.name, key: "client_id" as const }));

    return dims.map((d) => {
      const list = tasks.filter((t) => t[d.key] === d.id);
      const done = list.filter(isDone);
      const onTime = done.filter((t) => !isLate(t));
      return {
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
  }, [group, tasks, members, departments, projects, clients]);

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const done = tasks.filter(isDone);
  const statusTimes = STATUS_ORDER.map((s) => {
    const totals = tasks.map((t) => timeInStatus(events, t)[s]).filter(Boolean) as number[];
    return { name: STATUS_META[s].label, horas: totals.length ? Number(avg(totals)!.toFixed(1)) : 0 };
  }).filter((s) => s.horas > 0);

  const stalled = tasks.filter((t) => isOpen(t) && daysWithoutMovement(events, t) > 5).length;

  function exportCsv() {
    const header = Object.keys(rows[0] ?? { name: "" }).join(";");
    const body = rows
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
        <div className="flex gap-2">
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
          <SectionTitle title={`Produtividade por ${group}`} />
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
              <tr key={r.name} className="border-t border-border">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-surface p-4">
          <SectionTitle title="Tempo médio por status" description="Onde estão os gargalos do processo" />
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusTimes} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis type="category" dataKey="name" fontSize={11} width={130} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <RBar dataKey="horas" fill="var(--chart-3)" radius={[0, 4, 4, 0]} />
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
