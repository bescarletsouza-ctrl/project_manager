import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, Modal } from "@/components/ui-bits";
import {
  createDepartment,
  createProject,
  departmentsQuery,
  membersQuery,
  projectsQuery,
} from "@/lib/data";
import { useInvalidate } from "@/lib/useData";
import {
  createPortfolio,
  createSection,
  createTaskLinked,
  notifyAssignment,
  portfoliosQuery,
  sectionsQuery,
} from "@/lib/asana";
import { useCurrentMember } from "@/lib/useAsana";
import { COLOR_KEYS, dotClass } from "@/lib/colors";
import { PRIORITIES, PRIORITY_LABEL, PROJECT_STATUS, PROJECT_STATUS_LABEL } from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Seções criadas junto com um projeto novo, como no Asana. */
const DEFAULT_SECTIONS = ["A fazer", "Em andamento", "Concluído"];

/**
 * Diálogo de nova tarefa. Aceita contexto opcional (projeto OU departamento)
 * para pré-preencher — por exemplo, o botão "Nova tarefa" dentro da página de
 * um departamento já vem com o departamento selecionado.
 */
export function NewTaskDialog({
  onClose,
  projectId,
  departmentId,
}: {
  onClose: () => void;
  projectId?: string;
  departmentId?: string;
}) {
  const invalidateNewTask = useInvalidate(["tasks", "task_projects"]);
  const { member } = useCurrentMember();
  const projects = useQuery(projectsQuery).data ?? [];
  const sections = useQuery(sectionsQuery).data ?? [];
  const members = useQuery(membersQuery).data ?? [];
  const departments = useQuery(departmentsQuery).data ?? [];
  const [form, setForm] = useState({
    title: "",
    project_id: projectId ?? "",
    department_id: departmentId ?? "",
    assignee_id: member?.id ?? "",
    due_date: "",
    priority: "media",
  });

  const save = useMutation({
    mutationFn: async () => {
      // A tarefa cai na primeira seção do container escolhido — projeto tem
      // prioridade (é o vínculo forte, com task_projects), departamento é
      // usado só quando não há projeto (seção pertence direto ao departamento).
      const containerSections = form.project_id
        ? sections.filter((s) => s.project_id === form.project_id)
        : form.department_id
          ? sections.filter((s) => s.department_id === form.department_id)
          : [];
      const sectionId = containerSections[0]?.id ?? null;
      const title = form.title.trim();
      const taskId = await createTaskLinked(
        {
          title,
          project_id: form.project_id || null,
          department_id: form.department_id || null,
          section_id: sectionId,
          assignee_id: form.assignee_id || null,
          due_date: form.due_date || null,
          priority: form.priority,
          status: "a_fazer",
        },
        form.project_id ? [form.project_id] : [],
      );
      await notifyAssignment(
        { id: taskId, title, project_id: form.project_id || null },
        form.assignee_id || null,
        member?.id ?? null,
      );
    },
    onSuccess: () => {
      invalidateNewTask();
      toast.success("Tarefa criada.");
      onClose();
    },
    onError: () => toast.error("Não foi possível criar a tarefa."),
  });

  const canSave = form.title.trim().length >= 3 && !save.isPending;

  return (
    <Modal
      title="Nova tarefa"
      description="Só o nome é obrigatório — o resto dá para ajustar depois."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button onClick={() => canSave && save.mutate()} disabled={!canSave} className="btn btn-primary">
            {save.isPending ? "Criando..." : "Criar tarefa"}
          </button>
        </>
      }
    >
      <input
        autoFocus
        placeholder="Nome da tarefa"
        maxLength={140}
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && canSave && save.mutate()}
        className="field w-full text-[15px]"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Projeto">
          <select
            className="field w-full"
            value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value })}
          >
            <option value="">Sem projeto</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Departamento">
          <select
            className="field w-full"
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
        <Field label="Responsável">
          <select
            className="field w-full"
            value={form.assignee_id}
            onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
          >
            <option value="">Sem responsável</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prazo">
          <input
            type="date"
            className="field w-full"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
        </Field>
        <Field label="Prioridade">
          <select
            className="field w-full"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const invalidateNewProject = useInvalidate(["projects", "sections"]);
  const navigate = useNavigate();
  const members = useQuery(membersQuery).data ?? [];
  const portfolios = useQuery(portfoliosQuery).data ?? [];
  const [form, setForm] = useState({
    name: "",
    description: "",
    manager_id: "",
    portfolio_id: "",
    status: "planejamento",
    due_date: "",
    color: "indigo" as string,
  });

  const save = useMutation({
    mutationFn: async () => {
      const id = await createProject({
        name: form.name.trim(),
        description: form.description || null,
        manager_id: form.manager_id || null,
        portfolio_id: form.portfolio_id || null,
        status: form.status,
        due_date: form.due_date || null,
        color: form.color,
      });
      await Promise.all(
        DEFAULT_SECTIONS.map((name, position) => createSection({ project_id: id, name, position })),
      );
      return id;
    },
    onSuccess: (id) => {
      invalidateNewProject();
      toast.success("Projeto criado com as seções padrão.");
      onClose();
      navigate({ to: "/projetos/$projectId", params: { projectId: id } });
    },
    onError: (e: unknown) => toast.error(`Não foi possível criar o projeto: ${(e as Error)?.message ?? "erro"}`),
  });

  const canSave = form.name.trim().length >= 3 && !save.isPending;

  return (
    <Modal
      title="Novo projeto"
      description="Ele já nasce com as seções A fazer, Em andamento e Concluído."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button onClick={() => canSave && save.mutate()} disabled={!canSave} className="btn btn-primary">
            {save.isPending ? "Criando..." : "Criar projeto"}
          </button>
        </>
      }
    >
      <input
        autoFocus
        placeholder="Nome do projeto"
        maxLength={120}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        className="field w-full text-[15px]"
      />
      <textarea
        placeholder="O que este projeto entrega?"
        maxLength={1000}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className="field h-20 w-full"
      />
      <Field label="Cor">
        <div className="flex flex-wrap gap-1.5 pt-1">
          {COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setForm({ ...form, color: c })}
              className={cn(
                "size-6 rounded-md ring-offset-2 ring-offset-background transition",
                dotClass(c),
                form.color === c && "ring-2 ring-foreground/40",
              )}
            />
          ))}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Gestor">
          <select
            className="field w-full"
            value={form.manager_id}
            onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
          >
            <option value="">Sem gestor</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Portfólio">
          <select
            className="field w-full"
            value={form.portfolio_id}
            onChange={(e) => setForm({ ...form, portfolio_id: e.target.value })}
          >
            <option value="">Sem portfólio</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="field w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {PROJECT_STATUS.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Entrega">
          <input
            type="date"
            className="field w-full"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Diálogo simples de novo portfólio. A página /portfolios continua tendo o
 * form inline (para edição em lote); esse aqui é o atalho da sidebar/topbar
 * para não precisar navegar toda vez.
 */
