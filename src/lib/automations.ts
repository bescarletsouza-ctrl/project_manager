import {
  addTaskToDepartment,
  linkTaskToProject,
  removeTaskFromDepartment,
  setFieldValue,
  setTaskDepartmentSection,
  setTaskProjectSection,
  type Automation,
  type Section,
  type TaskDepartment,
  type TaskProject,
} from "./asana";
import { updateTask } from "./data";
import { isApprovalSectionName, isReworkSectionName, isUnplannedSectionName, type Task } from "./domain";

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
  /**
   * Só de automação de PROJETO — grava em task_projects (via
   * applyAutomationMoves), nunca em task.section_id. Automação de
   * departamento grava direto em patch["section_id"] (ver runAutomations),
   * porque esse é o campo nativo da tarefa pro departamento.
   */
  projectSectionId?: string | null;
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
        // "Mover para seção" de automação de DEPARTAMENTO grava direto no
        // campo nativo da tarefa. De PROJETO vai para task_projects (via
        // moves.projectSectionId) — só espelha em section_id também quando
        // a tarefa não tem departamento (senão pisaria na posição dele).
        // Sem essa distinção, uma tarefa com projeto E departamento que
        // dispara os dois lados juntos tinha o último a rodar sobrescrevendo
        // o outro no mesmo campo.
        if (a.department_id != null) {
          patch["section_id"] = a.action_value;
        } else if (a.project_id != null) {
          moves.projectSectionId = a.action_value;
          if (!task.department_id) patch["section_id"] = a.action_value;
        }
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
 * Mesma coisa que runAutomations, mas roda uma vez por CADA departamento da
 * tarefa (principal + extras) e mescla o resultado — sem isso, os ~15 pontos
 * que hoje montam { projectId, departmentId: task.department_id } só
 * enxergam o departamento principal, nunca os extras. `departmentIds` é a
 * lista completa (ver taskDepartmentIdsOf); vazia = tarefa sem departamento
 * (roda uma vez só, com departmentId null, igual hoje).
 */
