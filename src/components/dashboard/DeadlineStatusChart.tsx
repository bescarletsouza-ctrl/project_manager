import { useMemo, useState } from "react";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionTitle } from "@/components/ui-bits";
import { isDueSoon, isLate, isOpen, type Task } from "@/lib/domain";

type Bucket = "no_prazo" | "vencendo" | "atrasado";

const BUCKET_META: Record<Bucket, { label: string; color: string }> = {
  no_prazo: { label: "No prazo", color: "var(--success)" },
  vencendo: { label: "Vencendo", color: "var(--warning)" },
  atrasado: { label: "Atrasado", color: "var(--destructive)" },
};

function bucketOf(t: Task): Bucket {
  if (isLate(t)) return "atrasado";
  if (isDueSoon(t)) return "vencendo";
  return "no_prazo";
}

/** Tarefas abertas por status de prazo (no prazo / vencendo / atrasado), com filtro de data próprio por due_date. */
export function DeadlineStatusChart({
  tasks,
  onSelect,
}: {
  tasks: Task[];
  onSelect: (title: string, tasks: Task[]) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (!isOpen(t)) return false;
        if (!from && !to) return true;
        if (!t.due_date) return false;
        if (from && t.due_date < from) return false;
        if (to && t.due_date > to) return false;
        return true;
      }),
    [tasks, from, to],
  );

  const data = (["no_prazo", "vencendo", "atrasado"] as Bucket[]).map((bucket) => ({
    bucket,
    name: BUCKET_META[bucket].label,
    value: filtered.filter((t) => bucketOf(t) === bucket).length,
  }));

  const inputCls = "rounded-md border border-input bg-background px-2 py-1 text-xs";

  return (
    <div className="card-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle
          title="Tarefas por prazo"
          description="Abertas: no prazo, vencendo em breve ou atrasadas — clique numa barra"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            De
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Até
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputCls}
            />
          </label>
          {(from || to) && (
            <button
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-secondary"
            >
              Limpar
            </button>
          )}
        </div>
      </div>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" fontSize={11} stroke="var(--muted-foreground)" />
            <YAxis fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            />
            <RBar
              dataKey="value"
              name="Tarefas"
              radius={[4, 4, 0, 0]}
              className="cursor-pointer"
              onClick={(d: unknown) => {
                const row = d as { payload?: { bucket: Bucket; name: string } };
                if (row.payload) {
                  onSelect(
                    `Tarefas — ${row.payload.name}`,
                    filtered.filter((t) => bucketOf(t) === row.payload!.bucket),
                  );
                }
              }}
            >
              {data.map((d) => (
                <Cell key={d.bucket} fill={BUCKET_META[d.bucket].color} />
              ))}
            </RBar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
