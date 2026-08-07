import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";

// Garante, uma vez por sessão do navegador, que members.user_id da conta
// logada está vinculado (ver migration link_current_member). Sem isso,
// quem nunca teve o vínculo feito manualmente cai em "conta não vinculada"
// e funções de banco que exigem user_id = auth.uid() (ex.: is_admin() em
// produção) nunca reconhecem a pessoa.
let didLinkMember = false;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    if (!didLinkMember) {
      didLinkMember = true;
      supabase.rpc("link_current_member" as never).catch((e) => {
        console.warn("[auth] link_current_member indisponível:", (e as { message?: string })?.message);
      });
    }
    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