export function runAutomationsForTask(
  automations: Automation[],
  event: AutoEvent,
  task: Partial<Task> & { fieldChange?: FieldChange },
  extra: { projectId?: string | null; departmentIds: string[] },
) {
  const patch: Record<string, unknown> = {};
  const applied: string[] = [];
  const moves: AutoMoves = { addProjectIds: [], fieldValues: [] };
  let notify = false;
  const containers = extra.departmentIds.length
    ? extra.departmentIds.map((departmentId) => ({ projectId: extra.projectId, departmentId }))
    : [{ projectId: extra.projectId, departmentId: null }];

  for (const container of containers) {
    const r = runAutomations(automations, event, task, container);
    Object.assign(patch, r.patch);
    applied.push(...r.applied);
    moves.addProjectIds.push(...r.moves.addProjectIds);
    moves.fieldValues.push(...r.moves.fieldValues);
    if (r.moves.projectSectionId !== undefined) moves.projectSectionId = r.moves.projectSectionId;
    if (r.moves.moveToProjectId) moves.moveToProjectId = r.moves.moveToProjectId;
    notify = notify || r.notify;
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
  if (moves.projectSectionId !== undefined && container.projectId != null) {
    await setTaskProjectSection(taskId, container.projectId, moves.projectSectionId);
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

/**
 * Move a tarefa para uma seção (de projeto OU de departamento — id único,
 * a origem é resolvida por lookup em allSections) e ESPELHA por nome no
 * outro container quando a tarefa pertence aos dois.
 *
 * Por quê: task.section_id é o campo "nativo" da tarefa (usado como posição
 * no departamento), enquanto a posição no projeto vive em task_projects
 * (independente, para suportar tarefa em vários projetos). Gravar direto em
 * task.section_id a partir de uma ação feita no projeto vazava a seção do
 * departamento (e vice-versa) — as duas visões brigavam pelo mesmo campo.
 * Escrever cada lado no lugar certo resolve isso; espelhar por nome atende
 * o pedido de "mover no departamento reflete no projeto" sem inventar um
 * mapeamento novo (usa o nome da seção como chave, ex.: "Em andamento").
 * Sem seção com nome igual do outro lado, a tarefa fica sem seção lá — não
 * fica presa na seção antiga por engano.
 */
export async function moveTaskSection(
  task: Task,
  targetSectionId: string | null,
  allSections: Section[],
  automations: Automation[],
  taskDepartments: TaskDepartment[],
): Promise<{ applied: string[] }> {
  const target = targetSectionId ? allSections.find((s) => s.id === targetSectionId) : null;
  const isProjectTarget = target?.project_id != null;
  const isDeptTarget = target?.department_id != null;
  // Departamento SECUNDÁRIO = a seção escolhida é de um departamento da
  // tarefa diferente do principal (task.department_id). Determina isso pelo
  // department_id da seção ALVO, sem precisar de flag explícita do chamador.
  const isSecondaryDeptTarget = isDeptTarget && target!.department_id !== task.department_id;

  const container = { projectId: task.project_id, departmentId: target?.department_id ?? task.department_id };
  const { patch, applied, moves } = runAutomations(
    automations,
    "section_changed",
    { ...task, section_id: targetSectionId },
    container,
  );

  if (target?.project_id) {
    // Usa o project_id da seção ESCOLHIDA, não o task.project_id nativo da
    // tarefa: uma tarefa só vinculada via task_projects (sem project_id
    // próprio, ou com project_id de OUTRO projeto) tinha esse branch pulado
    // — caía no updateTask(section_id) abaixo, que grava em task.section_id,
    // mas sectionOf() prioriza o section_id do vínculo task_projects. Ou
    // seja: a troca "aplicava" mas nunca aparecia, porque escrevia no campo
    // errado. Upsert em task_projects pelo project_id da seção resolve pra
    // qualquer forma de vínculo da tarefa com o projeto.
    await setTaskProjectSection(task.id, target.project_id, targetSectionId);
    // Tarefa sem departamento: task.section_id não serve a mais ninguém, então
    // espelhar aqui também mantém a coluna "Seção" da grade e o TaskPane
    // mostrando o valor certo sem depender do vínculo task_projects.
    if (!task.department_id) await updateTask(task.id, { section_id: targetSectionId });
  } else if (isSecondaryDeptTarget) {
    // Departamento SECUNDÁRIO: só a linha dele em task_departments muda.
    // Nunca toca tasks.section_id nem a linha de outro departamento — é isso
    // que garante que mudar a seção aqui não interfere nos demais.
    await setTaskDepartmentSection(task.id, target!.department_id!, targetSectionId);
  } else {
    await updateTask(task.id, { section_id: targetSectionId });
  }
  if (Object.keys(patch).length > 0) await updateTask(task.id, patch);
  await applyAutomationMoves(task.id, container, moves);

  // Espelhar por nome entre projeto e departamento só faz sentido pro par
  // PRINCIPAL da tarefa — fazer isso pra um departamento secundário
  // quebraria justamente o isolamento que essa função existe pra garantir.
  if (!isSecondaryDeptTarget && task.project_id && task.department_id && target) {
    const sameName = (s: Section) => s.name.trim().toLowerCase() === target.name.trim().toLowerCase();
    if (isDeptTarget) {
      const mirror = allSections.find((s) => s.project_id === task.project_id && sameName(s));
      await setTaskProjectSection(task.id, task.project_id, mirror?.id ?? null);
    } else if (isProjectTarget) {
      const mirror = allSections.find((s) => s.department_id === task.department_id && sameName(s));
      await updateTask(task.id, { section_id: mirror?.id ?? null });
    }
  }

  /**
   * Demanda que CHEGA numa seção "Não planejado" também conta como fora do
   * planejamento, não só a que já nasce lá — senão uma tarefa arrastada pra
   * essa seção (o caso mais comum de "entrou fora do combinado") ficava fora
   * dos relatórios. Só liga o flag (nunca desliga ao sair — a origem é o que
   * importa pro histórico).
   */
  if (target && !task.unplanned && isUnplannedSectionName(target.name)) {
    await updateTask(task.id, { unplanned: true });
  }

  /**
   * Sair de uma seção de aprovação direto pra uma de refação também é
   * retrabalho, mesmo sem a tarefa nunca ter passado por "concluído" — usa o
   * mesmo contador (reopen_count) que o retrabalho por status já usa, pra
   * cair automaticamente em todo relatório que já lê esse campo. Compara
   * pelo NOME da seção de origem — pra departamento secundário, a origem é a
   * seção QUE ESTAVA na linha dele em task_departments (não task.section_id,
   * que é de outro departamento/projeto e não tem nada a ver com este move).
   */
  const previousSectionId = isSecondaryDeptTarget
    ? (taskDepartments.find((td) => td.task_id === task.id && td.department_id === target!.department_id)?.section_id ?? null)
    : task.section_id;
  const source = previousSectionId ? allSections.find((s) => s.id === previousSectionId) : null;
  if (source && target && isApprovalSectionName(source.name) && isReworkSectionName(target.name)) {
    await updateTask(task.id, { reopen_count: task.reopen_count + 1 });
  }

  return { applied };
}

/**
 * Muda o departamento de uma tarefa que já tem (ou vai ficar sem) projeto.
 * task.section_id é o campo "nativo" — serve pro projeto quando não há
 * departamento, e pro departamento quando há (mesma regra de moveTaskSection).
 * Setar department_id direto (updateTask cru) sem tratar isso fazia a tarefa
 * "esquecer" a seção do projeto: o campo nativo virava do departamento (que
 * não reconhece aquele id de seção → vira órfã, cai na 1ª seção dele por
 * padrão) e a posição no projeto nunca foi salva em nenhum outro lugar.
 *
 * Aqui: antes de mudar, preserva a posição atual no projeto via
 * task_projects (upsert — não estraga nada se já existir um vínculo).
 * Ganhando departamento novo, espelha por NOME pra uma seção dele se houver
 * uma com o mesmo nome (mesma convenção do moveTaskSection); senão fica sem
 * seção nativa (órfã, cai na 1ª seção do departamento — comportamento já
 * esperado pelo produto). Perdendo o departamento, recupera a seção do
 * projeto salva no vínculo.
 */
export async function setTaskDepartment(
  task: Task,
  departmentId: string | null,
  allSections: Section[],
  taskProjects: TaskProject[],
): Promise<void> {
  if (!task.project_id) {
    await updateTask(task.id, { department_id: departmentId });
    return;
  }

  if (departmentId) {
    await setTaskProjectSection(task.id, task.project_id, task.section_id);
    const currentSection = task.section_id ? allSections.find((s) => s.id === task.section_id) : null;
    const mirror = currentSection
      ? allSections.find(
          (s) =>
            s.department_id === departmentId &&
            s.name.trim().toLowerCase() === currentSection.name.trim().toLowerCase(),
        )
      : null;
    await updateTask(task.id, { department_id: departmentId, section_id: mirror?.id ?? null });
    return;
  }

  const link = taskProjects.find((l) => l.task_id === task.id && l.project_id === task.project_id);
  await updateTask(task.id, { department_id: null, section_id: link?.section_id ?? task.section_id });
}

/**
 * Ajusta os departamentos SECUNDÁRIOS da tarefa (a lista extra, fora do
 * principal em task.department_id) pro conjunto final desejado — calcula o
 * diff (add/remove) em vez do chamador emitir uma chamada por item, pro
 * multi-select do TaskPane/grade poder marcar/desmarcar direto.
 *
 * Não mexe no departamento PRINCIPAL nem na seção dele — se ele aparecer em
 * `nextDepartmentIds`, é ignorado aqui (setTaskDepartment continua sendo o
 * único caminho pra trocar o principal). Um departamento extra novo entra
 * sem seção (fica órfão, cai na 1ª seção do departamento — mesma regra que
 * já vale hoje pro principal).
 */
export async function setTaskSecondaryDepartments(
  task: Task,
  nextDepartmentIds: string[],
  taskDepartments: TaskDepartment[],
): Promise<void> {
  const current = taskDepartments.filter((td) => td.task_id === task.id);
  const currentIds = new Set(current.map((td) => td.department_id));
  const wantIds = new Set(nextDepartmentIds.filter((id) => id !== task.department_id));

  const toRemove = current.filter((td) => !wantIds.has(td.department_id));
  const toAdd = [...wantIds].filter((id) => !currentIds.has(id));

  await Promise.all(toRemove.map((td) => removeTaskFromDepartment(td.id)));
  await Promise.all(toAdd.map((id) => addTaskToDepartment(task.id, id, null)));
}
