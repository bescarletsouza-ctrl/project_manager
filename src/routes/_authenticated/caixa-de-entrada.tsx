import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Inbox, Mail, MailOpen, Trash2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, Pill, RowMenu } from "@/components/ui-bits";
import { TaskPane } from "@/components/TaskPane";
import { useWorkspaceData, nameById } from "@/lib/useData";
import { useAsanaData, useCurrentMember } from "@/lib/useAsana";
import {
  NOTIFICATION_LABEL,
  deleteNotification,
  markAllRead,
  markNotificationRead,
  setNotificationArchived,
  setNotificationRead,
} from "@/lib/asana";
import type { Task } from "@/lib/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/caixa-de-entrada")({
  head: () => ({
    meta: [
      { title: "Caixa de entrada — atividades e menções — Fluxo" },
      {
        name: "description",
        content: "Atribuições, menções, comentários e mudanças de status das suas tarefas em um único lugar.",
      },
      { property: "og:title", content: "Caixa de entrada — Fluxo" },
      { property: "og:description", content: "Tudo o que aconteceu nas suas tarefas, em ordem cronológica." },
    ],
  }),
  component: InboxPage,
});

type Tab = "unread" | "all" | "archived";

const TABS: { id: Tab; label: string }[] = [
  { id: "unread", label: "Não lidas" },
  { id: "all", label: "Todas" },
  { id: "archived", label: "Arquivadas" },
];

/** "Hoje", "Ontem" ou a data — cabeçalho de cada bloco da caixa de entrada. */
function dayLabel(iso: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(`${iso}T00:00:00`);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return day.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function InboxPage() {
  const qc = useQueryClient();
  const { tasks, members, projects, isLoading } = useWorkspaceData();
  const { notifications, sections, fields, fieldValues, comments, dependencies, taskProjects, attachments } =
    useAsanaData();
  const { member, userId } = useCurrentMember();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [tab, setTab] = useState<Tab>("unread");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const invalidate = () => qc.invalidateQueries();

  const read = useMutation({ mutationFn: (id: string) => markNotificationRead(id), onSuccess: invalidate });

  const toggleRead = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => setNotificationRead(id, value),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível atualizar a notificação."),
  });

  const archive = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => setNotificationArchived(id, value),
    onSuccess: (_d, v) => {
      invalidate();
      toast.success(v.value ? "Notificação arquivada." : "Notificação restaurada.");
    },
    onError: () => toast.error("Não foi possível arquivar."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteNotification(id),
    onSuccess: () => {
      invalidate();
      toast.success("Notificação apagada.");
    },
    onError: () => toast.error("Não foi possível apagar."),
  });

  const readAll = useMutation({
    mutationFn: () => markAllRead(member!.id),
    onSuccess: () => {
      invalidate();
      toast.success("Tudo marcado como lido.");
    },
    onError: () => toast.error("Não foi possível marcar como lido."),
  });

  if (isLoading) return <div className="card-surface h-96 animate-pulse" />;

  const mine = member ? notifications.filter((n) => n.member_id === member.id) : [];
  const inPeriod = mine.filter((n) => {
    const day = n.created_at.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });

  const list = inPeriod.filter((n) =>
    tab === "archived" ? !!n.archived_at : !n.archived_at && (tab === "all" || !n.read_at),
  );
  const unreadCount = inPeriod.filter((n) => !n.read_at && !n.archived_at).length;
  const live = openTask ? (tasks.find((t) => t.id === openTask.id) ?? null) : null;

  /** Agrupa por dia mantendo a ordem cronológica decrescente. */
  const groups: { day: string; items: typeof list }[] = [];
  for (const n of list) {
    const day = n.created_at.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(n);
    else groups.push({ day, items: [n] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Inbox className="size-5" /> Caixa de entrada
          </h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount} não lidas de {inPeriod.length} atividades no período
          </p>
        </div>
        {member && unreadCount > 0 && (
          <button onClick={() => readAll.mutate()} className="btn btn-outline">
            Marcar tudo como lido
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-secondary p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors",
                tab === t.id && "bg-background font-medium text-foreground shadow-[var(--shadow-soft)]",
              )}
            >
              {t.label}
              {t.id === "unread" && unreadCount > 0 ? ` (${unreadCount})` : ""}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>De</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="field h-8 w-auto" />
          <span>até</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="field h-8 w-auto" />
          {(from || to) && (
            <button
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="btn btn-ghost px-2 py-1 text-xs"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {!member ? (
        <EmptyState
          title="Vincule sua conta a uma pessoa da equipe"
          description="A caixa de entrada mostra as atividades destinadas ao seu perfil."
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nada por aqui"
          description="Novas atribuições, menções e comentários aparecem nesta lista."
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.day} className="card-surface overflow-hidden">
              <header className="border-b border-border bg-secondary/40 px-4 py-2">
                <h2 className="text-[13px] font-semibold">{dayLabel(g.day)}</h2>
              </header>
              <ul>
                {g.items.map((n) => {
                  const task = tasks.find((t) => t.id === n.task_id) ?? null;
                  const actor = members.find((m) => m.id === n.actor_member_id) ?? null;
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "group flex items-start gap-3 border-t border-border/60 px-4 py-2.5 transition-colors first:border-t-0 hover:bg-secondary/40",
                        !n.read_at && "bg-brand/[0.04]",
                      )}
                    >
                      <span className="mt-2 flex w-2 shrink-0 justify-center">
                        {!n.read_at && <span className="size-2 rounded-full bg-brand" />}
                      </span>
                      <button
                        onClick={() => {
                          if (!n.read_at) read.mutate(n.id);
                          if (task) setOpenTask(task);
                        }}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <Avatar name={actor?.name} color={actor?.avatar_color} />
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm", !n.read_at && "font-medium")}>{n.title}</p>
                          {n.body && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{n.body}</p>}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {nameById(projects, n.project_id)} ·{" "}
                            {new Date(n.created_at).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <Pill tone={n.kind === "mencao" ? "warning" : n.kind === "atribuicao" ? "info" : "neutral"}>
                          {NOTIFICATION_LABEL[n.kind] ?? n.kind}
                        </Pill>
                        <RowMenu
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                          actions={[
                            {
                              label: n.read_at ? "Marcar como não lida" : "Marcar como lida",
                              icon: n.read_at ? Mail : MailOpen,
                              onSelect: () => toggleRead.mutate({ id: n.id, value: !n.read_at }),
                            },
                            {
                              label: n.archived_at ? "Desarquivar" : "Arquivar",
                              icon: n.archived_at ? ArchiveRestore : Archive,
                              onSelect: () => archive.mutate({ id: n.id, value: !n.archived_at }),
                            },
                            {
                              label: "Apagar",
                              icon: Trash2,
                              destructive: true,
                              separatorBefore: true,
                              onSelect: () => remove.mutate(n.id),
                            },
                          ]}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {live && (
        <TaskPane
          task={live}
          tasks={tasks}
          members={members}
          sections={sections}
          fields={fields}
          fieldValues={fieldValues}
          comments={comments}
          dependencies={dependencies}
          projects={projects}
          taskProjects={taskProjects}
          attachments={attachments}
          currentMember={member}
          currentUserId={userId}
          onClose={() => setOpenTask(null)}
          onOpenTask={(t) => setOpenTask(t)}
        />
      )}
    </div>
  );
}
