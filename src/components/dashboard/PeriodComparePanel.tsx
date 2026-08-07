import { useState } from "react";
import { SectionTitle } from "@/components/ui-bits";
import { avg, cycleTime, formatHours, isDone, isLate, leadTime, pct, type Task } from "@/lib/domain";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function tasksInRange(tasks: Task[], from: string, to: string) {
  return tasks.filter((t) => {
    const d = t.created_at.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function statsOf(tasks: Task[]) {
  const done = tasks.filter(isDone);
  const onTime = done.filter((t) => !isLate(t));
  return {
    total: tasks.length,
    concluidas: done.length,
    atrasadas: tasks.filter(isLate).length,
    prazo: done.length ? pct(onTime.length, done.length) : 0,
    leadTime: avg(done.map(leadTime)),
    cycleTime: avg(done.map(cycleTime)),
    pontos: done.reduce((s, t) => s + t.complexity, 0),
  };
}

const ROWS: {
  key: keyof ReturnType<typeof statsOf>;
  label: string;
  format: (v: number | null) => string;
  higherIsBetter: boolean;
}[] = [
  { key: "total", label: "Tarefas criadas", format: (v) => String(v ?? 0), higherIsBetter: true },
  { key: "concluidas", label: "Concluídas", format: (v) => String(v ?? 0), higherIsBetter: true },
  { key: "atrasadas", label: "Atrasadas", format: (v) => String(v ?? 0), higherIsBetter: false },
  { key: "prazo", label: "Cumprimento de prazo", format: (v) => `${v ?? 0}%`, higherIsBetter: true },
  { key: "leadTime", label: "Lead time médio", format: (v) => formatHours(v), higherIsBetter: false },
  { key: "cycleTime", label: "Cycle time médio", format: (v) => formatHours(v), higherIsBetter: false },
  { key: "pontos", label: "Pontos concluídos", format: (v) => String(v ?? 0), higherIsBetter: true },
];

function delta(a: number | null, b: number | null) {
  if (a === null || b === null || b === 0) return null;
  return Math.round(((a - b) / b) * 100);
}

/** Compara dois períodos escolhidos livremente (não precisam ser consecutivos nem do mesmo tamanho). */
export function PeriodComparePanel({ tasks }: { tasks: Task[] }) {
  const [aFrom, setAFrom] = useState(daysAgoIso(30));
  const [aTo, setATo] = useState(todayIso());
  const [bFrom, setBFrom] = useState(daysAgoIso(60));
  const [bTo, setBTo] = useState(daysAgoIso(31));

  const statsA = statsOf(tasksInRange(tasks, aFrom, aTo));
  const statsB = statsOf(tasksInRange(tasks, bFrom, bTo));

  const inputCls = "rounded-md border border-input bg-background px-2 py-1 text-xs";

  return (
    <div className="card-surface p-4">
      <SectionTitle title="Comparar períodos" description="Escolha dois intervalos quaisquer para comparar" />
      <div className="mt-3 flex flex-wrap gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Período A</span>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            De
            <input type="date" value={aFrom} onChange={(e) => setAFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Até
            <input type="date" value={aTo} onChange={(e) => setATo(e.target.value)} className={inputCls} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Período B</span>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            De
            <input type="date" value={bFrom} onChange={(e) => setBFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Até
            <input type="date" value={bTo} onChange={(e) => setBTo(e.target.value)} className={inputCls} />
          </label>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Indicador</th>
              <th className="px-4 py-2 font-medium">Período A</th>
              <th className="px-4 py-2 font-medium">Período B</th>
              <th className="px-4 py-2 font-medium">Variação</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const va = statsA[r.key];
              const vb = statsB[r.key];
              const d = delta(va, vb);
              const positive = d !== null && (r.higherIsBetter ? d > 0 : d < 0);
              const negative = d !== null && (r.higherIsBetter ? d < 0 : d > 0);
              return (
                <tr key={r.key} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{r.label}</td>
                  <td className="px-4 py-2 tabular-nums">{r.format(va)}</td>
                  <td className="px-4 py-2 tabular-nums">{r.format(vb)}</td>
                  <td
                    className={`px-4 py-2 tabular-nums ${
                      positive ? "text-emerald-600" : negative ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {d === null ? "—" : `${d > 0 ? "+" : ""}${d}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
