export type CrossellKind = "text" | "image" | "document" | "audio" | "video" | "buttons";
export interface CrossellBlock {
  id: string;
  kind: CrossellKind;
  text: string;
  media: { url: string; name: string; mime: string; size: number }[];
  buttons: { title: string; interest: boolean }[];
}
export function sampleCrossellDelay(random = Math.random): number {
  return 4000 + Math.floor(Math.max(0, Math.min(random(), 1 - Number.EPSILON)) * 11001);
}
export function crossellNextAt(completedAt: number, persisted: string | null, random = Math.random): string {
  return persisted || new Date(completedAt + sampleCrossellDelay(random)).toISOString();
}
export function metaCrossellWindow(lastIncoming: string | null, now = Date.now()): boolean {
  const at = Date.parse(lastIncoming || "");
  return Number.isFinite(at) && at <= now && now - at < 86400000;
}
export function validateCrossellBlocks(blocks: CrossellBlock[], provider: string): string | null {
  if (!["uazapi", "meta"].includes(provider)) return "Selecione uma instância uazapi ou Meta API.";
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > 50) return "Monte entre 1 e 50 blocos.";
  for (const b of blocks) {
    if (!["text", "image", "document", "audio", "video", "buttons"].includes(b.kind)) return "Tipo de bloco inválido.";
    if (["text", "buttons"].includes(b.kind) && (!b.text.trim() || b.text.length > (b.kind === "buttons" ? 1024 : 4096))) return "Revise o texto do bloco.";
    if (b.kind === "buttons" && (!b.buttons.length || b.buttons.length > 3 || b.buttons.some((v) => !v.title.trim() || v.title.length > 20) || new Set(b.buttons.map((v) => v.title)).size !== b.buttons.length)) return "Use de 1 a 3 botões diferentes, com até 20 caracteres.";
    if (!["text", "buttons"].includes(b.kind)) {
      if (!b.media.length || b.media.length > 20 || (b.kind !== "image" && b.media.length !== 1)) return "Selecione os arquivos do bloco.";
      for (const m of b.media) {
        if (!m.url.startsWith("https://")) return "O arquivo precisa ter um endereço HTTPS.";
        const max = b.kind === "image" ? 5 : b.kind === "document" ? 100 : 16;
        if (m.size > max * 1024 * 1024) return `Arquivo maior que ${max} MB.`;
        if (b.kind === "image" && m.mime && !["image/jpeg", "image/png"].includes(m.mime)) return "Fotos precisam ser JPG ou PNG.";
        if (b.kind === "video" && m.mime && !["video/mp4", "video/3gpp"].includes(m.mime)) return "Vídeo precisa ser MP4 ou 3GP.";
        if (b.kind === "audio" && m.mime && !["audio/mpeg", "audio/mp4", "audio/ogg", "audio/aac", "audio/amr"].includes(m.mime)) return "Áudio precisa ser MP3, M4A, OGG, AAC ou AMR.";
      }
    }
  }
  return null;
}