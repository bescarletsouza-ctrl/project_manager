export type LinkPreviewData = {
  title: string;
  description: string;
  image: string | null;
  siteName: string;
};

/**
 * Busca título/descrição/imagem de uma URL via microlink.io — serviço
 * público gratuito, sem chave de API, só pra gerar a preview de link colado
 * na descrição da tarefa. Não guarda nada; só repassa a URL pública da
 * página pra esse serviço buscar os metadados dela.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  try {
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.status !== "success" || !json.data?.title) return null;
    const d = json.data;
    let siteName = d.publisher as string | undefined;
    if (!siteName) {
      try {
        siteName = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        siteName = url;
      }
    }
    return {
      title: d.title as string,
      description: (d.description as string) ?? "",
      image: (d.image?.url as string) ?? (d.logo?.url as string) ?? null,
      siteName,
    };
  } catch {
    return null;
  }
}
