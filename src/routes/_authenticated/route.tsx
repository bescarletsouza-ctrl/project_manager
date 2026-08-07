import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";

// Garante, uma vez por sessão do navegador, que members.user_id da conta
// logada está vinculado (ver migration link_current_member). Sem isso,
// quem nunca teve o vínculo feito manualmente cai em "conta não vinculada"
// e funções de banco que exigem user_id = auth.uid() (ex.: is_admin() em
// produção) nunca reconhecem a pessoa.
let didLinkMember = false;

/**
 * No reload a frio a sessão precisa ser restaurada do zero, e essa chamada
 * pode falhar por uma instabilidade momentânea de rede — sem isso, um blip
 * assim derruba a página inteira na tela genérica de erro em vez de só
 * carregar normal. Uma segunda tentativa resolve a esmagadora maioria dos
 * casos (é exatamente o que "Try again" já fazia manualmente).
 */
async function getAuthUser() {
  try {
    return await supabase.auth.getUser();
  } catch {
    return await supabase.auth.getUser();
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await getAuthUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    if (!didLinkMember) {
      didLinkMember = true;
      // O builder do supabase-js é "thenable" (tem .then), mas não é uma
      // Promise de verdade — em algumas versões .catch() direto nele explode
      // com "X.rpc(...).catch is not a function". Promise.resolve(...)
      // adota o thenable e devolve uma Promise real, aí .catch() funciona.
      Promise.resolve(supabase.rpc("link_current_member" as never)).catch((e) => {
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
