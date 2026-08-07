import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { SectionTitle } from "@/components/ui-bits";
import {
  createAutomation,
  deleteAutomation,
  updateAutomation,
  type Automation,
  type CustomField,
} from "@/lib/asana";
import {
  ACTION_LABEL,
  TRIGGER_LABEL,
  decodeFieldValue,
  encodeFieldValue,
  type AutoEvent,
} from "@/lib/automations";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_META,
  STATUS_ORDER,
  type Member,
  type Task,
} from "@/lib/domain";
import { useInvalidate } from "@/lib/useData";
import { cn } from "@/lib/utils";

/**
 * Painel de automações reutilizado por projeto e por departamento.
 * A única diferença entre os dois é o container: quem cria a regra pega
 * o id do container atual — projeto grava em project_id, departamento em
 * department_id (CHECK do banco garante que só um dos dois é set).
 */
type Container =
  | { kind: "project"; projectId: string }
  | { kind: "department"; departmentId: string };

export function AutomationsPanel({
  container,
  automations,
  members,
  sections,
  projects,
  fields,
}: {
  container: Container;
  automations: Automation[];
  members: Member[];
  sections: { id: string; name: string }[];
  /**
   * Projetos alvo das ações "mover/incluir em outro projeto". No
   * departamento, ficaria estranho mover uma tarefa entre projetos por
   * automação, então quem chama passa `[]` e os selects mudam de valor.
   */
  projects: { id: string; name: string }[];
  /**
   * Campos personalizados disponíveis para o trigger field_changed e
   * para a ação set_field. Só campos do tipo select (com options) fazem
   * sentido — usados como "status" próprio do container.
   */
  fields: CustomField[];
}) {
  const invalidateAutomations = useInvalidate(["automations"]);
  const [form, setForm] = useState({
    name: "",
    trigger_type: "task_created" as AutoEvent,
    trigger_value: "",
    action_type: "set_status",
    action_value: "",
    // Estado auxiliar para field_changed e set_field: primeiro o campo
    // é escolhido, depois o valor. No envio essas duas partes viram um
    // único "<field_id>::<value>" via encodeFieldValue.
    field_id: "",
    field_value: "",
  });

  const add = useMutation({
    mutationFn: () => {
      // Regras que envolvem campo personalizado empacotam o par
      // (field_id, value) no trigger_value/action_value com "::".
      const triggerVal =
        form.trigger_type === "field_changed" && form.field_id
          ? encodeFieldValue(form.field_id, form.field_value)
          : form.trigger_value || null;
      const actionVal =
        form.action_type === "set_field" && form.field_id
          ? encodeFieldValue(form.field_id, form.field_value)
          : form.action_value || null;
      return createAutomation({
        project_id: container.kind === "project" ? container.projectId : null,
        department_id: container.kind === "department" ? container.departmentId : null,
        name: form.name.trim(),
        trigger_type: form.trigger_type,
        trigger_value: triggerVal,
        action_type: form.action_type,
        action_value: actionVal,
      });
    },
    onSuccess: () => {
      setForm({
        name: "",
        trigger_type: "task_created",
        trigger_value: "",
        action_type: "set_status",
        action_value: "",
        field_id: "",
        field_value: "",
      });
      invalidateAutomations();
      toast.success("Automação criada.");
    },
    onError: () => toast.error("Não foi possível criar a automação."),
  });

  const toggle = useMutation({
    mutationFn: (a: Automation) => updateAutomation(a.id, { active: !a.active }),
    onSuccess: () => invalidateAutomations(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: () => invalidateAutomations(),
  });

  const actionOptions = () => {
    switch (form.action_type) {
      case "set_status":
        return STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label }));
      case "set_assignee":
        return members.map((m) => ({ value: m.id, label: m.name }));
      case "set_priority":
        return PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
      case "move_section":
        return sections.map((s) => ({ value: s.id, label: s.name }));
      case "move_project":
      case "add_project":
        return projects.map((p) => ({ value: p.id, label: p.name }));
      default:
        return null;
    }
  };
  const options = actionOptions();

  // Ações que não fazem sentido em departamento — evitamos oferecê-las lá.
  const actionKeys = (Object.keys(ACTION_LABEL) as string[]).filter((k) =>
    container.kind === "project" ? true : k !== "move_project" && k !== "add_project",
  );

  const describe = (a: Automation) => {
    const trigger = TRIGGER_LABEL[a.trigger_type as AutoEvent] ?? a.trigger_type;
    // Condição do gatilho — status_changed vira "(Concluído)",
    // field_changed vira "(Coluna X = Valor Y)".
    let cond = "";
    if (a.trigger_type === "field_changed") {
      const decoded = decodeFieldValue(a.trigger_value);
      if (decoded) {
        const fname = fields.find((f) => f.id === decoded.fieldId)?.name ?? "—";
        cond = ` (${fname} = ${decoded.value || "qualquer"})`;
      }
    } else if (a.trigger_type === "section_changed" && a.trigger_value) {
      cond = ` (${sections.find((s) => s.id === a.trigger_value)?.name ?? a.trigger_value})`;
    } else if (a.trigger_value) {
      cond = ` (${STATUS_META[a.trigger_value as Task["status"]]?.label ?? a.trigger_value})`;
    }
    const action = ACTION_LABEL[a.action_type] ?? a.action_type;
    let value: string;
    if (a.action_type === "set_field") {
      const decoded = decodeFieldValue(a.action_value);
      value = decoded
        ? `${fields.find((f) => f.id === decoded.fieldId)?.name ?? "—"} = ${decoded.value}`
        : "—";
    } else if (a.action_type === "set_assignee") {
      value = members.find((m) => m.id === a.action_value)?.name ?? "—";
    } else if (a.action_type === "move_section") {
      value = sections.find((s) => s.id === a.action_value)?.name ?? "—";
    } else if (a.action_type === "move_project" || a.action_type === "add_project") {
      value = projects.find((p) => p.id === a.action_value)?.name ?? "—";
    } else {
      value = a.action_value ?? "";
    }
    return `${trigger}${cond} → ${action} ${value}`.trim();
  };

  return (
    <div className="card-surface space-y-4 p-4">
      <SectionTitle
        title="Automações"
        description="Regras que rodam quando a tarefa é criada ou muda de status/responsável."
      />
      <ul className="divide-y divide-border">
        {automations.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{a.name}</p>
              <p className="truncate text-xs text-muted-foreground">{describe(a)}</p>
            </div>
            <button
              onClick={() => toggle.mutate(a)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                a.active
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border text-muted-foreground",
              )}
            >
              {a.active ? "Ativa" : "Pausada"}
            </button>
            <button
              onClick={() => remove.mutate(a.id)}
              aria-label="Excluir automação"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {automations.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">Nenhuma automação ainda.</li>
        )}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim().length < 3) {
            toast.error("Dê um nome à automação.");
            return;
          }
          add.mutate();
        }}
        className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          placeholder="Nome da regra"
          maxLength={80}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="field w-full"
        />
        <select
          aria-label="Gatilho"
          value={form.trigger_type}
          onChange={(e) =>
            setForm({ ...form, trigger_type: e.target.value as AutoEvent, trigger_value: "" })
          }
          className="field w-full"
        >
          {(Object.keys(TRIGGER_LABEL) as AutoEvent[]).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABEL[t]}
            </option>
          ))}
        </select>
        {form.trigger_type === "field_changed" ? (
          <>
            <select
              aria-label="Coluna do gatilho"
              value={form.field_id}
              onChange={(e) => setForm({ ...form, field_id: e.target.value, field_value: "" })}
              className="field w-full"
            >
              <option value="">Coluna…</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Valor do gatilho"
              value={form.field_value}
              onChange={(e) => setForm({ ...form, field_value: e.target.value })}
              disabled={!form.field_id}
              className="field w-full"
            >
              <option value="">Qualquer valor</option>
              {(fields.find((f) => f.id === form.field_id)?.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </>
        ) : form.trigger_type === "section_changed" ? (
          <select
            aria-label="Condição"
            value={form.trigger_value}
            onChange={(e) => setForm({ ...form, trigger_value: e.target.value })}
            className="field w-full"
          >
            <option value="">Qualquer seção</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label="Condição"
            value={form.trigger_value}
            onChange={(e) => setForm({ ...form, trigger_value: e.target.value })}
            disabled={form.trigger_type !== "status_changed"}
            className="field w-full"
          >
            <option value="">Qualquer status</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Ação"
          value={form.action_type}
          onChange={(e) => setForm({ ...form, action_type: e.target.value, action_value: "" })}
          className="field w-full"
        >
          {actionKeys.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
        {form.action_type === "set_field" ? (
          <>
            <select
              aria-label="Coluna alvo"
              value={form.field_id}
              onChange={(e) => setForm({ ...form, field_id: e.target.value, field_value: "" })}
              className="field w-full"
            >
              <option value="">Coluna…</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Novo valor"
              value={form.field_value}
              onChange={(e) => setForm({ ...form, field_value: e.target.value })}
              disabled={!form.field_id}
              className="field w-full"
            >
              <option value="">Novo valor…</option>
              {(fields.find((f) => f.id === form.field_id)?.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </>
        ) : options ? (
          <select
            aria-label="Valor da ação"
            value={form.action_value}
            onChange={(e) => setForm({ ...form, action_value: e.target.value })}
            className="field w-full"
          >
            <option value="">Selecione…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Valor da ação"
            placeholder={form.action_type === "notify_assignee" ? "—" : "Valor"}
            value={form.action_value}
            disabled={form.action_type === "notify_assignee"}
            onChange={(e) => setForm({ ...form, action_value: e.target.value })}
            className="field w-full"
          />
        )}
        <button className="btn btn-primary lg:col-span-5">Criar automação</button>
      </form>
    </div>
  );
}
