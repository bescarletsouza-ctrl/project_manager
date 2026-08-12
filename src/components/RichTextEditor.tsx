import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bold,
  Check,
  ChevronDown,
  ChevronUp,
  Eraser,
  ExternalLink,
  Italic,
  List,
  ListOrdered,
  Strikethrough,
  Underline,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LinkPreviewData = { title: string; description: string; image: string | null; siteName: string };
type LinkDisplayMode = "card" | "inline" | "url";
const LP_MODE_LABEL: Record<LinkDisplayMode, string> = {
  card: "Pré-visualização",
  inline: "Link em linha",
  url: "URL",
};

/** Formatação semântica permitida — sem estilos/cores/fontes coladas de fora, que quebrariam o visual do app. */
const ALLOWED_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
  "UL", "OL", "LI", "BR", "P", "DIV", "SPAN",
  "H1", "H2", "H3", "BLOCKQUOTE", "CODE", "PRE", "A", "IMG",
]);

/** Únicas classes que sobrevivem à sanitização — as do card de preview de link (ver buildLinkNode) e a de @menção. */
const ALLOWED_CLASSES = new Set([
  "link-preview-card",
  "link-preview-inline",
  "link-preview-url",
  "lp-thumb",
  "lp-body",
  "lp-title",
  "lp-desc",
  "lp-site",
  "mention",
]);

