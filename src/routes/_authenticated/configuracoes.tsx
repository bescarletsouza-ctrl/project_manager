import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { EmptyState, MetaItem, Pill, RowMenu, SectionTitle } from "@/components/ui-bits";
import { useWorkspaceData, nameById, initials } from "@/lib/useData";
import {
  ACCESS_ROLES,
  ACCESS_ROLE_LABEL,
  createClient,
  createDepartment,
  createMember,
  deleteClient,
  deleteDepartment,
  deleteMember,
  updateClient,
  updateDepartment,
  updateMember,
} from "@/lib/data";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — acessos, equipe e departamentos | Fluxo" },
      {
        name: "description",
        content:
          "Gerencie acessos, papéis da equipe, departamentos e clientes do workspace em um único painel de configuração.",
      },
      { property: "og:title", content: "Configurações do workspace — Fluxo" },
      {
        property: "og:description",
        content: "Acessos, equipe, departamentos e clientes em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const TABS = [
  { key: "equipe", label: "Equipe e acessos" },
  { key: "departamentos", label: "Departamentos" },
  { key: "clientes", label: "Clientes" },
] as const;

const COLORS = ["blue", "indigo", "violet", "emerald", "amber", "rose", "slate", "cyan"];

const input =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20";

const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90";

const ghostBtn =
  "rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted";

function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("equipe");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Configurações</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Cadastre pessoas, defina níveis de acesso e organize departamentos e clientes.
        </p>
      </div>

      <div className="flex flex-wrap gap-6 border-b border-border/70">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "-mb-px border-b-2 pb-3 text-sm transition-colors " +
              (tab === t.key
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "equipe" && <TeamPanel />}
      {tab === "departamentos" && <DepartmentsPanel />}
      {tab === "clientes" && <ClientsPanel />}
    </div>
  );
}

