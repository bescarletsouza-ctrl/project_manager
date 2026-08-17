import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Bar, MetaItem, Pill, SectionTitle, StatCard } from "@/components/ui-bits";
import { useWorkspaceData, nameById, initials } from "@/lib/useData";
import { formatHours, isOpen, personMetrics } from "@/lib/domain";
import { requireRole } from "@/lib/access";

export const Route = createFileRoute("/_authenticated/pessoas")({
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "visualizador"]),
  head: () => ({
    meta: [
      { title: "Produtividade por colaborador — Alana" },
      {
        name: "description",
        content:
          "Painel individual de produtividade: entregas, pontos de complexidade, prazos, retrabalho e velocidade.",
      },
      { property: "og:title", content: "Produtividade por colaborador — Alana" },
      { property: "og:description", content: "Complexidade, prazos, retrabalho e capacidade — sem controle de horas." },
    ],
  }),
  component: PeoplePage,
});

const SORTS = [
  { key: "done", label: "Mais entregas" },
  { key: "points", label: "Mais pontos" },
  { key: "onTimeRate", label: "Melhor prazo" },
  { key: "avgCycle", label: "Menor tempo médio" },
  { key: "reworkRate", label: "Menor retrabalho" },
  { key: "index", label: "Índice de produtividade" },
] as const;

function PeoplePage() {
  const { members, tasks: allTasks, departments, isLoading } = useWorkspaceData();
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("index");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  /**
   * Aberta sempre conta (é pendência de agora, filtrar por data de criação
   * a esconderia do painel inteiro) — o filtro decide só quais tarefas JÁ
   * CONCLUÍDAS/CANCELADAS entram na foto do período. Mesma regra já usada
   * em Relatórios.
   */
  const tasks = useMemo(
    () =>
      allTasks.filter((t) => {
        if (isOpen(t)) return true;
        const d = t.created_at.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      }),
    [allTasks, dateFrom, dateTo],
  );

  const metrics = useMemo(() => {
    const list = members.map((m) => personMetrics(m, tasks));
    return list.sort((a, b) => {
      if (sort === "avgCycle") return (a.avgCycle ?? 1e9) - (b.avgCycle ?? 1e9);
      if (sort === "reworkRate") return a.reworkRate - b.reworkRate;
      return (b[sort] as number) - (a[sort] as number);
    });
  }, [members, tasks, sort]);

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const selected = metrics.find((m) => m.member.id === selectedId) ?? metrics[0];
  const teamAvgPoints = metrics.length
    ? Math.round(metrics.reduce((s, m) => s + m.points, 0) / metrics.length)
    : 0;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium tracking-tight">Produtividade</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            A comparação considera complexidade, prazo, velocidade e retrabalho — nunca apenas o volume de tarefas.
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
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                Ordenar: {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {metrics.map((m) => (
          <button
            key={m.member.id}
            onClick={() => setSelectedId(m.member.id)}
            className={
              "row-card row-card-hover w-full text-left " +
              (m.member.id === selected?.member.id ? "border-primary/40 bg-accent/40" : "")
            }
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {initials(m.member.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium">{m.member.name}</p>
                <Pill tone={m.load >= 1.15 ? "danger" : m.load >= 0.85 ? "warning" : "success"}>
                  {m.loadLabel}
                </Pill>
                {m.lateOpen > 0 && (
                  <Pill tone="danger">
                    {m.lateOpen} atrasada{m.lateOpen > 1 ? "s" : ""}
                  </Pill>
                )}
              </div>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {nameById(departments, m.member.department_id)} · {m.done} entregas · {m.points} pts
              </p>
            </div>
            <div className="hidden gap-8 lg:grid lg:grid-cols-4">
              <MetaItem label="No prazo">{m.onTimeRate}%</MetaItem>
              <MetaItem label="Tempo médio">{formatHours(m.avgCycle)}</MetaItem>
              <MetaItem label="Retrabalho">{m.reworkRate}%</MetaItem>
              <MetaItem label="Índice">
                <span className="font-medium tabular-nums">{m.index}</span>
              </MetaItem>
            </div>
          </button>
        ))}
      </div>


      {selected && (
        <div className="space-y-4">
          <SectionTitle
            title={`Painel individual — ${selected.member.name}`}
            description={`${selected.member.job_title ?? ""} · média da equipe: ${teamAvgPoints} pontos`}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Tarefas recebidas" value={selected.total} />
            <StatCard label="Concluídas" value={selected.done} hint={`${selected.points} pts`} tone="success" />
            <StatCard label="Abertas" value={selected.open} hint={`${selected.openPoints} pts`} />
            <StatCard label="Atrasadas" value={selected.lateOpen} tone={selected.lateOpen ? "danger" : "success"} />
            <StatCard label="Bloqueadas" value={selected.blocked} tone="warning" />
            <StatCard label="Reaberturas" value={selected.reopened} />
            <StatCard label="Revisões" value={selected.reviews} />
            <StatCard label="Índice de produtividade" value={selected.index} hint="0-100" tone="info" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card-surface p-4">
              <SectionTitle title="Tempos médios" description="Calculados pelo histórico de movimentações" />
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <TimeBox label="Até iniciar" value={formatHours(selected.avgToStart)} />
                <TimeBox label="Cycle time" value={formatHours(selected.avgCycle)} />
                <TimeBox label="Lead time" value={formatHours(selected.avgLead)} />
              </div>
              <div className="mt-5 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Carga atual: {selected.openPoints} de {selected.member.capacity_points} pontos
                </p>
                <Bar value={selected.load * 100} />
              </div>
            </div>

            <div className="card-surface p-4">
              <SectionTitle title="Perfil de desempenho" />
              <div className="mt-2 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart
                    data={[
                      { k: "Entregas", v: Math.min(100, selected.done * 8) },
                      { k: "Complexidade", v: Math.min(100, selected.points * 4) },
                      { k: "Prazo", v: selected.onTimeRate },
                      { k: "Qualidade", v: Math.max(0, 100 - selected.reworkRate * 2) },
                      { k: "Capacidade", v: Math.max(0, 100 - selected.load * 60) },
                    ]}
                  >
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="k" fontSize={11} stroke="var(--muted-foreground)" />
                    <Radar dataKey="v" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.3} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card-surface p-4">
        <SectionTitle title="Comparativo da equipe" description="Pontos concluídos por colaborador" />
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={metrics.map((m) => ({ name: m.member.name.split(" ")[0], pontos: m.points, entregas: m.done }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <RBar dataKey="pontos" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <RBar dataKey="entregas" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function TimeBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
