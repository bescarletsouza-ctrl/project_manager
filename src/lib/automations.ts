import { linkTaskToProject, setTaskProjectSection, type Automation } from "./asana";
import type { Task } from "./domain";

export type AutoEvent = "task_created" | "status_changed" | "assignee_changed";

export const TRIGGER_LABEL: Record<AutoEvent, string> = {
  task_created: "Quando a tarefa é criada",
  status_changed: "Quando o status muda",
  assignee_changed: "Quando o responsável muda",
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
};

/** Movimentações entre seções/projetos pedidas pelas automações. */
export type AutoMoves = {
  sectionId?: string | null;
  moveToProjectId?: string | null;
  addProjectIds: string[];
};

/**
 * Container que "dispara" as automações. Antes só existia projeto — agora
 * um departamento também pode ter regras próprias (com o mesmo formato).
 * Convenção: passar { projectId } se veio de projeto (mesmo que null para
 * task sem projeto) OU { departmentId } se veio do departamento. Nunca os
 * dois — as automações vivem em um contexto só.
 */
export type AutomationContainer =
  | { projectId: string | null; departmentId?: undefined }
  | { departmentId: string; projectId?: undefined };

/**
 * Aplica as automações ativas do container e devolve o patch resultante.
 * O filtro é: automation.project_id === container.projectId (quando o
 * container é projeto) OU automation.department_id === container.departmentId
 * (quando é departamento).
 */
export function runAutomations(
  automations: Automation[],
  event: AutoEvent,
  task: Partial<Task>,
  container: AutomationContainer,
) {
  const patch: Record<string, unknown> = {};
  const applied: string[] = [];
  const moves: AutoMoves = { addProjectIds: [] };
  let notify = false;

  const containerMatches = (a: Automation) =>
    container.departmentId !== undefined
      ? a.department_id === container.departmentId
      : a.project_id === container.projectId;

  for (const a of automations) {
    if (!a.active || !containerMatches(a) || a.trigger_type !== event) continue;
    if (a.trigger_value && event === "status_changed" && a.trigger_value !== task.status) continue;
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
}
