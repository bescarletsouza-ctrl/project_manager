export type TaskStatus =
  | "backlog"
  | "a_fazer"
  | "em_andamento"
  | "em_revisao"
  | "aguardando_aprovacao"
  | "bloqueado"
  | "concluido"
  | "cancelado";

export type StatusCategory =
  | "espera"
  | "execucao"
  | "revisao"
  | "bloqueio"
  | "conclusao"
  | "cancelado";

export const STATUS_META: Record<
  TaskStatus,
  { label: string; category: StatusCategory; tone: string }
> = {
  backlog: { label: "Backlog", category: "espera", tone: "neutral" },
  a_fazer: { label: "A fazer", category: "espera", tone: "neutral" },
  em_andamento: { label: "Em andamento", category: "execucao", tone: "info" },
  em_revisao: { label: "Em revisão", category: "revisao", tone: "warning" },
  aguardando_aprovacao: {
    label: "Aguardando aprovação",
    category: "revisao",
    tone: "warning",
  },
  bloqueado: { label: "Bloqueado", category: "bloqueio", tone: "danger" },
  concluido: { label: "Concluído", category: "conclusao", tone: "success" },
  cancelado: { label: "Cancelado", category: "cancelado", tone: "neutral" },
};

export const STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "a_fazer",
  "em_andamento",
  "em_revisao",
  "aguardando_aprovacao",
  "bloqueado",
  "concluido",
  "cancelado",
];

export const PRIORITIES = ["baixa", "media", "alta", "urgente"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

export const COMPLEXITY_OPTIONS = [
  { value: 1, label: "Muito simples (1 pt)" },
  { value: 2, label: "Simples (2 pts)" },
  { value: 3, label: "Média (3 pts)" },
  { value: 5, label: "Complexa (5 pts)" },
  { value: 8, label: "Muito complexa (8 pts)" },
];

export const PROJECT_STATUS = [
  "planejamento",
  "nao_iniciado",
  "em_andamento",
  "em_risco",
  "atrasado",
  "pausado",
  "concluido",
  "cancelado",
] as const;

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  planejamento: "Planejamento",
  nao_iniciado: "Não iniciado",
  em_andamento: "Em andamento",
  em_risco: "Em risco",
  atrasado: "Atrasado",
  pausado: "Pausado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  department_id: string | null;
  client_id: string | null;
  assignee_id: string | null;
  status: TaskStatus;
  priority: Priority;
  complexity: number;
  task_type: string;
  due_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  reopen_count: number;
  review_count: number;
  block_reason: string | null;
  created_at: string;
  tags: string[];
  sprint: string | null;
  /* modelo Asana */
  section_id: string | null;
  parent_task_id: string | null;
  is_milestone: boolean;
  start_date: string | null;
  position: number;
  completed: boolean;
  /** true quando a tarefa foi CRIADA numa seção "Não planejado" — não muda se ela for movida depois. Ver isUnplannedSectionName. */
  unplanned: boolean;
  /** Quem criou a tarefa (members.id) — capturado sozinho pelo DEFAULT da coluna no banco, não precisa gravar do app. */
  created_by: string | null;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  access_role: string;
  department_id: string | null;
  capacity_points: number;
  user_id: string | null;
  avatar_color: string;
  avatar_url: string | null;
  phone: string | null;
  /** Quando o cadastro da pessoa foi criado no Alana — usado como piso do histórico pra estimar capacidade (ver computeFlowAnalysis). */
  created_at: string;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  client_id: string | null;
  department_id: string | null;
  manager_id: string | null;
  status: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  portfolio_id: string | null;
  position: number;
  default_view: string;
  color: string;
  default_assignee_id: string | null;
  default_due_days: number | null;
  visible_columns: string[];
};

export type Department = { id: string; name: string; color: string };
/** Departamentos extras de uma pessoa, além do "Departamento" principal em Member.department_id. */
export type MemberDepartment = { member_id: string; department_id: string };
export type Client = { id: string; name: string; contact_email: string | null };
export type Tag = { id: string; name: string; color: string };

