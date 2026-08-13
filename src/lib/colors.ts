/** Paleta compartilhada por projetos, portfólios, seções e avatares. */

export const COLOR_KEYS = [
  "indigo",
  "blue",
  "teal",
  "emerald",
  "amber",
  "rose",
  "violet",
  "slate",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABEL: Record<ColorKey, string> = {
  indigo: "Índigo",
  blue: "Azul",
  teal: "Turquesa",
  emerald: "Verde",
  amber: "Âmbar",
  rose: "Rosa",
  violet: "Violeta",
  slate: "Cinza",
};

/** Bolinha sólida (marcador do projeto na sidebar e no cabeçalho). */
const DOT: Record<string, string> = {
  indigo: "bg-indigo-500",
  blue: "bg-blue-500",
  teal: "bg-teal-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  slate: "bg-slate-400",
};

/** Fundo suave + texto (etiquetas e ícones de projeto). */
const SOFT: Record<string, string> = {
  indigo: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-300",
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  teal: "bg-teal-500/12 text-teal-600 dark:text-teal-300",
  emerald: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  rose: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  slate: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
};

export const dotClass = (color?: string | null) => DOT[color ?? ""] ?? DOT["slate"]!;
export const softClass = (color?: string | null) => SOFT[color ?? ""] ?? SOFT["slate"]!;

/**
 * Cor estavel derivada de um texto (ex.: nome de secao), pra quando o dado
 * nao tem uma cor propria configurada -- toda secao nasce com color='slate'
 * no banco (nao existe UI pra trocar isso), entao usar section.color direto
 * fazia toda secao renderizar igual. Hash simples e determinístico: o mesmo
 * nome sempre cai na mesma cor, em qualquer lista/sessao.
 */
export function colorForSeed(seed: string): ColorKey {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return COLOR_KEYS[Math.abs(hash) % COLOR_KEYS.length]!;
}
