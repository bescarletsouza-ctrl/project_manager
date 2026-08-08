import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, EmptyState, Pill, SectionTitle } from "@/components/ui-bits";
import { useInvalidate, useWorkspaceData, nameById } from "@/lib/useData";
import { useAsanaData } from "@/lib/useAsana";
import { deletePortfolio } from "@/lib/asana";
import { updateProject } from "@/lib/data";
import { PROJECT_STATUS_LABEL, projectHealth } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/portfolios/$portfolioId")({
  head: () => ({
    meta: [
      { title: "Portfólio — projetos agrupados — Alana" },
      { name: "description", content: "Progresso, riscos e prazos dos projetos que compõem este portfólio." },
      { property: "og:title", content: "Portfólio — Alana" },
      { property: "og:description", content: "Acompanhe todos os projetos de um portfólio em uma única visão." },
    ],
  }),
  component: PortfolioDetail,
});

function PortfolioDetail() {
  const { portfolioId } = Route.useParams();
  const navigate = useNavigate();
  const invalidatePortfolioCascade = useInvalidate(["portfolios", "projects"]);
  const invalidateProjects = useInvalidate(["projects"]);
  const { projects, tasks, clients, members, isLoading } = useWorkspaceData();
  const { portfolios } = useAsanaData();

  const remove = useMutation({
    mutationFn: () => deletePortfolio(portfolioId),
    onSuccess: () => {
      invalidatePortfolioCascade();
      toast.success("Portfólio removido.");
      navigate({ to: "/portfolios" });
    },
    onError: () => toast.error("Não foi possível remover."),
  });

  const attach = useMutation({
    mutationFn: (projectId: string) => updateProject(projectId, { portfolio_id: portfolioId }),
    onSuccess: () => {
      invalidateProjects();
      toast.success("Projeto adicionado ao portfólio.");
    },
    onError: () => toast.error("Não foi possível adicionar."),
  });

  const detach = useMutation({
    mutationFn: (projectId: string) => updateProject(projectId, { portfolio_id: null }),
    onSuccess: () => invalidateProjects(),
  });

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const portfolio = portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) {
    return (
      <div className="card-surface p-10 text-center">
        <p className="font-medium">Portfólio não encontrado.</p>
        <Link to="/portfolios" className="mt-2 inline-block text-sm text-primary hover:underline">
          Voltar
        </Link>
      </div>
    );
  }

  const inside = projects.filter((p) => p.portfolio_id === portfolioId);
  const outside = projects.filter((p) => p.portfolio_id !== portfolioId);
  const agg = inside.map((p) => projectHealth(p, tasks));
  const total = agg.reduce((s, a) => s + a.total, 0);
  const done = agg.reduce((s, a) => s + a.done, 0);
  const progress = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/portfolios" className="text-xs text-muted-foreground hover:underline">Portfólios</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{portfolio.name}</h1>
          <p className="text-sm text-muted-foreground">
            {portfolio.description ?? "Sem descrição"} · Responsável: {nameById(members, portfolio.owner_id)}
          </p>
        </div>
        <button
          onClick={() => confirm("Remover este portfólio? Os projetos continuam existindo.") && remove.mutate()}
          className="rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
        >
          Remover portfólio
        </button>
      </div>

      <div className="card-surface space-y-2 p-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{done} de {total} tarefas concluídas em {inside.length} projetos</span>
          <span className="font-medium tabular-nums">{progress}%</span>
        </div>
        <Bar value={progress} />
      </div>

      {inside.length === 0 ? (
        <EmptyState title="Nenhum projeto neste portfólio" description="Adicione projetos existentes abaixo." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {inside.map((p) => {
            const h = projectHealth(p, tasks);
            return (
              <div key={p.id} className="card-surface space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to="/projetos/$projectId" params={{ projectId: p.id }} className="font-semibold hover:underline">
                    {p.name}
                  </Link>
                  <Pill tone={h.score >= 75 ? "success" : h.score >= 50 ? "warning" : "danger"}>{h.health}</Pill>
                </div>
                <p className="text-xs text-muted-foreground">{nameById(clients, p.client_id)}</p>
                <Bar value={h.progress} />
                <div className="flex flex-wrap gap-1 text-xs">
                  <Pill>{PROJECT_STATUS_LABEL[p.status] ?? p.status}</Pill>
                  <Pill tone="info">{h.progress}%</Pill>
                  {h.late > 0 && <Pill tone="danger">{h.late} atrasadas</Pill>}
                </div>
                <button
                  onClick={() => detach.mutate(p.id)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Remover do portfólio
                </button>
              </div>
            );
          })}
        </div>
      )}

      {outside.length > 0 && (
        <div className="card-surface space-y-3 p-4">
          <SectionTitle title="Adicionar projeto" description="Escolha um projeto existente para incluir neste portfólio." />
          <div className="flex flex-wrap gap-2">
            {outside.map((p) => (
              <button
                key={p.id}
                onClick={() => attach.mutate(p.id)}
                className="rounded-full border border-input px-3 py-1 text-sm hover:bg-secondary"
              >
                + {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