function useInvalidate(keys: string[]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/* ------------------------------- Equipe -------------------------------- */

type MemberForm = {
  id?: string;
  name: string;
  email: string;
  job_title: string;
  access_role: string;
  department_id: string;
  capacity_points: number;
  avatar_color: string;
};

const emptyMember: MemberForm = {
  name: "",
  email: "",
  job_title: "",
  access_role: "colaborador",
  department_id: "",
  capacity_points: 20,
  avatar_color: "indigo",
};

function TeamPanel() {
  const { members, departments, tasks } = useWorkspaceData();
  const invalidate = useInvalidate(["members"]);
  const [form, setForm] = useState<MemberForm | null>(null);

  const save = useMutation({
    mutationFn: async (f: MemberForm) => {
      const payload = {
        name: f.name.trim(),
        email: f.email.trim(),
        job_title: f.job_title.trim() || null,
        access_role: f.access_role,
        department_id: f.department_id || null,
        capacity_points: Number(f.capacity_points) || 20,
        avatar_color: f.avatar_color,
      };
      if (f.id) await updateMember(f.id, payload);
      else await createMember(payload);
    },
    onSuccess: () => {
      invalidate();
      setForm(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteMember(id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Equipe e níveis de acesso"
        description="O nível de acesso define o que a pessoa pode fazer no workspace."
        action={
          <button onClick={() => setForm({ ...emptyMember })} className={primaryBtn}>
            <Plus className="size-4" /> Novo membro
          </button>
        }
      />

      {form && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
          className="card-surface grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div className="flex items-center justify-between sm:col-span-2 lg:col-span-3">
            <p className="text-sm font-medium">{form.id ? "Editar membro" : "Novo membro"}</p>
            <button type="button" onClick={() => setForm(null)} aria-label="Fechar">
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
          <Field label="Nome">
            <input
              required
              className={input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="E-mail">
            <input
              required
              type="email"
              className={input}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Cargo">
            <input
              className={input}
              value={form.job_title}
              onChange={(e) => setForm({ ...form, job_title: e.target.value })}
            />
          </Field>
          <Field label="Nível de acesso">
            <select
              className={input}
              value={form.access_role}
              onChange={(e) => setForm({ ...form, access_role: e.target.value })}
            >
              {ACCESS_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ACCESS_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Departamento">
            <select
              className={input}
              value={form.department_id}
              onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            >
              <option value="">Sem departamento</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Capacidade (pontos)">
            <input
              type="number"
              min={1}
              className={input}
              value={form.capacity_points}
              onChange={(e) => setForm({ ...form, capacity_points: Number(e.target.value) })}
            />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" disabled={save.isPending} className={primaryBtn}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      )}

      {members.length === 0 ? (
        <EmptyState
          title="Nenhum membro cadastrado"
          description="Adicione pessoas para distribuir tarefas e acompanhar a produtividade."
        />
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="row-card row-card-hover">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {initials(m.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <Pill tone={m.access_role === "admin" ? "info" : "neutral"}>
                    {ACCESS_ROLE_LABEL[m.access_role] ?? m.access_role}
                  </Pill>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {[m.job_title, m.email].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="hidden gap-8 md:grid md:grid-cols-3">
                <MetaItem label="Departamento">{nameById(departments, m.department_id)}</MetaItem>
                <MetaItem label="Capacidade">{m.capacity_points} pts</MetaItem>
                <MetaItem label="Tarefas">
                  {tasks.filter((t) => t.assignee_id === m.id).length}
                </MetaItem>
              </div>
              <RowMenu
                actions={[
                  {
                    label: "Editar",
                    icon: Pencil,
                    onSelect: () =>
                      setForm({
                        id: m.id,
                        name: m.name,
                        email: m.email,
                        job_title: m.job_title ?? "",
                        access_role: m.access_role,
                        department_id: m.department_id ?? "",
                        capacity_points: m.capacity_points,
                        avatar_color: m.avatar_color,
                      }),
                  },
                  {
                    label: "Excluir",
                    icon: Trash2,
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => remove.mutate(m.id),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Departamentos ---------------------------- */

function DepartmentsPanel() {
  const { departments, members, projects } = useWorkspaceData();
  const invalidate = useInvalidate(["departments"]);
  const [form, setForm] = useState<{ id?: string; name: string; color: string } | null>(null);

  const save = useMutation({
    mutationFn: async (f: { id?: string; name: string; color: string }) => {
      const payload = { name: f.name.trim(), color: f.color };
      if (f.id) await updateDepartment(f.id, payload);
      else await createDepartment(payload);
    },
    onSuccess: () => {
      invalidate();
      setForm(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteDepartment(id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Departamentos"
        description="Agrupe a equipe e os projetos por área."
        action={
          <button onClick={() => setForm({ name: "", color: "blue" })} className={primaryBtn}>
            <Plus className="size-4" /> Novo departamento
          </button>
        }
      />

      {form && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
          className="card-surface grid gap-5 p-6 sm:grid-cols-3"
        >
          <Field label="Nome">
            <input
              required
              className={input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Cor">
            <select
              className={input}
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            >
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <button type="submit" className={primaryBtn}>
              Salvar
            </button>
            <button type="button" onClick={() => setForm(null)} className={ghostBtn}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {departments.length === 0 ? (
        <EmptyState
          title="Nenhum departamento cadastrado"
          description="Departamentos ajudam a comparar produtividade entre áreas."
        />
      ) : (
        <div className="space-y-2">
          {departments.map((d) => (
            <div key={d.id} className="row-card row-card-hover">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <Pill>{d.color}</Pill>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {members.filter((m) => m.department_id === d.id).length} pessoas ·{" "}
                  {projects.filter((p) => p.department_id === d.id).length} projetos
                </p>
              </div>
              <RowMenu
                actions={[
                  {
                    label: "Editar",
                    icon: Pencil,
                    onSelect: () => setForm({ id: d.id, name: d.name, color: d.color }),
                  },
                  {
                    label: "Excluir",
                    icon: Trash2,
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => remove.mutate(d.id),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Clientes ------------------------------- */

function ClientsPanel() {
  const { clients, projects } = useWorkspaceData();
  const invalidate = useInvalidate(["clients"]);
  const [form, setForm] = useState<{ id?: string; name: string; contact_email: string } | null>(
    null,
  );

  const save = useMutation({
    mutationFn: async (f: { id?: string; name: string; contact_email: string }) => {
      const payload = { name: f.name.trim(), contact_email: f.contact_email.trim() || null };
      if (f.id) await updateClient(f.id, payload);
      else await createClient(payload);
    },
    onSuccess: () => {
      invalidate();
      setForm(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteClient(id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Clientes"
        description="Vincule projetos e tarefas aos clientes atendidos."
        action={
          <button onClick={() => setForm({ name: "", contact_email: "" })} className={primaryBtn}>
            <Plus className="size-4" /> Novo cliente
          </button>
        }
      />

      {form && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
          className="card-surface grid gap-5 p-6 sm:grid-cols-3"
        >
          <Field label="Nome">
            <input
              required
              className={input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="E-mail de contato">
            <input
              type="email"
              className={input}
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </Field>
          <div className="flex items-end gap-2">
            <button type="submit" className={primaryBtn}>
              Salvar
            </button>
            <button type="button" onClick={() => setForm(null)} className={ghostBtn}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {clients.length === 0 ? (
        <EmptyState
          title="Nenhum cliente cadastrado"
          description="Clientes permitem filtrar projetos e relatórios por conta atendida."
        />
      ) : (
        <div className="space-y-2">
          {clients.map((c) => (
            <div key={c.id} className="row-card row-card-hover">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {[c.contact_email, `${projects.filter((p) => p.client_id === c.id).length} projetos`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <RowMenu
                actions={[
                  {
                    label: "Editar",
                    icon: Pencil,
                    onSelect: () =>
                      setForm({ id: c.id, name: c.name, contact_email: c.contact_email ?? "" }),
                  },
                  {
                    label: "Excluir",
                    icon: Trash2,
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => remove.mutate(c.id),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- bits --------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-normal text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
