import { useEffect, useRef, useState } from "react";
import { Bold, ChevronDown, ChevronUp, Eraser, Italic, List, ListOrdered, Strikethrough, Underline } from "lucide-react";
import { cn } from "@/lib/utils";

/** Formatação semântica permitida — sem estilos/cores/fontes coladas de fora, que quebrariam o visual do app. */
const ALLOWED_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
  "UL", "OL", "LI", "BR", "P", "DIV", "SPAN",
  "H1", "H2", "H3", "BLOCKQUOTE", "CODE", "PRE", "A",
]);

function sanitizeNode(node: Node, out: Node[], doc: Document) {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(doc.createTextNode(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return; // descarta comments, script, style etc.

  const el = node as HTMLElement;
  const childrenOut: Node[] = [];
  el.childNodes.forEach((c) => sanitizeNode(c, childrenOut, doc));

  if (el.tagName === "BR") {
    out.push(doc.createElement("br"));
    return;
  }
  if (!ALLOWED_TAGS.has(el.tagName)) {
    // tag não permitida: promove os filhos já sanitizados pro nível de cima, sem perder o texto
    out.push(...childrenOut);
    return;
  }
  const clean = doc.createElement(el.tagName.toLowerCase());
  if (el.tagName === "A") {
    const href = el.getAttribute("href");
    if (href && /^https?:\/\//i.test(href)) {
      clean.setAttribute("href", href);
      clean.setAttribute("target", "_blank");
      clean.setAttribute("rel", "noopener noreferrer");
    }
  }
  childrenOut.forEach((c) => clean.appendChild(c));
  out.push(clean);
}

/** Mantém só formatação semântica (negrito, listas, links...); descarta script/style/atributos/estilo inline. */
export function sanitizeHtml(dirty: string): string {
  const doc = new DOMParser().parseFromString(dirty, "text/html");
  const out: Node[] = [];
  doc.body.childNodes.forEach((c) => sanitizeNode(c, out, doc));
  const container = doc.createElement("div");
  out.forEach((n) => container.appendChild(n));
  return container.innerHTML;
}

function plainTextOf(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Classes compartilhadas pra listas/links renderizarem certo (sem plugin de typography). */
const RICH_CONTENT_CLASSES =
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-brand [&_a]:underline [&_strong]:font-semibold [&_b]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px]";

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

/**
 * Editor de descrição com formatação básica. Ao colar texto com formatação
 * (Word, Google Docs, outra página), pergunta se mantém a formatação
 * original ou cola só o texto — só pergunta quando há diferença real entre
 * as duas versões, senão cola direto.
 *
 * `resetKey` (ex.: task.id) é o único gatilho que reescreve o conteúdo do
 * contentEditable a partir de `value` — sincronizar em toda mudança de
 * `value` faria o cursor pular pro início a cada tecla digitada.
 */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  resetKey,
  className,
  collapsedHeight = 140,
}: {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  resetKey: string;
  className?: string;
  collapsedHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pendingPaste, setPendingPaste] = useState<{ html: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  const checkOverflow = () => {
    requestAnimationFrame(() => {
      if (ref.current) setCanExpand(ref.current.scrollHeight > collapsedHeight + 8);
    });
  };

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value || "";
    setExpanded(false);
    checkOverflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const emitChange = () => onChange(ref.current?.innerHTML ?? "");

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html.trim() && plainTextOf(sanitizeHtml(html)) !== text.trim()) {
      setPendingPaste({ html, text });
      return;
    }
    document.execCommand("insertText", false, text);
    emitChange();
    checkOverflow();
  };

  const resolvePaste = (withFormatting: boolean) => {
    if (!pendingPaste) return;
    ref.current?.focus();
    if (withFormatting) document.execCommand("insertHTML", false, sanitizeHtml(pendingPaste.html));
    else document.execCommand("insertText", false, pendingPaste.text);
    setPendingPaste(null);
    emitChange();
    checkOverflow();
  };

  const empty = !value || plainTextOf(value) === "";

  return (
    <div className={cn("rounded-md border border-input bg-background", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        <ToolbarButton icon={Bold} label="Negrito" onClick={() => exec("bold")} />
        <ToolbarButton icon={Italic} label="Itálico" onClick={() => exec("italic")} />
        <ToolbarButton icon={Underline} label="Sublinhado" onClick={() => exec("underline")} />
        <ToolbarButton icon={Strikethrough} label="Riscado" onClick={() => exec("strikeThrough")} />
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolbarButton icon={List} label="Lista" onClick={() => exec("insertUnorderedList")} />
        <ToolbarButton icon={ListOrdered} label="Lista numerada" onClick={() => exec("insertOrderedList")} />
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolbarButton icon={Eraser} label="Limpar formatação" onClick={() => exec("removeFormat")} />
      </div>

      {pendingPaste && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/50 px-2 py-1.5 text-xs">
          <span className="text-muted-foreground">O texto colado tem formatação.</span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => resolvePaste(true)}
            className="rounded border border-input px-2 py-0.5 hover:bg-secondary"
          >
            Colar com formatação
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => resolvePaste(false)}
            className="rounded border border-input px-2 py-0.5 hover:bg-secondary"
          >
            Colar sem formatação
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPendingPaste(null)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      )}

      <div className="relative">
        {empty && placeholder && (
          <span className="pointer-events-none absolute top-2 left-3 text-sm text-muted-foreground">
            {placeholder}
          </span>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={() => {
            emitChange();
            checkOverflow();
          }}
          onPaste={handlePaste}
          onBlur={onBlur}
          style={{ maxHeight: expanded ? undefined : collapsedHeight }}
          className={cn(
            "min-h-24 overflow-hidden px-3 py-2 text-sm outline-none",
            RICH_CONTENT_CLASSES,
          )}
        />
        {!expanded && canExpand && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent" />
        )}
      </div>

      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-border py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3.5" /> Recolher
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" /> Expandir
            </>
          )}
        </button>
      )}
    </div>
  );
}

/** Renderização somente-leitura do HTML salvo (ex.: preview em outra tela). Sempre sanitiza antes de exibir. */
export function RichTextView({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn("text-sm break-words", RICH_CONTENT_CLASSES, className)}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}
