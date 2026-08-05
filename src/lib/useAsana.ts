import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  attachmentsQuery,
  automationsQuery,
  commentsQuery,
  customFieldsQuery,
  dependenciesQuery,
  fieldValuesQuery,
  mentionsQuery,
  notificationsQuery,
  portfoliosQuery,
  sectionsQuery,
  taskProjectsQuery,
} from "./asana";
import { membersQuery } from "./data";
import type { Member } from "./domain";

/** Dados do modelo Asana (portfólios, seções, dependências, campos, comentários, inbox). */
export function useAsanaData() {
  const portfolios = useQuery(portfoliosQuery);
  const sections = useQuery(sectionsQuery);
  const dependencies = useQuery(dependenciesQuery);
  const fields = useQuery(customFieldsQuery);
  const fieldValues = useQuery(fieldValuesQuery);
  const comments = useQuery(commentsQuery);
  const mentions = useQuery(mentionsQuery);
  const notifications = useQuery(notificationsQuery);
  const taskProjects = useQuery(taskProjectsQuery);
  const automations = useQuery(automationsQuery);
  const attachments = useQuery(attachmentsQuery);

  return {
    portfolios: portfolios.data ?? [],
    sections: sections.data ?? [],
    dependencies: dependencies.data ?? [],
    fields: fields.data ?? [],
    fieldValues: fieldValues.data ?? [],
    comments: comments.data ?? [],
    mentions: mentions.data ?? [],
    notifications: notifications.data ?? [],
    taskProjects: taskProjects.data ?? [],
    automations: automations.data ?? [],
    attachments: attachments.data ?? [],
    isLoading:
      portfolios.isLoading ||
      sections.isLoading ||
      dependencies.isLoading ||
      fields.isLoading ||
      fieldValues.isLoading ||
      comments.isLoading ||
      taskProjects.isLoading ||
      automations.isLoading ||
      notifications.isLoading ||
      attachments.isLoading,
  };
}


/** Usuário logado + membro correspondente (por user_id ou e-mail). */
export function useCurrentMember() {
  const [auth, setAuth] = useState<{ id: string; email: string | null } | null>(null);
  const members = useQuery(membersQuery);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setAuth(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
    });
    return () => {
      active = false;
    };
  }, []);

  const list = (members.data ?? []) as Member[];
  const member =
    list.find((m) => m.user_id && auth?.id && m.user_id === auth.id) ??
    list.find((m) => auth?.email && m.email.toLowerCase() === auth.email.toLowerCase()) ??
    null;

  return { userId: auth?.id ?? null, email: auth?.email ?? null, member, members: list };
}
