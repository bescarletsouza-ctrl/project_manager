import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, Pill, SectionTitle } from "@/components/ui-bits";
import { useWorkspaceData, nameById, initials } from "@/lib/useData";
import { updateTask } from "@/lib/data";
import { isOpen, isLate, personMetrics, PRIORITY_LABEL } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/workload")({
  head: () => ({
    meta: [
      { title: "Workload e capacidade da equipe — Fluxo" },
      {
        name: "description",
        content:
          "Veja a carga de trabalho por colaborador em pontos de complexidade e redistribua tarefas em um clique.",
      },
      { property: "og:title", content: "Workload e capacidade — Fluxo" },
      { property: "og:description", content: "Carga por complexidade, prazos e redistribuição de demandas." },
    ],
  }),
  component: WorkloadPage,
});

function WorkloadPage() {
  const { members, tasks, departments, isLoading } = useWorkspaceData();
  const qc = useQueryClient();

  const reassign = useMutation({
    mutationFn: ({ id, assignee_id }: { id: string; assignee_id: string }) =>
      updateTask(id, { assignee_id }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Tarefa redistribuída.");
    },
    onError: () => toast.error("Não foi possível redistribuir."),
  });

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const metrics = members
    .map((m) => personMetrics(m, tasks))
    .sort((a, b) => b.load - a.load);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workload</h1>
        <p className="text-sm text-muted-foreground">
          Capacidade medida em pontos de complexidade — não em horas disponíveis.
        </p>
      </div>

      <div className="space-y-4">
        {metrics.map((m) => {
          const open = tasks.filter((t) => t.assignee_id === m.member.id && isOpen(t));
          return (
            <div key={m.member.id} className="card-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                    {initials(m.member.name)}
                  </span>
                  <div>
                    <p className="font-medium">{m.member.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {nameById(departments, m.member.department_id)} · {m.openPoints}/{m.member.capacity_points} pts
                    </p>
                  </div>
                </div>
                <Pill tone={m.load >= 1.15 ? "danger" : m.load >= 0.85 ? "warning" : m.load < 0.5 ? "info" : "success"}>
                  {m.loadLabel}
                </Pill>
              </div>
              <div className="mt-3">
                <Bar value={m.load * 100} />
              </div>

              <div className="mt-3 space-y-1">
                {open.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <Pill tone={t.priority === "urgente" ? "danger" : "neutral"}>{PRIORITY_LABEL[t.priority]}</Pill>
                    <Pill tone="info">{t.complexity} pts</Pill>
                    {isLate(t) && <Pill tone="danger">Atrasada</Pill>}
                    <select
                      value={t.assignee_id ?? ""}
                      onChange={(e) => reassign.mutate({ id: t.id, assignee_id: e.target.value })}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                    >
                      {members.map((mm) => (
                        <option key={mm.id} value={mm.id}>
                          {mm.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                {open.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sem tarefas abertas — capacidade disponível.</p>
                )}
                {open.length > 5 && (
                  <p className="text-xs text-muted-foreground">+ {open.length - 5} outras tarefas abertas</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
