import { supabase } from "@/integrations/supabase/client";
import {
  DEADLINE_STATUS_LABEL,
  PRIORITY_LABEL,
  STATUS_META,
  TASK_TYPE_LABEL,
  deadlineStatus,
  todayLocalIso,
  type Client,
  type Department,
  type Member,
  type Project,
  type Task,
} from "./domain";
import type {
  CustomField,
  Section,
  TaskDependency,
  TaskDepartment,
  TaskFieldValue,
  TaskProject,
} from "./asana";
import { buildXlsx, downloadXlsx, type XlsxCell, type XlsxColumn } from "./xlsx";

/** Colunas que existem na tabela tasks mas não fazem parte do tipo Task do app (integração com o Fillipin). */
type TaskRow = Task & {
  fillipin_sent_at?: string | null;
  fillipin_sync_error?: string | null;
};

const PAGE_SIZE = 1000;

/**
 * Lê a tabela inteira em páginas — o PostgREST corta cada resposta em 1000
 * linhas, então um select simples truncaria silenciosamente uma exportação
 * de "todas as tarefas" assim que o workspace passasse disso.
 */
async function fetchAll<T>(table: string, columns = "*"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table as never)
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** A descrição é HTML (editor rico) — vira texto puro, preservando quebras de linha e marcando imagens. */
function htmlToText(html: string | null): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<img[^>]*>/gi, "[imagem]")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

const yesNo = (v: boolean) => (v ? "Sim" : "Não");

function group<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function customCell(value: string | null, type: CustomField["field_type"]): XlsxCell {
  if (value === null || value === "") return null;
  if (type === "number") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : value;
  }
  if (type === "date") return { date: value };
  return value;
}

/**
 * Exporta TODAS as tarefas (abertas, concluídas e canceladas, sem depender de
 * filtro da tela) pra um .xlsx com todos os campos nativos já resolvidos pra
 * nome legível (responsável, projeto, seção...) mais uma coluna por campo
 * personalizado. Busca direto do banco, em páginas, em vez de reaproveitar o
 * cache da tela — assim não trunca em 1000 linhas nem esconde nada por filtro.
 */
