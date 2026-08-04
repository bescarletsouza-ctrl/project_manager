import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Fluxo | Gestão de projetos e produtividade" },
      {
        name: "description",
        content:
          "Acesse o Fluxo para gerenciar projetos, tarefas e acompanhar a produtividade da sua equipe.",
      },
      { property: "og:title", content: "Entrar no Fluxo" },
      { property: "og:description", content: "Gestão operacional e inteligência de produtividade." },
    ],
  }),
  component: AuthPage,
});

/**
 * Consulta a função email_liberado no banco (ver migration de mesmo nome).
 * Se a função ainda não foi aplicada, não trava o cadastro — a checagem aqui é
 * de experiência, quem barra de verdade é a política do banco.
 */
async function emailLiberado(email: string) {
  const { data, error } = await supabase.rpc("email_liberado" as never, { p_email: email } as never);
  if (error) {
    console.warn("[auth] email_liberado indisponível, seguindo sem checar:", error.message);
    return true;
  }
  return data === true;
}

/** Traduz os erros mais comuns do Supabase para algo acionável. */
function mensagemDeErro(err: unknown) {
  const raw = err instanceof Error ? err.message : "";
  const texto = raw.toLowerCase();

  if (texto.includes("error sending") || texto.includes("confirmation email")) {
    return "O Supabase não conseguiu enviar o e-mail de confirmação. Configure um SMTP próprio ou desative a confirmação de e-mail.";
  }
  if (texto.includes("already registered") || texto.includes("already been registered")) {
    return "Já existe uma conta com este e-mail. Use “Entrar” ou recupere a senha.";
  }
  if (texto.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }
  if (texto.includes("email not confirmed")) {
    return "Confirme o e-mail pelo link enviado antes de entrar.";
  }
  if (texto.includes("password")) {
    return `Senha recusada: ${raw}`;
  }
  return raw || "Não foi possível autenticar.";
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        if (!(await emailLiberado(email))) {
          toast.error(
            "Este e-mail ainda não foi liberado. Peça a um administrador para cadastrá-lo em Configurações > Equipe.",
          );
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Conta criada. Confira seu e-mail para confirmar o acesso.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(mensagemDeErro(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card-surface w-full max-w-sm p-6">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Voltar
        </Link>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {mode === "login" ? "Entrar no Fluxo" : "Criar sua conta"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestão de projetos com inteligência de produtividade.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <button
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
        </button>
      </div>
    </div>
  );
}
