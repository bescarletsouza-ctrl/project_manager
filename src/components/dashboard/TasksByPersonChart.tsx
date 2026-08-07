import { useMemo, useState } from "react";
import { Bar as RBar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionTitle } from "@/components/ui-bits";
import { DrilldownPanel, type Selection } from "./DrilldownPanel";
import type { Member, Project, Task } from "@/lib/domain";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function dateKey(task: Task) {
  return task.due_date ?? task.created_at.slice(0, 10);
}

/** Gráficos clicáveis de tarefas por pessoa e por data. */
export function TasksByPersonChart({
  tasks,
  members,
  projects,
}: {
  tasks: Task[];
  members: Member[];
  projects: Project[];
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        const d = dateKey(t);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [tasks, from, to],
  );

  const byPerson = useMemo(() => {
    const rows = members.map((m) => ({
      key: m.id,
      name: m.name,
      total: filtered.filter((t) => t.assignee_id === m.id).length,
    }));
    const unassigned = filtered.filter((t) => !t.assignee_id).length;
    if (unassigned) rows.push({ key: "", name: "Sem responsável", total: unassigned });
    return rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  }, [filtered, members]);

  const openPerson = (key: string, name: string) =>
    setSelection({
      title: `Tarefas de ${name}`,
      tasks: filtered.filter((t) => (t.assignee_id ?? "") === key),
    });

  const inputCls = "rounded-md border border-input bg-background px-2 py-1 text-xs";

  return (
    <div className="space-y-4">
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle title="Tarefas por pessoa" description="Clique em uma barra para ver as tarefas" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              De
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Até
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
            </label>
            {(from || to) && (
              <button
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setSelection(null);
                }}
                className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-secondary"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byPerson}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" fontSize={11} stroke="var(--muted-foreground)" interval={0} height={50} angle={-20} textAnchor="end" />
              <YAxis fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <RBar
                dataKey="total"
                name="Tarefas"
                radius={[4, 4, 0, 0]}
                className="cursor-pointer"
                onClick={(d: unknown) => {
                  const row = d as { payload?: { key: string; name: string } };
                  if (row.payload) openPerson(row.payload.key, row.payload.name);
                }}
              >
                {byPerson.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </RBar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {byPerson.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa no período selecionado.</p>
        )}
      </div>


      <DrilldownPanel selection={selection} onClose={() => setSelection(null)} members={members} projects={projects} />
    </div>
  );
}