export type StatusEvent = {
  id: string;
  task_id: string;
  from_status: string | null;
  to_status: string;
  entered_at: string;
  exited_at: string | null;
  duration_minutes: number | null;
};

/** Mudança de campo da tarefa (responsável, prazo, seção, prioridade etc.) — gravada por trigger, ver migration 20260807160000. */
export type TaskFieldActivity = {
  id: string;
  task_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_user: string | null;
  created_at: string;
};

/* ---------- time helpers (calculados a partir do histórico) ---------- */

export const HOUR = 1000 * 60 * 60;

export function hoursBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / HOUR;
}

export function formatHours(h: number | null | undefined) {
  if (h === null || h === undefined || Number.isNaN(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export function avg(values: (number | null | undefined)[]) {
  const list = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

export function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export const isDone = (t: Task) => t.status === "concluido";
export const isCancelled = (t: Task) => t.status === "cancelado";
export const isOpen = (t: Task) => !isDone(t) && !isCancelled(t);

export function isLate(t: Task) {
  if (!t.due_date) return false;
  const due = new Date(`${t.due_date}T23:59:59`);
  if (isDone(t)) return t.completed_at ? new Date(t.completed_at) > due : false;
  if (isCancelled(t)) return false;
  return new Date() > due;
}

/**
 * Status de prazo: automático, calculado a partir de due_date/completed_at —
 * não é um campo, não tem UI de configuração. Diferente do "status" nativo da
 * tarefa (workflow, removido da grade em favor de campo personalizado) e
 * também diferente de STATUS_META: este é sobre cumprir o prazo, não sobre em
 * que etapa a tarefa está.
 */
export type DeadlineStatus = "atrasado" | "vencendo_hoje" | "concluido" | "sem_prazo" | "no_prazo" | "cancelado";

export const DEADLINE_STATUS_LABEL: Record<DeadlineStatus, string> = {
  atrasado: "Atrasado",
  vencendo_hoje: "Vencendo hoje",
  concluido: "Concluído",
  sem_prazo: "Sem prazo",
  no_prazo: "No prazo",
  cancelado: "Cancelado",
};

export const DEADLINE_STATUS_TONE: Record<DeadlineStatus, "danger" | "success" | "neutral" | "info" | "warning"> = {
  atrasado: "danger",
  vencendo_hoje: "warning",
  concluido: "success",
  sem_prazo: "neutral",
  no_prazo: "info",
  cancelado: "neutral",
};

/** Data de hoje em componentes locais (não UTC) — consistente com o "agora" que isLate() usa. */
export function todayLocalIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Soma (ou subtrai, com n negativo) dias a uma data ISO (yyyy-mm-dd), em horário local. */
export function addDaysIso(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Concluída não é, por si só, um status de PRAZO — quem quer saber se a
 * tarefa está pronta já vê pelo checkbox/status. Este pill é sobre cumprir
 * o prazo: concluída dentro do prazo mostra "No prazo" (ou "Sem prazo" se
 * nunca teve data), concluída depois do prazo mostra "Atrasado" (já
 * coberto por isLate acima, que compara completed_at com o prazo).
 */
export function deadlineStatus(t: Task): DeadlineStatus {
  if (isCancelled(t)) return "cancelado";
  if (isLate(t)) return "atrasado";
  if (isDone(t)) return t.due_date ? "no_prazo" : "sem_prazo";
  if (!t.due_date) return "sem_prazo";
  if (t.due_date === todayLocalIso()) return "vencendo_hoje";
  return "no_prazo";
}

/** Tarefa aberta com prazo dentro dos próximos `days` dias, sem estar atrasada. */
export function isDueSoon(t: Task, days = 3) {
  if (!isOpen(t) || !t.due_date || isLate(t)) return false;
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  const limitIso = `${limit.getFullYear()}-${pad(limit.getMonth() + 1)}-${pad(limit.getDate())}`;
  return t.due_date >= todayLocalIso() && t.due_date <= limitIso;
}

/** Lead time: criação → conclusão (horas) */
export const leadTime = (t: Task) => hoursBetween(t.created_at, t.completed_at);
/** Cycle time: início da execução → conclusão (horas) */
export const cycleTime = (t: Task) => hoursBetween(t.started_at, t.completed_at);
/** Tempo até o início: criação → primeira movimentação para execução */
export const timeToStart = (t: Task) => hoursBetween(t.created_at, t.started_at);

export function timeInStatus(events: StatusEvent[], task: Task) {
  const map: Record<string, number> = {};
  for (const e of events.filter((e) => e.task_id === task.id)) {
    const end = e.exited_at ? new Date(e.exited_at) : new Date();
    const hours = (end.getTime() - new Date(e.entered_at).getTime()) / HOUR;
    map[e.to_status] = (map[e.to_status] ?? 0) + Math.max(0, hours);
  }
  return map;
}

export function daysWithoutMovement(events: StatusEvent[], task: Task) {
  const own = events.filter((e) => e.task_id === task.id);
  const last = own.reduce<string>(
    (acc, e) => (new Date(e.entered_at) > new Date(acc) ? e.entered_at : acc),
    task.created_at,
  );
  return (Date.now() - new Date(last).getTime()) / (HOUR * 24);
}

/**
 * Quando o trabalho "começou" de verdade: o started_at nativo (só é setado
 * quando o status vira "em_andamento") OU a primeira mudança de SEÇÃO já
 * registrada em task_field_activity — o que vier primeiro. Sem isso, uma
 * tarefa que pula direto pra outra seção (ex.: "Em aprovação") sem nunca
 * passar pelo status "em_andamento" nunca ganhava started_at, mesmo já
 * tendo saído do backlog — ficava fora do tempo médio (nem contava como
 * atraso, nem como demora), mascarando o dado.
 */
function effectiveStartedAt(t: Task, fieldActivity: TaskFieldActivity[]): string | null {
  let firstMove: string | null = null;
  for (const a of fieldActivity) {
    if (a.task_id !== t.id || a.field !== "section_id") continue;
    if (!firstMove || a.created_at < firstMove) firstMove = a.created_at;
  }
  if (t.started_at && firstMove) return t.started_at < firstMove ? t.started_at : firstMove;
  return t.started_at ?? firstMove;
}

/**
 * Primeira vez que a tarefa entrou numa seção de APROVAÇÃO (por nome, ver
 * isApprovalSectionName) — não a primeira movimentação qualquer. É o fim
 * do "tempo médio": mede quanto tempo a pessoa leva pra produzir até
 * mandar pra aprovação, sem contar o tempo de revisão/aprovação em si.
 * Sem section_id de destino batendo com uma seção de aprovação alguma vez,
 * a tarefa fica de fora da média (nunca chegou lá).
 */
function firstApprovalEntryAt(
  taskId: string,
  fieldActivity: TaskFieldActivity[],
  approvalSectionIds: Set<string>,
): string | null {
  let first: string | null = null;
  for (const a of fieldActivity) {
    if (a.task_id !== taskId || a.field !== "section_id" || !a.new_value) continue;
    if (!approvalSectionIds.has(a.new_value)) continue;
    if (!first || a.created_at < first) first = a.created_at;
  }
  return first;
}

/* ---------- métricas agregadas ---------- */

export type PersonMetrics = ReturnType<typeof personMetrics>;

/**
 * fieldActivity e sections são opcionais — sem eles, "tempo médio" fica
 * vazio (nunca acha uma seção de aprovação pra medir) em vez de quebrar.
 */
export function personMetrics(
  member: Member,
  tasks: Task[],
  fieldActivity: TaskFieldActivity[] = [],
  sections: { id: string; name: string }[] = [],
) {
  const mine = tasks.filter((t) => t.assignee_id === member.id);
  const done = mine.filter(isDone);
  const open = mine.filter(isOpen);
  const late = mine.filter(isLate);
  // Atrasadas que ainda pesam hoje (sem contar entrega já feita, mesmo que
  // tenha sido feita depois do prazo — isso é histórico, não fila
  // pendente). Usado no retrato "sem filtro" da Produtividade; com filtro
  // de período aplicado, usa "late" (aberta + finalizada) em vez disso.
  const lateOpen = late.filter(isOpen);
  const onTime = done.filter((t) => !isLate(t));
  const blocked = mine.filter((t) => t.status === "bloqueado");
  const points = done.reduce((s, t) => s + t.complexity, 0);
  const openPoints = open.reduce((s, t) => s + t.complexity, 0);
  const reopened = mine.filter((t) => t.reopen_count > 0);

  const load = member.capacity_points ? openPoints / member.capacity_points : 0;
  const loadLabel =
    load < 0.5
      ? "Capacidade disponível"
      : load < 0.85
        ? "Carga adequada"
        : load < 1.15
          ? "Atenção"
          : "Sobrecarregado";

  const onTimeRate = done.length ? pct(onTime.length, done.length) : 0;
  const reworkRate = mine.length ? pct(reopened.length, mine.length) : 0;
  const approvalSectionIds = new Set(sections.filter((s) => isApprovalSectionName(s.name)).map((s) => s.id));
  // "Tempo médio" = criação → primeira entrada numa seção de aprovação
  // (não até a conclusão) — mede o tempo de produção, não o de revisão.
  const avgCycle = avg(
    mine.map((t) => hoursBetween(t.created_at, firstApprovalEntryAt(t.id, fieldActivity, approvalSectionIds))),
  );
  const avgLead = avg(done.map(leadTime));
  const avgToStart = avg(mine.map((t) => hoursBetween(t.created_at, effectiveStartedAt(t, fieldActivity))));

  // Índice de produtividade (0-100): pontos, prazo, velocidade, retrabalho
  const pointScore = Math.min(100, (points / Math.max(1, member.capacity_points)) * 100);
  const speedScore = avgCycle === null ? 60 : Math.max(0, 100 - Math.min(100, (avgCycle / 24) * 20));
  const qualityScore = Math.max(0, 100 - reworkRate * 2);
  const index = Math.round(
    pointScore * 0.3 + onTimeRate * 0.25 + speedScore * 0.2 + qualityScore * 0.15 + (100 - Math.min(100, blocked.length * 15)) * 0.1,
  );

  return {
    member,
    total: mine.length,
    done: done.length,
    open: open.length,
    late: late.length,
    lateOpen: lateOpen.length,
    blocked: blocked.length,
    reopened: reopened.length,
    reviews: mine.reduce((s, t) => s + t.review_count, 0),
    points,
    openPoints,
    onTimeRate,
    reworkRate,
    avgCycle,
    avgLead,
    avgToStart,
    load,
    loadLabel,
    index,
  };
}

/* ---------- fluxo de entrada/saída e diagnóstico de sobrecarga ---------- */

export type FlowStatus = "sobrecarga" | "possivel_problema" | "saudavel" | "dados_insuficientes";

export const FLOW_STATUS_LABEL: Record<FlowStatus, string> = {
  sobrecarga: "Sobrecarga",
  possivel_problema: "Possível problema de produtividade",
  saudavel: "Operação saudável",
  dados_insuficientes: "Dados insuficientes",
};

export const FLOW_STATUS_TONE: Record<FlowStatus, "danger" | "warning" | "success" | "neutral"> = {
  sobrecarga: "danger",
  possivel_problema: "warning",
  saudavel: "success",
  dados_insuficientes: "neutral",
};

/** Quantas semanas de histórico (imediatamente ANTES do período analisado) usar pra estimar capacidade. */
const CAPACITY_LOOKBACK_WEEKS = 12;
/** Menos entregas que isso na janela de histórico = não dá pra confiar numa média; não inventa capacidade. */
const MIN_ENTREGAS_PARA_CAPACIDADE = 3;
/** Margem de tolerância pra evitar oscilar o diagnóstico por causa de amostra pequena. */
const FLOW_TOLERANCE = 0.15;

function withinIso(iso: string | null, from: string, to: string) {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= from && d <= to;
}

export type FlowAnalysis = {
  periodFrom: string;
  periodTo: string;
  weeksInPeriod: number;
  recebidas: number;
  entregues: number;
  backlogAtual: number;
  backlogDelta: number;
  pctAtrasadas: number | null;
  avgProducao: number | null;
  reworkPct: number | null;
  capacidadeSemanal: number | null;
  capacidadeAmostraSemanas: number;
  capacidadeEntregas: number;
  status: FlowStatus;
  motivo: string;
};

/**
 * Cruza entrada (demandas recebidas) x saída (entregues) num período e usa o
 * HISTÓRICO REAL de entregas (janela de até CAPACITY_LOOKBACK_WEEKS semanas,
 * imediatamente anterior ao período, nunca voltando antes do dia em que a
 * pessoa começou a usar o Alana — member.created_at) pra estimar a
 * capacidade média do usuário — nunca um número fixo digitado à mão (isso já
 * existe em member.capacity_points, mas é configurado manualmente por um
 * admin, não reflete histórico real, e por isso não é usado aqui). Toda
 * comparação de "queda de entregas" ou "aumento de tempo de produção" é
 * feita contra o PRÓPRIO passado recente da pessoa, nunca contra um corte
 * fixo igual pra todo mundo. Com menos de MIN_ENTREGAS_PARA_CAPACIDADE
 * entregas na janela de histórico (ex.: alguém que acabou de começar a
 * usar o sistema), não dá pra confiar numa média — devolve capacidadeSemanal
 * null e status "dados_insuficientes" em vez de arriscar um número pouco
 * confiável.
 */
export function computeFlowAnalysis(
  member: Member,
  allTasks: Task[],
  fieldActivity: TaskFieldActivity[] = [],
  sections: { id: string; name: string }[] = [],
  periodFrom: string,
  periodTo: string,
): FlowAnalysis {
  const mine = allTasks.filter((t) => t.assignee_id === member.id);
  const approvalSectionIds = new Set(sections.filter((s) => isApprovalSectionName(s.name)).map((s) => s.id));

  const recebidasTasks = mine.filter((t) => withinIso(t.created_at, periodFrom, periodTo));
  const entreguesTasks = mine.filter((t) => isDone(t) && withinIso(t.completed_at, periodFrom, periodTo));
  const backlogAtual = mine.filter(isOpen).length;

  const periodDays =
    Math.round(
      (new Date(`${periodTo}T00:00:00`).getTime() - new Date(`${periodFrom}T00:00:00`).getTime()) / (HOUR * 24),
    ) + 1;
  const weeksInPeriod = Math.max(periodDays, 1) / 7;

  const relevantForLate = mine.filter((t) => isOpen(t) || withinIso(t.completed_at, periodFrom, periodTo));
  const pctAtrasadas = relevantForLate.length ? pct(relevantForLate.filter(isLate).length, relevantForLate.length) : null;

  const avgProducao = entreguesTasks.length
    ? avg(entreguesTasks.map((t) => hoursBetween(t.created_at, firstApprovalEntryAt(t.id, fieldActivity, approvalSectionIds))))
    : null;

  const reworkPct = entreguesTasks.length ? pct(entreguesTasks.filter((t) => t.reopen_count > 0).length, entreguesTasks.length) : null;

  // Capacidade + baseline: entregas concluídas na janela ANTERIOR ao período
  // selecionado — nunca sobrepõe, pra não misturar "agora" com "histórico".
  // A janela nunca volta antes do dia em que a pessoa começou a usar o Alana
  // (member.created_at) — sem isso, alguém com poucas semanas de conta caía
  // sempre em "dados insuficientes" porque a janela de 12 semanas incluía
  // tempo em que ela nem tinha cadastro ainda. Pra quem já usa há mais de
  // CAPACITY_LOOKBACK_WEEKS semanas, a janela continua as 12 semanas mais
  // recentes (mantém a capacidade "atual", não a média histórica inteira).
  const memberStart = member.created_at.slice(0, 10);
  const capacidadeFromDesejado = addDaysIso(periodFrom, -CAPACITY_LOOKBACK_WEEKS * 7);
  const capacidadeFrom = memberStart > capacidadeFromDesejado ? memberStart : capacidadeFromDesejado;
  const capacidadeTo = addDaysIso(periodFrom, -1);
  const capacidadeTasks = mine.filter((t) => isDone(t) && withinIso(t.completed_at, capacidadeFrom, capacidadeTo));
  const capacidadeDias =
    Math.round(
      (new Date(`${capacidadeTo}T00:00:00`).getTime() - new Date(`${capacidadeFrom}T00:00:00`).getTime()) /
        (HOUR * 24),
    ) + 1;
  const capacidadeSemanasReal = Math.max(capacidadeDias, 1) / 7;
  const capacidadeSemanal =
    capacidadeTasks.length >= MIN_ENTREGAS_PARA_CAPACIDADE && capacidadeSemanasReal >= 1
      ? capacidadeTasks.length / capacidadeSemanasReal
      : null;

  const baselineAvgProducao = capacidadeTasks.length
    ? avg(capacidadeTasks.map((t) => hoursBetween(t.created_at, firstApprovalEntryAt(t.id, fieldActivity, approvalSectionIds))))
    : null;
  const baselineRelevant = mine.filter(
    (t) => withinIso(t.completed_at, capacidadeFrom, capacidadeTo) || (isOpen(t) && t.created_at < periodFrom),
  );
  const baselinePctAtrasadas = baselineRelevant.length
    ? pct(baselineRelevant.filter(isLate).length, baselineRelevant.length)
    : null;

  const recebidasSemanais = recebidasTasks.length / weeksInPeriod;
  const entreguesSemanais = entreguesTasks.length / weeksInPeriod;

  let status: FlowStatus;
  let motivo: string;

  if (weeksInPeriod < 1) {
    status = "dados_insuficientes";
    motivo = "Período selecionado é menor que uma semana — taxas semanais não são confiáveis nesse intervalo.";
  } else if (capacidadeSemanal === null) {
    status = "dados_insuficientes";
    motivo = `Menos de ${MIN_ENTREGAS_PARA_CAPACIDADE} entregas nas ${CAPACITY_LOOKBACK_WEEKS} semanas anteriores ao período — sem histórico suficiente pra estimar capacidade.`;
  } else if (recebidasSemanais > capacidadeSemanal * (1 + FLOW_TOLERANCE)) {
    status = "sobrecarga";
    motivo = `Recebendo ${recebidasSemanais.toFixed(1)} demandas/semana, acima da capacidade histórica de ${capacidadeSemanal.toFixed(1)}/semana.`;
  } else if (
    entreguesSemanais < capacidadeSemanal * (1 - FLOW_TOLERANCE) ||
    (baselineAvgProducao !== null && avgProducao !== null && avgProducao > baselineAvgProducao * (1 + FLOW_TOLERANCE)) ||
    (baselinePctAtrasadas !== null && pctAtrasadas !== null && pctAtrasadas > baselinePctAtrasadas + 10)
  ) {
    status = "possivel_problema";
    const partes: string[] = [];
    if (entreguesSemanais < capacidadeSemanal * (1 - FLOW_TOLERANCE)) {
      partes.push(`entregas caíram (${entreguesSemanais.toFixed(1)}/semana vs. ${capacidadeSemanal.toFixed(1)}/semana histórico)`);
    }
    if (baselineAvgProducao !== null && avgProducao !== null && avgProducao > baselineAvgProducao * (1 + FLOW_TOLERANCE)) {
      partes.push(`tempo de produção aumentou (${formatHours(avgProducao)} vs. ${formatHours(baselineAvgProducao)} histórico)`);
    }
    if (baselinePctAtrasadas !== null && pctAtrasadas !== null && pctAtrasadas > baselinePctAtrasadas + 10) {
      partes.push(`atrasos subiram (${pctAtrasadas}% vs. ${baselinePctAtrasadas}% histórico)`);
    }
    motivo = `Carga dentro da capacidade histórica, mas ${partes.join(" e ")}.`;
  } else {
    status = "saudavel";
    motivo = "Entrada e saída equilibradas, dentro da capacidade histórica e sem sinais de atraso crescente.";
  }

  return {
    periodFrom,
    periodTo,
    weeksInPeriod,
    recebidas: recebidasTasks.length,
    entregues: entreguesTasks.length,
    backlogAtual,
    backlogDelta: recebidasTasks.length - entreguesTasks.length,
    pctAtrasadas,
    avgProducao,
    reworkPct,
    capacidadeSemanal,
    capacidadeAmostraSemanas: Math.round(capacidadeSemanasReal * 10) / 10,
    capacidadeEntregas: capacidadeTasks.length,
    status,
    motivo,
  };
}

/** Dia (due_date) com mais tarefas abertas vencendo, e as tarefas desse dia. */
export function busiestDueDay(tasks: Task[]): { date: string | null; tasks: Task[] } {
  const byDate: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (!isOpen(t) || !t.due_date) continue;
    (byDate[t.due_date] ??= []).push(t);
  }
  let date: string | null = null;
  let list: Task[] = [];
  for (const [d, ts] of Object.entries(byDate)) {
    if (ts.length > list.length) {
      date = d;
      list = ts;
    }
  }
  return { date, tasks: list };
}

export function projectHealth(project: Project, tasks: Task[]) {
  const list = tasks.filter((t) => t.project_id === project.id);
  const done = list.filter(isDone).length;
  const progress = list.length ? Math.round((done / list.length) * 100) : 0;
  const late = list.filter(isLate).length;
  const blocked = list.filter((t) => t.status === "bloqueado").length;
  let score = 100 - late * 8 - blocked * 6;
  if (project.due_date && new Date(project.due_date) < new Date() && progress < 100) score -= 25;
  score = Math.max(0, Math.min(100, score));
  const health = score >= 75 ? "Saudável" : score >= 50 ? "Atenção" : "Crítico";
  return { total: list.length, done, progress, late, blocked, score, health };
}

/** Reconhece a seção "Não planejado" (existe por convenção em projetos/departamentos), ignorando acento e caixa. */
const DIACRITICS_RE = /[\u0300-\u036f]/g;

function normalizeSectionName(name: string) {
  return name.normalize("NFD").replace(DIACRITICS_RE, "").trim().toLowerCase();
}

export function isUnplannedSectionName(name: string) {
  return normalizeSectionName(name) === "nao planejado";
}

/** Secoes de aprovacao (por convencao de nome) -- ver isReworkSectionName: sair daqui pra uma secao de refacao conta como retrabalho. */
const APPROVAL_SECTION_NAMES = new Set(["em aprovacao", "aprovacao", "aguardando aprovacao"]);
export function isApprovalSectionName(name: string) {
  return APPROVAL_SECTION_NAMES.has(normalizeSectionName(name));
}

/** Secoes de refacao/retrabalho (por convencao de nome). */
const REWORK_SECTION_NAMES = new Set(["refacao", "retrabalho", "correcao"]);
export function isReworkSectionName(name: string) {
  return REWORK_SECTION_NAMES.has(normalizeSectionName(name));
}

export const TASK_TYPES = ["execucao", "criacao", "revisao", "reuniao", "suporte"] as const;

export const TASK_TYPE_LABEL: Record<string, string> = {
  execucao: "Execução",
  criacao: "Criação",
  revisao: "Revisão",
  reuniao: "Reunião",
  suporte: "Suporte",
};
