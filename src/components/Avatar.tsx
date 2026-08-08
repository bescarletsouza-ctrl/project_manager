import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  indigo: "bg-indigo-500",
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  slate: "bg-slate-500",
};

const PALETTE = Object.keys(COLORS);

/** Cor estável a partir do nome, para quem não tem cor cadastrada. */
function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  return PALETTE[hash % PALETTE.length] as string;
}

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const;

export function Avatar({
  name,
  color,
  src,
  size = "sm",
  className,
}: {
  name?: string | null | undefined;
  color?: string | undefined;
  /** Foto de perfil — quando presente, substitui as iniciais. */
  src?: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initials = (name ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

  const tone = name ? (COLORS[color ?? ""] ?? COLORS[colorFor(name)]) : null;

  if (src) {
    return (
      <img
        src={src}
        alt={name ?? "Avatar"}
        title={name ?? undefined}
        className={cn("inline-block shrink-0 rounded-full object-cover", SIZES[size], className)}
      />
    );
  }

  return (
    <span
      title={name ?? "Sem responsável"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        SIZES[size],
        tone ? `${tone} text-white` : "border border-dashed border-input text-muted-foreground",
        className,
      )}
    >
      {name ? initials : "?"}
    </span>
  );
}

/** Pilha de avatares sobrepostos (equipe do projeto, participantes). */
export function AvatarStack({
  people,
  max = 4,
  size = "sm",
}: {
  people: { id: string; name: string; avatar_color?: string; avatar_url?: string | null }[];
  max?: number;
  size?: keyof typeof SIZES;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p) => (
        <Avatar
          key={p.id}
          name={p.name}
          color={p.avatar_color}
          src={p.avatar_url}
          size={size}
          className="-ml-1.5 ring-2 ring-background first:ml-0"
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "-ml-1.5 inline-flex items-center justify-center rounded-full bg-secondary font-medium text-muted-foreground ring-2 ring-background",
            SIZES[size],
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
