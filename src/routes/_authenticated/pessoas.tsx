import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { MetaItem, Pill, SectionTitle, StatCard } from "@/components/ui-bits";
import { useWorkspaceData, nameById, initials } from "@/lib/useData";
import { taskFieldActivityQuery } from "@/lib/data";
import { sectionsQuery } from "@/lib/asana";
import {
  addDaysIso,
  computeFlowAnalysis,
  formatHours,
  isOpen,
  personMetrics,
  todayLocalIso,
  FLOW_STATUS_LABEL,
  FLOW_STATUS_TONE,
  type FlowStatus,
} from "@/lib/domain";
import { requireRole } from "@/lib/access";

export const Route = createFileRoute("/_authenticated/pessoas")({
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "visualizador"]),
  head: () => ({
    meta: [
      { title: "Produtividade por colaborador — Alana" },
      {
        name: "description",
        content:
          "Painel individual de produtividade: entrada x saída de demandas, backlog, prazos, tempo de produção e retrabalho.",
      },
      { property: "og:title", content: "Produtividade por colaborador — Alana" },
      { property: "og:description", content: "Sobrecarga x produtividade, a partir do histórico real de entregas." },
    ],
  }),
  component: PeoplePage,
});

const SORTS = [
  { key: "flow", label: "Diagnóstico (sobrecarga primeiro)" },
  { key: "done", label: "Mais entregas" },
  { key: "onTimeRate", label: "Melhor prazo" },
  { key: "avgCycle", label: "Menor tempo médio" },
  { key: "reworkRate", label: "Menor retrabalho" },
] as const;

const FLOW_RANK: Record<FlowStatus, number> = {
  sobrecarga: 0,
  possivel_problema: 1,
  dados_insuficientes: 2,
  saudavel: 3,
};

const DEFAULT_PERIOD_DAYS = 28;

