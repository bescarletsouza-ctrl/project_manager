import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mantém a tela ao vivo: sem isso, uma mudança feita por OUTRO usuário (ou
 * por um trigger de banco, como as notificações de movimentação) só aparecia
 * depois de recarregar a página — o app só buscava dados uma vez e reagia a
 * mutações locais (useInvalidate). Assina postgres_changes nas tabelas que
 * mais importam pra "ver a mudança acontecer" e invalida a query certa a
 * cada evento, deixando o React Query refazer o fetch sozinho.
 *
 * As tabelas escutadas também precisam estar na publicação `supabase_realtime`
 * no banco (ver migration 20260813130000) — sem isso o canal nunca recebe
 * evento nenhum, mesmo com o client corretamente inscrito.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_projects" }, () => {
        queryClient.invalidateQueries({ queryKey: ["task_projects"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
