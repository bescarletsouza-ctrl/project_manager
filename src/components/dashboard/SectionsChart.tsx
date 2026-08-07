import { useMemo, useState } from "react";
import { Bar as RBar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionTitle } from "@/components/ui-bits";
import type { Section } from "@/lib/asana";
import type { Task } from "@/lib/domain";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Tarefas por seção (etapa) de um departamento ou projeto — com seletor e filtro de data próprios. */
export function SectionsChart({
  title,
  containerLabel,
  containers,
  containerKey,
  sections,
  tasks,
  onSelect,
}: {
  title: string;
  containerLabel: string;
  containers: { id: string; name: string }[];
  containerKey: "department_id" | "project_id";
  sections: Section[];
  tasks: Task[];
  onSelect: (title: string, tasks: Task[]) => void;
}) {
  const [containerId, setContainerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const activeId = containerId || containers[0]?.id || "";

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        const d = t.created_at.slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [tasks, from, to],
  );

  const bySection = useMemo(() => {
    if (!activeId) return [];
    const containerSections = sections
      .filter((s) => (containerKey === "department_id" ? s.department_id === activeId : s.project_id === activeId))
      .slice()
      .sort((a, b) => a.position - b.position);
    return containerSections.map((s) => ({
      id: s.id,
      name: s.name,
      total: filtered.filter((t) => t.section_id === s.id).length,
    }));
  }, [activeId, sections, containerKey, filtered]);

  const inputCls = "rounded-md border border-input bg-background px-2 py-1 text-xs";

  return (
    <div className="card-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle title={title} description="Clique numa barra para ver as tarefas" />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeId}
            onChange={(e) => setContainerId(e.target.value)}
            className={inputCls}
            aria-label={containerLabel}
          >
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
              }}
              className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-secondary"
            >
              Limpar
            </button>
          )}
        </div>
      </div>
      <div className="mt-4 h-64">
        {containers.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhum {containerLabel.toLowerCase()} cadastrado.
          </p>
        ) : bySection.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhuma seção neste {containerLabel.toLowerCase()}.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bySection}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" fontSize={11} stroke="var(--muted-foreground)" />
              <YAxis fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <RBar
                dataKey="total"
                name="Tarefas"
                radius={[4, 4, 0, 0]}
                className="cursor-pointer"
                onClick={(d: unknown) => {
                  const row = d as { payload?: { id: string; name: string } };
                  if (row.payload) {
                    onSelect(`Seção — ${row.payload.name}`, filtered.filter((t) => t.section_id === row.payload!.id));
                  }
                }}
              >
                {bySection.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </RBar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