function PeoplePage() {
  const { members, tasks: allTasks, departments, isLoading } = useWorkspaceData();
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("flow");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const fieldActivity = useQuery(taskFieldActivityQuery).data ?? [];
  const sections = useQuery(sectionsQuery).data ?? [];

  // Sem filtro definido, usa uma janela padrão (últimos 28 dias) — o
  // diagnóstico de fluxo precisa sempre de um período fechado pra calcular
  // taxas semanais; nunca fica sem período.
  const periodTo = dateTo || todayLocalIso();
  const periodFrom = dateFrom || addDaysIso(periodTo, -(DEFAULT_PERIOD_DAYS - 1));

  /**
   * Aberta sempre conta (é a carga atual da pessoa — filtrar por data
   * escondia a capacidade de agora). Concluída entra pela data de
   * CONCLUSÃO, não de criação: "performance no período" é sobre quando a
   * pessoa entregou, não quando a tarefa nasceu — tarefa criada há meses e
   * entregue essa semana tem que aparecer ao filtrar essa semana (era o
   * contrário antes, por isso o filtro parecia não trazer nada). Cancelada
   * não tem data de conclusão; usa a de criação nesse caso raro.
   */
  const tasks = useMemo(
    () =>
      allTasks.filter((t) => {
        if (isOpen(t)) return true;
        const d = (t.completed_at ?? t.created_at).slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      }),
    [allTasks, dateFrom, dateTo],
  );

  const metrics = useMemo(() => {
    const list = members.map((m) => ({
      ...personMetrics(m, tasks, fieldActivity, sections),
      flow: computeFlowAnalysis(m, allTasks, fieldActivity, sections, periodFrom, periodTo),
    }));
    return list.sort((a, b) => {
      if (sort === "flow") return FLOW_RANK[a.flow.status] - FLOW_RANK[b.flow.status];
      if (sort === "avgCycle") return (a.avgCycle ?? 1e9) - (b.avgCycle ?? 1e9);
      if (sort === "reworkRate") return a.reworkRate - b.reworkRate;
      return (b[sort] as number) - (a[sort] as number);
    });
  }, [members, tasks, allTasks, fieldActivity, sections, sort, periodFrom, periodTo]);

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const selected = metrics.find((m) => m.member.id === selectedId) ?? metrics[0];
  /**
   * Sem filtro: retrato de HOJE, só atrasada ainda aberta (lateOpen) — é o
   * número que importa pra saber quem está sob risco agora. Com filtro de
   * período: total do período, aberta + finalizada (late), porque aí a
   * pergunta é "quantas atrasaram nesse período", não "quantas pesam hoje".
   */
  const dateFilterActive = Boolean(dateFrom || dateTo);
  const lateOf = (m: (typeof metrics)[number]) => (dateFilterActive ? m.late : m.lateOpen);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium tracking-tight">Produtividade</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Cruza entrada e saída de demandas com o histórico real de entregas pra apontar sobrecarga ou queda de
            produtividade — sem complexidade nem metas configuradas à mão.
          </p>
          {!dateFilterActive && (
            <p className="mt-1 text-xs text-muted-foreground">
              Sem período definido — usando os últimos {DEFAULT_PERIOD_DAYS} dias ({fmtBr(periodFrom)} a {fmtBr(periodTo)}).
            </p>
          )}
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
                <Pill tone={FLOW_STATUS_TONE[m.flow.status]}>{FLOW_STATUS_LABEL[m.flow.status]}</Pill>
                {lateOf(m) > 0 && (
                  <Pill tone="danger">
                    {lateOf(m)} atrasada{lateOf(m) > 1 ? "s" : ""}
                    {dateFilterActive ? " (total)" : ""}
                  </Pill>
                )}
              </div>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {nameById(departments, m.member.department_id)} · {m.flow.recebidas} recebidas · {m.flow.entregues} entregues
              </p>
            </div>
            <div className="hidden gap-8 lg:grid lg:grid-cols-4">
              <MetaItem label="Backlog">{m.flow.backlogAtual}</MetaItem>
              <MetaItem label="% atrasadas">{m.flow.pctAtrasadas === null ? "—" : `${m.flow.pctAtrasadas}%`}</MetaItem>
              <MetaItem label="Tempo médio">{formatHours(m.flow.avgProducao)}</MetaItem>
              <MetaItem label="Retrabalho">{m.flow.reworkPct === null ? "—" : `${m.flow.reworkPct}%`}</MetaItem>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="space-y-4">
          <SectionTitle
            title={`Painel individual — ${selected.member.name}`}
            {...(selected.member.job_title ? { description: selected.member.job_title } : {})}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Demandas recebidas" value={selected.flow.recebidas} hint="no período" />
            <StatCard label="Demandas entregues" value={selected.flow.entregues} tone="success" hint="no período" />
            <StatCard
              label="Backlog atual"
              value={selected.flow.backlogAtual}
              tone={selected.flow.backlogDelta > 0 ? "warning" : "neutral"}
              hint={`${selected.flow.backlogDelta >= 0 ? "+" : ""}${selected.flow.backlogDelta} no período`}
            />
            <StatCard
              label="% de demandas atrasadas"
              value={selected.flow.pctAtrasadas === null ? "—" : `${selected.flow.pctAtrasadas}%`}
              tone={selected.flow.pctAtrasadas === null ? "neutral" : selected.flow.pctAtrasadas > 20 ? "danger" : "success"}
              {...(selected.flow.pctAtrasadas === null ? { hint: "sem dados no período" } : {})}
            />
            <StatCard
              label="Tempo médio de produção"
              value={formatHours(selected.flow.avgProducao)}
              {...(selected.flow.avgProducao === null ? { hint: "sem entregas no período" } : {})}
            />
            <StatCard
              label="Retrabalho"
              value={selected.flow.reworkPct === null ? "—" : `${selected.flow.reworkPct}%`}
              {...(selected.flow.reworkPct === null ? { hint: "sem entregas no período" } : {})}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card-surface p-4">
              <SectionTitle title="Entrada × Saída" description="Volume de demandas no período selecionado" />
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <TimeBox label="Entraram" value={String(selected.flow.recebidas)} />
                <TimeBox label="Concluídas" value={String(selected.flow.entregues)} />
                <TimeBox
                  label="Variação do backlog"
                  value={`${selected.flow.backlogDelta >= 0 ? "+" : ""}${selected.flow.backlogDelta}`}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Backlog atual: {selected.flow.backlogAtual} tarefa{selected.flow.backlogAtual === 1 ? "" : "s"} em
                aberto. Variação = entradas − saídas no período (estimativa; não isola cancelamentos ou
                reatribuições).
              </p>
            </div>

            <div className="card-surface p-4">
              <SectionTitle title="Diagnóstico" description={`${fmtBr(selected.flow.periodFrom)} a ${fmtBr(selected.flow.periodTo)}`} />
              <div className="mt-3">
                <Pill tone={FLOW_STATUS_TONE[selected.flow.status]} className="px-3 py-1 text-sm">
                  {FLOW_STATUS_LABEL[selected.flow.status]}
                </Pill>
                <p className="mt-3 text-sm text-muted-foreground">{selected.flow.motivo}</p>
              </div>
              {selected.flow.capacidadeSemanal !== null ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Capacidade histórica estimada: {selected.flow.capacidadeSemanal.toFixed(1)} entregas/semana
                  (baseado em {selected.flow.capacidadeEntregas} entregas nas {selected.flow.capacidadeAmostraSemanas}{" "}
                  semanas anteriores ao período — nunca um valor configurado manualmente).
                </p>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">
                  Capacidade histórica ainda não pode ser estimada com confiança — histórico recente de entregas
                  insuficiente.
                </p>
              )}
            </div>
          </div>

          <div className="card-surface p-4">
            <SectionTitle title="Tempos médios" description="Calculados pelo histórico de movimentações (tarefas do painel atual, sem filtro estrito de período)" />
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <TimeBox label="Até iniciar" value={formatHours(selected.avgToStart)} />
              <TimeBox label="Cycle time" value={formatHours(selected.avgCycle)} />
              <TimeBox label="Lead time" value={formatHours(selected.avgLead)} />
            </div>
          </div>
        </div>
      )}

      <div className="card-surface p-4">
        <SectionTitle title="Comparativo da equipe" description="Entrada × saída de demandas no período selecionado" />
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={metrics.map((m) => ({
                name: m.member.name.split(" ")[0],
                recebidas: m.flow.recebidas,
                entregues: m.flow.entregues,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis fontSize={11} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <RBar dataKey="recebidas" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <RBar dataKey="entregues" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function fmtBr(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function TimeBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