export function NewPortfolioDialog({ onClose }: { onClose: () => void }) {
  const invalidatePortfolios = useInvalidate(["portfolios"]);
  const navigate = useNavigate();
  const members = useQuery(membersQuery).data ?? [];
  const [form, setForm] = useState({ name: "", description: "", owner_id: "", color: "blue" });

  const save = useMutation({
    mutationFn: () =>
      createPortfolio({
        name: form.name.trim(),
        description: form.description || null,
        owner_id: form.owner_id || null,
        color: form.color,
      }),
    onSuccess: () => {
      invalidatePortfolios();
      toast.success("Portfólio criado.");
      onClose();
      navigate({ to: "/portfolios" });
    },
    onError: (e: unknown) => toast.error(`Não foi possível criar: ${(e as Error)?.message ?? "erro"}`),
  });

  const canSave = form.name.trim().length >= 2 && !save.isPending;

  return (
    <Modal
      title="Novo portfólio"
      description="Agrupe projetos por frente da operação."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button onClick={() => canSave && save.mutate()} disabled={!canSave} className="btn btn-primary">
            {save.isPending ? "Criando…" : "Criar portfólio"}
          </button>
        </>
      }
    >
      <input
        autoFocus
        placeholder="Nome do portfólio"
        maxLength={80}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && canSave && save.mutate()}
        className="field w-full text-[15px]"
      />
      <textarea
        placeholder="Descrição (opcional)"
        maxLength={280}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className="field h-20 w-full"
      />
      <Field label="Cor">
        <div className="flex flex-wrap gap-1.5 pt-1">
          {COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setForm({ ...form, color: c })}
              className={cn(
                "size-6 rounded-md ring-offset-2 ring-offset-background transition",
                dotClass(c),
                form.color === c && "ring-2 ring-foreground/40",
              )}
            />
          ))}
        </div>
      </Field>
      <Field label="Responsável">
        <select
          className="field w-full"
          value={form.owner_id}
          onChange={(e) => setForm({ ...form, owner_id: e.target.value })}
        >
          <option value="">Sem responsável</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

/**
 * Diálogo simples de novo departamento. Atalho da sidebar/topbar — evita
 * mandar o usuário para /departamentos toda vez que precisa criar um. A
 * criação já existia também em Configurações → Departamentos (só admin);
 * este atalho não tem essa restrição.
 */
export function NewDepartmentDialog({ onClose }: { onClose: () => void }) {
  const invalidateDepartments = useInvalidate(["departments"]);
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", color: "blue" });

  const save = useMutation({
    mutationFn: () =>
      createDepartment({ name: form.name.trim(), color: form.color }),
    onSuccess: () => {
      invalidateDepartments();
      toast.success("Departamento criado.");
      onClose();
      navigate({ to: "/departamentos" });
    },
    onError: (e: unknown) => toast.error(`Não foi possível criar: ${(e as Error)?.message ?? "erro"}`),
  });

  const canSave = form.name.trim().length >= 2 && !save.isPending;

  return (
    <Modal
      title="Novo departamento"
      description="Ex.: Marketing, Financeiro, Operações."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button onClick={() => canSave && save.mutate()} disabled={!canSave} className="btn btn-primary">
            {save.isPending ? "Criando…" : "Criar departamento"}
          </button>
        </>
      }
    >
      <input
        autoFocus
        placeholder="Nome do departamento"
        maxLength={80}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && canSave && save.mutate()}
        className="field w-full text-[15px]"
      />
      <Field label="Cor">
        <div className="flex flex-wrap gap-1.5 pt-1">
          {COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setForm({ ...form, color: c })}
              className={cn(
                "size-6 rounded-md ring-offset-2 ring-offset-background transition",
                dotClass(c),
                form.color === c && "ring-2 ring-foreground/40",
              )}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}
