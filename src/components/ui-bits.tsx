import { useEffect } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_META, type TaskStatus } from "@/lib/domain";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TONES: Record<string, string> = {
  neutral: "bg-secondary text-muted-foreground",
  info: "bg-info/10 text-info",
  warning: "bg-warning/18 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  success: "bg-success/12 text-success",
  brand: "bg-brand/12 text-brand",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.backlog;
  return <Pill tone={meta.tone as keyof typeof TONES}>{meta.label}</Pill>;
}

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONES[tone] ?? TONES["neutral"],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="card-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <Pill tone={tone}>{hint}</Pill> : null}
      </div>
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const BAR_TONES: Record<string, string> = {
  brand: "bg-brand",
  primary: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

export function Bar({ value, tone = "brand" }: { value: number; tone?: keyof typeof BAR_TONES }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", BAR_TONES[tone] ?? BAR_TONES["brand"])}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center">
      {Icon ? <Icon className="size-6 text-muted-foreground/60" /> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Rótulo + valor: agrupa informações relacionadas dentro de um mesmo bloco. */
export function MetaItem({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-0.5 truncate text-sm">{children}</div>
    </div>
  );
}

/** Rótulo acima de um campo de formulário. */
export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export type RowAction = {
  label: string;
  onSelect: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  destructive?: boolean;
  separatorBefore?: boolean;
};

/** Menu de três pontos: centraliza as ações da linha em um único ponto. */
export function RowMenu({
  actions,
  label = "Ações",
  className,
}: {
  actions: RowAction[];
  label?: string;
  className?: string;
}) {
  if (!actions.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          className,
        )}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {actions.map((a, i) => (
          <div key={a.label}>
            {a.separatorBefore && i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              onSelect={a.onSelect}
              className={cn("gap-2 text-sm", a.destructive && "text-destructive focus:text-destructive")}
            >
              {a.icon ? <a.icon className="size-4" /> : null}
              {a.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Diálogo centralizado padrão (criar/editar). Fecha no Esc e no clique fora. */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onClose}
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-foreground/25 p-4 backdrop-blur-[2px] sm:items-center"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cn("card-raised w-full", width)}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="btn btn-ghost -mr-1.5 p-1.5">
            <X className="size-4" />
          </button>
        </header>
        <div className="space-y-3 px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
