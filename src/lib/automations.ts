import { linkTaskToProject, setFieldValue, setTaskProjectSection, type Automation } from "./asana";
import type { Task } from "./domain";

export type AutoEvent =
  | "task_created"
  | "status_changed"
  | "assignee_changed"
  | "section_changed"
  | "field_changed";

export const TRIGGER_LABEL: Record<AutoEvent, string> = {
  task_created: "Quando a tarefa é criada",
  status_changed: "Quando o status muda",
  assignee_changed: "Quando o responsável muda",
  section_changed: "Quando a seção muda",
  field_changed: "Quando o valor de coluna muda",
};

export const ACTION_LABEL: Record<string, string> = {
  set_status: "Definir status",
  set_assignee: "Definir responsável",
  set_priority: "Definir prioridade",
  set_sprint: "Definir sprint",
  set_task_type: "Definir tipo de tarefa",
  add_tag: "Adicionar etiqueta",
  move_section: "Mover para seção",
  move_project: "Mover para outro projeto",
  add_project: "Incluir em outro projeto",
  notify_assignee: "Notificar responsável",
  set_field: "Definir valor de coluna",
};

/**
 * Codifica um par (campo, valor) em uma string única para caber em
 * trigger_value / action_value (colunas texto). Formato: "<field_id>::<value>".
 * Escolhi "::" porque é fácil de reconhecer e não colide com uuid nem com
 * valores comuns que usuários digitam.
 */
export const FIELD_VALUE_SEP = "::";
export function encodeFieldValue(fieldId: string, value: string): string {
  return `${fieldId}${FIELD_VALUE_SEP}${value}`;
}
export function decodeFieldValue(raw: string | null): { fieldId: string; value: string } | null {
  if (!raw) return null;
  const i = raw.indexOf(FIELD_VALUE_SEP);
  if (i < 0) return null;
  return { fieldId: raw.slice(0, i), value: raw.slice(i + FIELD_VALUE_SEP.length) };
}

/** Movimentações entre seções/projetos pedidas pelas automações. */
export type AutoMoves = {
  sectionId?: string | null;
  moveToProjectId?: string | null;
  addProjectIds: string[];
  /** Campos personalizados a gravar em task_field_values. */
  fieldValues: { fieldId: string; value: string }[];
};

/**
 * Contexto extra pro trigger field_changed: qual campo mudou e para qual
 * valor. Passado no lugar de status/assignee em runAutomations.
 */
export type FieldChange = { fieldId: string; value: string };

/**
 * Container(s) em que a alteração está acontecendo. Um mesmo evento pode
 * atingir os dois lados — uma tarefa que pertence a projeto P e a
 * departamento D, ao mudar de status, deve disparar as automações de P E
 * as automações de D. Por isso o container aceita os dois, ao invés de
 * ser union.
 *
 * O filtro é: a regra bate quando o container preenche o campo do lado
 * que a regra usa. Regra com project_id só casa se o container tem
 * projectId igual. Regra com department_id só casa se o container tem
 * departmentId igual. Nunca vaza para outro contexto.
 */
export type AutomationContainer = {
  projectId?: string | null;
  departmentId?: string | null;
};

/**
 * Aplica as automações ativas do container e devolve o patch resultante.
 * Para o evento field_changed, passe { ...task, fieldChange: { fieldId, value } }
 * no argumento task — o filtro compara com o trigger_value codificado.
 */
export function runAutomations(
  automations: Automation[],
  event: AutoEvent,
  task: Partial<Task> & { fieldChange?: FieldChange },
  container: AutomationContainer,
) {
  const patch: Record<string, unknown> = {};
  const applied: string[] = [];
  const moves: AutoMoves = { addProjectIds: [], fieldValues: [] };
  let notify = false;

  const containerMatches = (a: Automation) => {
    if (a.project_id != null) {
      return container.projectId != null && a.project_id === container.projectId;
    }
    if (a.department_id != null) {
      return container.departmentId != null && a.department_id === container.departmentId;
    }
    return false;
  };

  for (const a of automations) {
    if (!a.active || !containerMatches(a) || a.trigger_type !== event) continue;
    if (a.trigger_value && event === "status_changed" && a.trigger_value !== task.status) continue;
    if (a.trigger_value && event === "section_changed" && a.trigger_value !== task.section_id) continue;
    if (event === "field_changed") {
      const expected = decodeFieldValue(a.trigger_value);
      const actual = task.fieldChange;
      if (!expected || !actual) continue;
      // O gatilho só bate no campo certo. Valor esperado vazio =
      // "qualquer valor no campo" — o usuário pode querer só saber que
      // o campo mudou; se preencheu com valor específico, exige match.
      if (expected.fieldId !== actual.fieldId) continue;
      if (expected.value && expected.value !== actual.value) continue;
    }
    if (!a.action_value && a.action_type !== "notify_assignee") continue;

    switch (a.action_type) {
      case "set_status":
        patch["status"] = a.action_value;
        break;
      case "set_assignee":
        patch["assignee_id"] = a.action_value;
        break;
      case "set_priority":
        patch["priority"] = a.action_value;
        break;
      case "set_sprint":
        patch["sprint"] = a.action_value;
        break;
      case "set_task_type":
        patch["task_type"] = a.action_value;
        break;
      case "add_tag":
        patch["tags"] = [...new Set([...(task.tags ?? []), a.action_value as string])];
        break;
      case "move_section":
        moves.sectionId = a.action_value;
        patch["section_id"] = a.action_value;
        break;
      case "move_project":
        moves.moveToProjectId = a.action_value;
        patch["project_id"] = a.action_value;
        patch["section_id"] = null;
        break;
      case "add_project":
        moves.addProjectIds.push(a.action_value as string);
        break;
      case "notify_assignee":
        notify = true;
        break;
      case "set_field": {
        const target = decodeFieldValue(a.action_value);
        if (target) moves.fieldValues.push(target);
        break;
      }
      default:
        break;
    }
    applied.push(a.name);
  }

  return { patch, notify, applied, moves };
}

/**
 * Executa as movimentações de seção/projeto resultantes das automações.
 * Assinatura aceita o mesmo container do runAutomations. Para departamento,
 * setTaskProjectSection não é chamado (task_projects é vínculo projeto—
 * tarefa, não tem departamento). O section_id do move já foi aplicado no
 * patch do runAutomations, o que basta.
 */
export async function applyAutomationMoves(
  taskId: string,
  container: AutomationContainer,
  moves: AutoMoves,
) {
  if (moves.sectionId !== undefined && container.projectId != null) {
    await setTaskProjectSection(taskId, container.projectId, moves.sectionId);
  }
  if (moves.moveToProjectId) {
    await linkTaskToProject(taskId, moves.moveToProjectId, null);
  }
  for (const pid of moves.addProjectIds) {
    await linkTaskToProject(taskId, pid, null);
  }
  for (const { fieldId, value } of moves.fieldValues) {
    // task_field_values usa upsert, então sobrescrever valor existente é OK.
    await setFieldValue(taskId, fieldId, value || null);
  }
}
