import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Sem isso (staleTime: 0, padrão da lib), qualquer foco de janela ou
        // remount refaz TODAS as queries ativas de novo, além do que já é
        // invalidado explicitamente após cada mutação. 30s é curto o
        // suficiente pra parecer "ao vivo" mas evita esse refetch redundante.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
