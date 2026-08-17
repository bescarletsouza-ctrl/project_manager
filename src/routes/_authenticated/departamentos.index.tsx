import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Pencil, Trash2 } from "lucide-react";
import { EmptyState, Pill, RowMenu, SectionTitle } from "@/components/ui-bits";
import { createDepartment, deleteDepartment, departmentsQuery, updateDepartment } from "@/lib/data";
import { sectionsQuery, taskDepartmentsQuery } from "@/lib/asana";
import { taskDepartmentIdsOf, useInvalidate, useWorkspaceData } from "@/lib/useData";
import { useQuery } from "@tanstack/react-query";
import { dotClass } from "@/lib/colors";
import { cn } from "@/lib/utils";

/**
 * Índice de departamentos. Estrutura espelha /portfolios: lista de cards com
 * contagens e um form curto de criação no fim. É a única porta de entrada
 * fora do painel de configurações — quem não é admin também precisa criar.
 */
export const Route = createFileRoute("/_authenticated/departamentos/")({
  head: () => ({
    meta: [
      { title: "Departamentos — tarefas por área — Alana" },
      {
        name: "description",
        content:
          "Organize as tarefas por departamento com seções próprias, sem depender de um projeto.",
      },
      { property: "og:title", content: "Departamentos — Alana" },
      { property: "og:description", content: "Cada área com suas próprias tarefas e seções." },
    ],
  }),
  component: DepartmentsPage,
});

const COLORS = ["blue", "indigo", "violet", "emerald", "amber", "rose", "slate", "cyan"];

function DepartmentsPage() {
  const invalidateDept = useInvalidate(["departments"]);
  const invalidateDeptCascade = useInvalidate(["departments", "sections", "tasks"]);
  const { departments, members, tasks, projects, isLoading } = useWorkspaceData();
  const sections = useQuery(sectionsQuery).data ?? [];
  const taskDepartments = useQuery(taskDepartmentsQuery).data ?? [];
  const [form, setForm] = useState({ name: "", color: "blue" });
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);

  const add = useMutation({
    mutationFn: () => createDepartment({ name: form.name.trim(), color: form.color }),
    onSuccess: () => {
      setForm({ name: "", color: "blue" });
      invalidateDept();
      toast.success("Departamento criado.");
    },
    onError: (e: unknown) => toast.error(`Não foi possível criar: ${(e as Error)?.message ?? "erro"}`),
  });

  const patch = useMutation({
    mutationFn: (f: { id: string; name: string; color: string }) =>
      updateDepartment(f.id, { name: f.name.trim(), color: f.color }),
    onSuccess: () => {
      setEditing(null);
      invalidateDept();
      toast.success("Departamento atualizado.");
    },
    onError: () => toast.error("Não foi possível atualizar."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDepartment(id),
    onSuccess: () => {
      invalidateDeptCascade();
      toast.success("Departamento removido.");
    },
    onError: () => toast.error("Não foi possível remover."),
  });

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const inputCls =
    "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

  /** Estatísticas exibidas no cartão de cada departamento. */
  function stats(deptId: string) {
    const dTasks = tasks.filter((t) => taskDepartmentIdsOf(t, taskDepartments).includes(deptId));
    const done = dTasks.filter((t) => t.status === "concluido").length;
    const dSections = sections.filter((s) => s.department_id === deptId);
    return {
      tasks: dTasks.length,
      done,
      people: members.filter((m) => m.department_id === deptId).length,
      projects: projects.filter((p) => p.department_id === deptId).length,
      sections: dSections.length,
      progress: dTasks.length ? Math.round((done / dTasks.length) * 100) : 0,
    };
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Departamentos</h1>
        <p className="text-sm text-muted-foreground">
          Cada departamento tem suas próprias tarefas e seções — independente de projeto.
        </p>
      </div>

      {departments.length === 0 ? (
        <EmptyState
          title="Nenhum departamento ainda"
          description="Crie o primeiro abaixo para começar a organizar tarefas por área."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const s = stats(d.id);
            return (
              <div key={d.id} className="card-surface relative flex flex-col gap-3 p-4">
                <Link
                  to="/departamentos/$departmentId"
                  params={{ departmentId: d.id }}
                  className="flex items-start gap-2"
                >
                  <span className={cn("mt-1 size-3 shrink-0 rounded-full", dotClass(d.color))} />
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold hover:underline">{d.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.people} pessoas · {s.projects} projetos · {s.sections} seções
                    </p>
                  </div>
                </Link>
                <div className="flex flex-wrap gap-1 text-xs">
                  <Pill tone="info">{s.tasks} tarefas</Pill>
                  <Pill>{s.progress}% concluído</Pill>
                </div>
                <RowMenu
                  className="absolute top-2 right-2"
                  actions={[
                    {
                      label: "Editar",
                      icon: Pencil,
                      onSelect: () => setEditing({ id: d.id, name: d.name, color: d.color }),
                    },
                    {
                      label: "Excluir",
                      icon: Trash2,
                      destructive: true,
                      separatorBefore: true,
                      onSelect: () =>
                        confirm(`Excluir "${d.name}"? As seções e tarefas exclusivas do departamento vão junto.`) &&
                        remove.mutate(d.id),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editing.name.trim().length < 2) return;
            patch.mutate(editing);
          }}
          className="card-surface flex flex-wrap items-end gap-2 p-4"
        >
          <SectionTitle title="Editar departamento" />
          <input
            className={inputCls}
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
          <select
            className={inputCls}
            value={editing.color}
            onChange={(e) => setEditing({ ...editing, color: e.target.value })}
          >
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Salvar
          </button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
        </form>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim().length < 2) return;
          add.mutate();
        }}
        className="card-surface space-y-3 p-4"
      >
        <SectionTitle
          title="Novo departamento"
          description="Ex.: Marketing, Financeiro, Operações. Independente de projetos."
        />
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            placeholder="Nome"
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={cn(inputCls, "sm:col-span-2")}
          />
          <select
            className={inputCls}
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
          >
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Building2 className="mr-1 inline size-4" /> Criar
          </button>
        </div>
      </form>
    </div>
  );
}
