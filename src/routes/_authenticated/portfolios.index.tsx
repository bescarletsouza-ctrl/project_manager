import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderKanban } from "lucide-react";
import { Bar, Pill, SectionTitle } from "@/components/ui-bits";
import { useInvalidate, useWorkspaceData, nameById } from "@/lib/useData";
import { useAsanaData } from "@/lib/useAsana";
import { createPortfolio } from "@/lib/asana";
import { projectHealth } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/portfolios/")({
  head: () => ({
    meta: [
      { title: "Portfólios — visão executiva dos projetos — Alana" },
      {
        name: "description",
        content: "Agrupe projetos em portfólios e acompanhe progresso, riscos e prazos de cada frente da operação.",
      },
      { property: "og:title", content: "Portfólios — Alana" },
      { property: "og:description", content: "Visão executiva: progresso e saúde de cada conjunto de projetos." },
    ],
  }),
  component: PortfoliosPage,
});

function PortfoliosPage() {
  const { projects, tasks, members, isLoading } = useWorkspaceData();
  const { portfolios } = useAsanaData();
  const invalidatePortfolios = useInvalidate(["portfolios"]);
  const [form, setForm] = useState({ name: "", description: "", owner_id: "" });

  const add = useMutation({
    mutationFn: () =>
      createPortfolio({
        name: form.name.trim(),
        description: form.description || null,
        owner_id: form.owner_id || null,
      }),
    onSuccess: () => {
      setForm({ name: "", description: "", owner_id: "" });
      invalidatePortfolios();
      toast.success("Portfólio criado.");
    },
    onError: () => toast.error("Não foi possível criar o portfólio."),
  });

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const inputCls = "rounded-md border border-input bg-background px-3 py-2 text-sm";

  function stats(portfolioId: string | null) {
    const list = projects.filter((p) => p.portfolio_id === portfolioId);
    const agg = list.map((p) => projectHealth(p, tasks));
    const total = agg.reduce((s, a) => s + a.total, 0);
    const done = agg.reduce((s, a) => s + a.done, 0);
    const late = agg.reduce((s, a) => s + a.late, 0);
    return {
      projects: list.length,
      total,
      done,
      late,
      progress: total ? Math.round((done / total) * 100) : 0,
    };
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Portfólios</h1>
        <p className="text-sm text-muted-foreground">
          Portfólio → Projeto → Seção → Tarefa → Subtarefa. Comece agrupando seus projetos.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {portfolios.map((pf) => {
          const s = stats(pf.id);
          return (
            <Link
              key={pf.id}
              to="/portfolios/$portfolioId"
              params={{ portfolioId: pf.id }}
              className="card-surface block space-y-3 p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start gap-2">
                <FolderKanban className="mt-0.5 size-4 text-primary" />
                <div className="min-w-0">
                  <h3 className="font-semibold">{pf.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    Responsável: {nameById(members, pf.owner_id)}
                  </p>
                </div>
              </div>
              {pf.description && <p className="line-clamp-2 text-sm text-muted-foreground">{pf.description}</p>}
              <Bar value={s.progress} />
              <div className="flex flex-wrap gap-1 text-xs">
                <Pill tone="info">{s.projects} projetos</Pill>
                <Pill>{s.progress}% concluído</Pill>
                {s.late > 0 && <Pill tone="danger">{s.late} atrasadas</Pill>}
              </div>
            </Link>
          );
        })}

        {(() => {
          const s = stats(null);
          if (!s.projects) return null;
          return (
            <div className="card-surface space-y-3 border-dashed p-4">
              <h3 className="font-semibold">Sem portfólio</h3>
              <Bar value={s.progress} />
              <div className="flex flex-wrap gap-1 text-xs">
                <Pill tone="warning">{s.projects} projetos soltos</Pill>
                <Pill>{s.progress}% concluído</Pill>
              </div>
              <Link to="/projetos" className="text-sm text-primary hover:underline">
                Organizar projetos
              </Link>
            </div>
          );
        })()}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim().length < 2) return;
          add.mutate();
        }}
        className="card-surface space-y-3 p-4"
      >
        <SectionTitle title="Novo portfólio" description="Ex.: Marketing 2026, Clientes Enterprise, Produto." />
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            placeholder="Nome"
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputCls}
          />
          <input
            placeholder="Descrição"
            maxLength={280}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={`${inputCls} sm:col-span-2`}
          />
          <select className={inputCls} value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
            <option value="">Responsável</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Criar portfólio
        </button>
      </form>
    </div>
  );
}