/** Atributos data-lp-* preservados num link com preview — guardam os metadados mesmo quando o modo exibido é "inline"/"url", pra poder voltar pra "Pré-visualização" depois sem buscar de novo. */
const LP_DATA_ATTRS = ["data-lp", "data-lp-title", "data-lp-desc", "data-lp-site"];

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
  const cls = el.getAttribute("class");
  if (cls && ALLOWED_CLASSES.has(cls)) clean.setAttribute("class", cls);
  if (el.tagName === "A") {
    const href = el.getAttribute("href");
    if (href && /^https?:\/\//i.test(href)) {
      clean.setAttribute("href", href);
      clean.setAttribute("target", "_blank");
      clean.setAttribute("rel", "noopener noreferrer");
    }
    if (el.getAttribute("data-lp") === "1") {
      for (const attr of LP_DATA_ATTRS) {
        const v = el.getAttribute(attr);
        if (v) clean.setAttribute(attr, v);
      }
      const image = el.getAttribute("data-lp-image");
      if (image && /^https:\/\//i.test(image)) clean.setAttribute("data-lp-image", image);
    }
  }
  if (el.tagName === "IMG") {
    // Só aceita src https (a URL que a gente mesmo gera ao subir a imagem) —
    // descarta data:/blob:/http: pra não abrir brecha de conteúdo externo/injetado.
    const src = el.getAttribute("src");
    if (!src || !/^https:\/\//i.test(src)) return;
    clean.setAttribute("src", src);
    const alt = el.getAttribute("alt");
    if (alt) clean.setAttribute("alt", alt);
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
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-brand [&_a]:underline [&_strong]:font-semibold [&_b]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_img]:my-1 [&_img]:max-w-full [&_img]:rounded-md " +
  // Card de preview de link — a.link-preview-card não deve herdar o sublinhado/cor de link comum.
  "[&_.link-preview-card]:my-1 [&_.link-preview-card]:flex [&_.link-preview-card]:items-center [&_.link-preview-card]:gap-3 [&_.link-preview-card]:rounded-lg [&_.link-preview-card]:border [&_.link-preview-card]:border-border [&_.link-preview-card]:p-2 [&_.link-preview-card]:no-underline [&_.link-preview-card]:text-foreground [&_.link-preview-card]:hover:bg-secondary/50 " +
  "[&_.lp-thumb]:size-16 [&_.lp-thumb]:shrink-0 [&_.lp-thumb]:rounded-md [&_.lp-thumb]:object-cover [&_.lp-thumb]:my-0 " +
  "[&_.lp-body]:min-w-0 [&_.lp-body]:flex-1 " +
  "[&_.lp-title]:truncate [&_.lp-title]:text-sm [&_.lp-title]:font-medium " +
  "[&_.lp-desc]:line-clamp-2 [&_.lp-desc]:text-xs [&_.lp-desc]:text-muted-foreground " +
  "[&_.lp-site]:text-[11px] [&_.lp-site]:text-muted-foreground [&_.lp-site]:uppercase " +
  // @menção — mesmo destaque usado no comentário (font-medium text-brand).
  "[&_.mention]:font-medium [&_.mention]:text-brand";

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
  onImagePaste,
  onLinkPreview,
  members,
}: {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  resetKey: string;
  className?: string;
  collapsedHeight?: number;
  /** Sobe a imagem colada e devolve a URL pública pra inserir inline — sem isso, colar imagem não faz nada. */
  onImagePaste?: (file: File) => Promise<string>;
  /** Busca título/descrição/imagem de um link colado sozinho — sem isso, o link só entra como texto/URL normal. */
  onLinkPreview?: (url: string) => Promise<LinkPreviewData | null>;
  /** Lista pra autocompletar @menção — sem isso, digitar @ não sugere ninguém. */
  members?: { id: string; name: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const linkMenuRef = useRef<HTMLDivElement>(null);
  const [pendingPaste, setPendingPaste] = useState<{ html: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [fetchingLink, setFetchingLink] = useState(false);
  /** Link clicado no editor cujo menu "Exibir como" está aberto. */
  const [linkMenu, setLinkMenu] = useState<{ el: HTMLAnchorElement; x: number; y: number } | null>(null);
  /** @menção sendo digitada — mesma regra do comentário: "@" seguido de nome, sem espaço. */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionRect, setMentionRect] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!linkMenu) return;
    // Confere se o clique foi DENTRO do menu (via .contains) em vez de contar só com
    // stopPropagation — clicar num botão do menu fechava o menu antes do onClick dele
    // rodar (o elemento saía do DOM entre o mousedown e o click, que aí nunca disparava).
    const close = (e: MouseEvent) => {
      if (linkMenuRef.current?.contains(e.target as Node)) return;
      setLinkMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [linkMenu]);

  const mentionMatches =
    mentionQuery === null || !members
      ? []
      : members.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);

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

  /** Olha o texto antes do cursor: se termina em "@parcial", abre o autocomplete. */
  const detectMention = () => {
    if (!members) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || sel.getRangeAt(0).startContainer.nodeType !== Node.TEXT_NODE) {
      setMentionQuery(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const text = range.startContainer.textContent ?? "";
    const uptoCursor = text.slice(0, range.startOffset);
    const match = uptoCursor.match(/(?:^|\s)@([\p{L}\d._-]{0,30})$/u);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(match[1] ?? "");
    setMentionIndex(0);
    const rect = range.cloneRange().getBoundingClientRect();
    setMentionRect({ x: rect.left, y: rect.bottom + 4 });
  };

  /**
   * Troca o "@parcial" digitado por um span destacado (mesma cor do comentário),
   * dividindo o nó de texto em: antes / span da menção / espaço / depois.
   */
  const pickMention = (member: { id: string; name: string }) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentNode;
    if (!parent) return;
    const text = node.textContent ?? "";
    const uptoCursor = text.slice(0, range.startOffset);
    const atIndex = uptoCursor.lastIndexOf("@");
    if (atIndex === -1) return;

    const mentionSpan = document.createElement("span");
    mentionSpan.className = "mention";
    mentionSpan.textContent = `@${member.name}`;
    const spaceNode = document.createTextNode(" ");
    const afterNode = document.createTextNode(text.slice(range.startOffset));
    const beforeNode = document.createTextNode(text.slice(0, atIndex));

    parent.replaceChild(afterNode, node);
    parent.insertBefore(spaceNode, afterNode);
    parent.insertBefore(mentionSpan, spaceNode);
    parent.insertBefore(beforeNode, mentionSpan);

    const newRange = document.createRange();
    newRange.setStartAfter(spaceNode);
    newRange.setEndAfter(spaceNode);
    sel.removeAllRanges();
    sel.addRange(newRange);
    setMentionQuery(null);
    ref.current?.focus();
    emitChange();
  };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
  };

  /** Insere um nó na posição do cursor, sem passar string por innerHTML (evita qualquer risco de injeção). */
  const insertNodeAtRange = (node: HTMLElement, range: Range | null) => {
    if (range) {
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      ref.current?.appendChild(node);
    }
    emitChange();
    checkOverflow();
  };

  const insertImage = (url: string, range: Range | null) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "imagem colada";
    insertNodeAtRange(img, range);
  };

  /**
   * Constrói o link com preview num dos 3 formatos (card/inline/url). Os
   * metadados ficam salvos em data-lp-* independente do modo mostrado, pra
   * trocar de formato depois (menu "Exibir como") sem buscar de novo.
   */
  const buildLinkNode = (url: string, data: LinkPreviewData, mode: LinkDisplayMode) => {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("data-lp", "1");
    a.setAttribute("data-lp-title", data.title);
    a.setAttribute("data-lp-desc", data.description);
    a.setAttribute("data-lp-site", data.siteName);
    if (data.image) a.setAttribute("data-lp-image", data.image);

    if (mode === "url") {
      a.className = "link-preview-url";
      a.textContent = url;
      return a;
    }
    if (mode === "inline") {
      a.className = "link-preview-inline";
      a.textContent = data.title || url;
      return a;
    }
    a.className = "link-preview-card";
    if (data.image) {
      const img = document.createElement("img");
      img.src = data.image;
      img.alt = "";
      img.className = "lp-thumb";
      a.appendChild(img);
    }
    const body = document.createElement("div");
    body.className = "lp-body";
    const title = document.createElement("div");
    title.className = "lp-title";
    title.textContent = data.title;
    body.appendChild(title);
    if (data.description) {
      const desc = document.createElement("div");
      desc.className = "lp-desc";
      desc.textContent = data.description;
      body.appendChild(desc);
    }
    const site = document.createElement("div");
    site.className = "lp-site";
    site.textContent = data.siteName;
    body.appendChild(site);
    a.appendChild(body);
    return a;
  };

  const insertLinkPreview = (url: string, data: LinkPreviewData, range: Range | null) =>
    insertNodeAtRange(buildLinkNode(url, data, "card"), range);

  const insertPlainLink = (url: string, range: Range | null) => {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = url;
    insertNodeAtRange(a, range);
  };

  /** Lê os metadados salvos no link clicado e reconstrói no formato escolhido. */
  const switchLinkMode = (el: HTMLAnchorElement, mode: LinkDisplayMode) => {
    const data: LinkPreviewData = {
      title: el.getAttribute("data-lp-title") ?? "",
      description: el.getAttribute("data-lp-desc") ?? "",
      image: el.getAttribute("data-lp-image"),
      siteName: el.getAttribute("data-lp-site") ?? "",
    };
    const url = el.getAttribute("href") ?? "";
    el.replaceWith(buildLinkNode(url, data, mode));
    setLinkMenu(null);
    emitChange();
    checkOverflow();
  };

  const currentLinkMode = (el: HTMLAnchorElement): LinkDisplayMode =>
    el.classList.contains("link-preview-inline") ? "inline" : el.classList.contains("link-preview-url") ? "url" : "card";

  /** Clique num link com preview abre o menu "Exibir como" em vez de navegar — evita sair da tarefa sem querer ao editar. */
  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a[data-lp="1"]') as HTMLAnchorElement | null;
    if (!target) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    setLinkMenu({ el: target, x: rect.left, y: rect.bottom + 4 });
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (imageItem) {
      e.preventDefault();
      if (!onImagePaste) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
      setUploadingImage(true);
      try {
        const url = await onImagePaste(file);
        ref.current?.focus();
        insertImage(url, range);
      } catch {
        toast.error("Não foi possível colar a imagem.");
      } finally {
        setUploadingImage(false);
      }
      return;
    }

    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const bareUrl = text.trim();

    // Link colado sozinho (nada mais como texto): busca a preview em vez de colar como link cru.
    // Não exige html vazio — copiar uma URL da barra de endereço ou de várias páginas já vem com
    // um <html> junto (ex.: um <a> embrulhando o mesmo link), e isso não deveria bloquear a preview.
    if (onLinkPreview && /^https?:\/\/\S+$/i.test(bareUrl)) {
      e.preventDefault();
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
      setFetchingLink(true);
      try {
        const data = await onLinkPreview(bareUrl);
        ref.current?.focus();
        if (data) insertLinkPreview(bareUrl, data, range);
        else {
          toast.error("Não achei informações desse link — colei como link normal.");
          insertPlainLink(bareUrl, range);
        }
      } catch {
        ref.current?.focus();
        toast.error("Não foi possível buscar a preview do link.");
        insertPlainLink(bareUrl, range);
      } finally {
        setFetchingLink(false);
      }
      return;
    }

    e.preventDefault();
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
        {uploadingImage && <span className="ml-1 text-xs text-muted-foreground">Enviando imagem…</span>}
        {fetchingLink && <span className="ml-1 text-xs text-muted-foreground">Buscando preview do link…</span>}
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
            detectMention();
          }}
          onPaste={handlePaste}
          onBlur={() => {
            setMentionQuery(null);
            onBlur?.();
          }}
          onClick={handleEditorClick}
          onKeyDown={(e) => {
            if (mentionQuery === null || mentionMatches.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setMentionIndex((i) => (i + 1) % mentionMatches.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const chosen = mentionMatches[mentionIndex];
              if (chosen) pickMention(chosen);
            } else if (e.key === "Escape") {
              setMentionQuery(null);
            }
          }}
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

      {linkMenu && (
        <div
          ref={linkMenuRef}
          style={{ left: linkMenu.x, top: linkMenu.y }}
          className="fixed z-50 w-52 rounded-md border border-border bg-popover p-1 text-xs shadow-[var(--shadow-raised)]"
        >
          <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase">Exibir como</p>
          {(["inline", "card", "url"] as LinkDisplayMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => switchLinkMode(linkMenu.el, mode)}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-secondary"
            >
              {LP_MODE_LABEL[mode]}
              {currentLinkMode(linkMenu.el) === mode && <Check className="size-3.5 text-brand" />}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <a
            href={linkMenu.el.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setLinkMenu(null)}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ExternalLink className="size-3.5" /> Abrir link
          </a>
        </div>
      )}

      {mentionQuery !== null && mentionMatches.length > 0 && mentionRect && (
        <div
          style={{ left: mentionRect.x, top: mentionRect.y }}
          className="fixed z-50 w-56 rounded-md border border-border bg-popover p-1 text-xs shadow-[var(--shadow-raised)]"
        >
          {mentionMatches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickMention(m)}
              className={cn(
                "flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-secondary",
                i === mentionIndex && "bg-secondary",
              )}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

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
