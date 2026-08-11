import { useState } from "react";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { SectionTitle } from "@/components/ui-bits";
import { dotClass } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { isLate, type Department, type Member, type Project, type Task } from "@/lib/domain";

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
/** Cada dia mostra no máximo isso de tarefas antes de resumir em "+N mais" — um dia do workspace inteiro pode ter muito mais tarefa que um projeto só. */
const MAX_PER_DAY = 4;

function toISO(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Calendário mensal com as tarefas de todos os projetos e departamentos —
 * mesmo padrão do Calendário do projeto (arrastar um card muda o prazo),
 * clicar abre a tarefa no TaskPane. Sem "+" de criar tarefa aqui: não há um
 * projeto/departamento padrão óbvio pra uma tarefa nova nascer neste contexto.
 */
export function WorkspaceCalendar({
  tasks,
  members,
  projects,
  departments,
  onOpenTask,
  onReschedule,
}: {
  tasks: Task[];
  members: Member[];
  projects: Project[];
  departments: Department[];
  onOpenTask: (t: Task) => void;
  onReschedule: (id: string, dueDate: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // segunda = 0
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - offset);

  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const todayISO = toISO(new Date());
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.due_date || t.parent_task_id) continue;
    const list = byDay.get(t.due_date) ?? [];
    list.push(t);
    byDay.set(t.due_date, list);
  }

  const containerOf = (t: Task) => {
    if (t.project_id) {
      const p = projects.find((pr) => pr.id === t.project_id);
      return p ? { name: p.name, color: p.color } : null;
    }
    if (t.department_id) {
      const d = departments.find((dp) => dp.id === t.department_id);
      return d ? { name: d.name, color: d.color } : null;
    }
    return null;
  };

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <SectionTitle title="Calendário geral" description="Tarefas de todos os projetos e departamentos" />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            aria-label="Mês anterior"
            className="btn btn-ghost p-1.5"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-semibold capitalize">
            {cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </span>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            aria-label="Próximo mês"
            className="btn btn-ghost p-1.5"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            onClick={() => {
              const d = new Date();
              setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
            className="btn btn-outline px-2.5 py-1 text-xs"
          >
            Hoje
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-secondary/40">
        {WEEKDAYS.map((d) => (
          <span key={d} className="px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground uppercase">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = toISO(day);
          const list = byDay.get(iso) ?? [];
          const outside = day.getMonth() !== cursor.getMonth();
          return (
            <div
              key={iso}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/task-id");
                if (id) onReschedule(id, iso);
              }}
              className={cn(
                "min-h-28 border-r border-b border-border p-1.5 last:border-r-0",
                outside && "bg-secondary/30",
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full text-[11px] tabular-nums",
                  iso === todayISO ? "bg-brand font-semibold text-brand-foreground" : "text-muted-foreground",
                )}
              >
                {day.getDate()}
              </span>

              <div className="mt-1 space-y-1">
                {list.slice(0, MAX_PER_DAY).map((t) => {
                  const assignee = members.find((m) => m.id === t.assignee_id);
                  const container = containerOf(t);
                  return (
                    <button
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)}
                      onClick={() => onOpenTask(t)}
                      title={container ? `${t.title} — ${container.name}` : t.title}
                      className={cn(
                        "flex w-full items-center gap-1 rounded border px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-secondary",
                        t.status === "concluido"
                          ? "border-success/30 bg-success/10 text-muted-foreground line-through"
                          : isLate(t)
                            ? "border-destructive/30 bg-destructive/5"
                            : "border-border bg-card",
                      )}
                    >
                      {t.is_milestone && <Flag className="size-3 shrink-0 text-warning" />}
                      {container && <span className={cn("size-1.5 shrink-0 rounded-full", dotClass(container.color))} />}
                      <span className="truncate">{t.title}</span>
                      {assignee && (
                        <Avatar
                          name={assignee.name}
                          color={assignee.avatar_color}
                          src={assignee.avatar_url}
                          size="xs"
                          className="ml-auto shrink-0"
                        />
                      )}
                    </button>
                  );
                })}
                {list.length > MAX_PER_DAY && (
                  <p className="px-1 text-[10px] text-muted-foreground">+{list.length - MAX_PER_DAY} mais</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
