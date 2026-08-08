import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BarChart3, Gauge, Timer, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Alana — Gestão de projetos com relatórios de produtividade" },
      {
        name: "description",
        content:
          "Gerencie projetos, tarefas e equipes com métricas automáticas de produtividade por colaborador, equipe, projeto e departamento.",
      },
      { property: "og:title", content: "Alana — Gestão de projetos com relatórios de produtividade" },
      {
        property: "og:description",
        content: "Gerencie projetos, tarefas e equipes com métricas automáticas de produtividade por colaborador, equipe, projeto e departamento.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Timer,
    title: "Tempo calculado sozinho",
    text: "Cada mudança de status registra data e hora. Lead time, cycle time e tempo por etapa saem prontos.",
  },
  {
    icon: BarChart3,
    title: "Relatórios que comparam justo",
    text: "Produtividade por complexidade, prazo e retrabalho — não pelo número bruto de tarefas.",
  },
  {
    icon: Gauge,
    title: "Workload transparente",
    text: "Capacidade em pontos por pessoa, com alerta de sobrecarga e redistribuição em um clique.",
  },
  {
    icon: Users,
    title: "Estrutura organizacional",
    text: "Clientes, departamentos, equipes e projetos com visão executiva consolidada.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <img src="/alana-icon.png" alt="Alana" className="size-7 rounded-md object-cover" />
          <span className="font-semibold tracking-tight">Alana</span>
        </div>
        <Link
          to="/auth"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Entrar
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="py-16 md:py-24">
          <p className="text-sm font-medium text-muted-foreground">Gestão de projetos orientada a dados</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            Produtividade medida pelo trabalho real, não por planilhas de horas.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            A Alana acompanha cada movimentação das tarefas e transforma isso em relatórios de produtividade por
            colaborador, equipe, projeto e departamento.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Acessar o sistema <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center rounded-md border border-input px-5 py-3 text-sm font-medium hover:bg-secondary"
            >
              Ver demonstração
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {FEATURES.map((f) => (
            <article key={f.title} className="card-surface p-6">
              <f.icon className="size-5 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