export async function exportTasksToExcel(): Promise<{ count: number }> {
  const [
    tasks,
    members,
    departments,
    projects,
    clients,
    sections,
    taskProjects,
    taskDepartments,
    customFields,
    fieldValues,
    comments,
    attachments,
    dependencies,
  ] = await Promise.all([
    fetchAll<TaskRow>("tasks"),
    fetchAll<Member>("members"),
    fetchAll<Department>("departments"),
    fetchAll<Project>("projects"),
    fetchAll<Client>("clients"),
    fetchAll<Section>("sections"),
    fetchAll<TaskProject>("task_projects"),
    fetchAll<TaskDepartment>("task_departments"),
    fetchAll<CustomField>("custom_fields"),
    fetchAll<TaskFieldValue>("task_field_values"),
    fetchAll<{ task_id: string }>("task_comments", "id, task_id"),
    fetchAll<{ task_id: string }>("task_attachments", "id, task_id"),
    fetchAll<TaskDependency>("task_dependencies"),
  ]);

  const memberById = new Map(members.map((m) => [m.id, m]));
  const departmentById = new Map(departments.map((d) => [d.id, d]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const fieldById = new Map(customFields.map((f) => [f.id, f]));

  const linksByTask = group(taskProjects, (l) => l.task_id);
  const extraDeptsByTask = group(taskDepartments, (d) => d.task_id);
  const valuesByTask = group(fieldValues, (v) => v.task_id);
  const commentsByTask = group(comments, (c) => c.task_id);
  const attachmentsByTask = group(attachments, (a) => a.task_id);
  const blockersByTask = group(dependencies, (d) => d.task_id);
  const subtasksByParent = group(
    tasks.filter((t) => t.parent_task_id),
    (t) => t.parent_task_id as string,
  );

  const withSection = (name: string, sectionId: string | null) => {
    const section = sectionId ? sectionById.get(sectionId) : undefined;
    return section ? `${name} (${section.name})` : name;
  };

  type Col = { column: XlsxColumn; get: (t: TaskRow) => XlsxCell };
  const baseColumns: Col[] = [
    { column: { header: "ID", width: 38 }, get: (t) => t.id },
    { column: { header: "Título", width: 48 }, get: (t) => t.title },
    { column: { header: "Descrição", width: 60 }, get: (t) => htmlToText(t.description) },
    { column: { header: "Status", width: 22 }, get: (t) => STATUS_META[t.status]?.label ?? t.status },
    { column: { header: "Prioridade", width: 12 }, get: (t) => PRIORITY_LABEL[t.priority] ?? t.priority },
    { column: { header: "Tipo", width: 14 }, get: (t) => TASK_TYPE_LABEL[t.task_type] ?? t.task_type },
    {
      column: { header: "Responsável", width: 24 },
      get: (t) => (t.assignee_id ? (memberById.get(t.assignee_id)?.name ?? null) : null),
    },
    {
      column: { header: "E-mail do responsável", width: 30 },
      get: (t) => (t.assignee_id ? (memberById.get(t.assignee_id)?.email ?? null) : null),
    },
    {
      column: { header: "Criado por", width: 24 },
      get: (t) => (t.created_by ? (memberById.get(t.created_by)?.name ?? null) : null),
    },
    {
      column: { header: "Projeto", width: 28 },
      get: (t) => (t.project_id ? (projectById.get(t.project_id)?.name ?? null) : null),
    },
    {
      column: { header: "Outros projetos", width: 32 },
      get: (t) => {
        const extras = (linksByTask.get(t.id) ?? [])
          .filter((l) => l.project_id !== t.project_id)
          .map((l) => withSection(projectById.get(l.project_id)?.name ?? "—", l.section_id));
        return extras.length ? extras.join("; ") : null;
      },
    },
    {
      column: { header: "Departamento", width: 22 },
      get: (t) => (t.department_id ? (departmentById.get(t.department_id)?.name ?? null) : null),
    },
    {
      column: { header: "Outros departamentos", width: 28 },
      get: (t) => {
        const extras = (extraDeptsByTask.get(t.id) ?? []).map((d) =>
          withSection(departmentById.get(d.department_id)?.name ?? "—", d.section_id),
        );
        return extras.length ? extras.join("; ") : null;
      },
    },
    {
      column: { header: "Cliente", width: 24 },
      get: (t) => (t.client_id ? (clientById.get(t.client_id)?.name ?? null) : null),
    },
    {
      column: { header: "Seção", width: 22 },
      get: (t) => (t.section_id ? (sectionById.get(t.section_id)?.name ?? null) : null),
    },
    { column: { header: "Sprint", width: 14 }, get: (t) => t.sprint },
    { column: { header: "Etiquetas", width: 26 }, get: (t) => (t.tags?.length ? t.tags.join(", ") : null) },
    { column: { header: "Marco", width: 8 }, get: (t) => yesNo(t.is_milestone) },
    {
      column: { header: "Tarefa pai", width: 36 },
      get: (t) => (t.parent_task_id ? (taskById.get(t.parent_task_id)?.title ?? null) : null),
    },
    { column: { header: "Subtarefas", width: 11 }, get: (t) => subtasksByParent.get(t.id)?.length ?? 0 },
    { column: { header: "Data de início", width: 14 }, get: (t) => (t.start_date ? { date: t.start_date } : null) },
    { column: { header: "Prazo", width: 14 }, get: (t) => (t.due_date ? { date: t.due_date } : null) },
    { column: { header: "Situação do prazo", width: 18 }, get: (t) => DEADLINE_STATUS_LABEL[deadlineStatus(t)] },
    { column: { header: "Iniciada em", width: 18 }, get: (t) => (t.started_at ? { datetime: t.started_at } : null) },
    { column: { header: "Concluída em", width: 18 }, get: (t) => (t.completed_at ? { datetime: t.completed_at } : null) },
    { column: { header: "Criada em", width: 18 }, get: (t) => ({ datetime: t.created_at }) },
    { column: { header: "Complexidade (pts)", width: 12 }, get: (t) => t.complexity },
    { column: { header: "Reaberturas", width: 12 }, get: (t) => t.reopen_count },
    { column: { header: "Revisões", width: 10 }, get: (t) => t.review_count },
    { column: { header: "Motivo do bloqueio", width: 30 }, get: (t) => t.block_reason },
    {
      column: { header: "Bloqueada por", width: 36 },
      get: (t) => {
        const titles = (blockersByTask.get(t.id) ?? []).map((d) => taskById.get(d.blocked_by_task_id)?.title ?? "—");
        return titles.length ? titles.join("; ") : null;
      },
    },
    { column: { header: "Fora do planejamento", width: 14 }, get: (t) => yesNo(t.unplanned) },
    { column: { header: "Comentários", width: 12 }, get: (t) => commentsByTask.get(t.id)?.length ?? 0 },
    { column: { header: "Anexos", width: 9 }, get: (t) => attachmentsByTask.get(t.id)?.length ?? 0 },
    {
      column: { header: "Enviada ao Fillipin em", width: 18 },
      get: (t) => (t.fillipin_sent_at ? { datetime: t.fillipin_sent_at } : null),
    },
    { column: { header: "Erro no envio ao Fillipin", width: 30 }, get: (t) => t.fillipin_sync_error ?? null },
  ];

  // Campo personalizado é por projeto; o mesmo nome em projetos diferentes
  // vira uma coluna só (comparando sem diferenciar caixa).
  const customNames = new Map<string, string>();
  for (const f of [...customFields].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))) {
    const key = f.name.trim().toLowerCase();
    if (!customNames.has(key)) customNames.set(key, f.name.trim());
  }
  const customColumns: Col[] = [...customNames.entries()].map(([key, label]) => ({
    column: { header: `Campo: ${label}`, width: 20 },
    get: (t) => {
      let cell: XlsxCell = null;
      for (const v of valuesByTask.get(t.id) ?? []) {
        const field = fieldById.get(v.field_id);
        if (!field || field.name.trim().toLowerCase() !== key) continue;
        const next = customCell(v.value, field.field_type);
        if (next !== null) cell = next;
      }
      return cell;
    },
  }));

  const cols = [...baseColumns, ...customColumns];
  const ordered = [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at));

  const bytes = buildXlsx({
    name: "Tarefas",
    columns: cols.map((c) => c.column),
    rows: ordered.map((t) => cols.map((c) => c.get(t))),
  });
  downloadXlsx(bytes, `tarefas-alana-${todayLocalIso()}.xlsx`);

  return { count: ordered.length };
}
