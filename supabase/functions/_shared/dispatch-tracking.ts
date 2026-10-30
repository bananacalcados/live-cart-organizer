// Rastreamento por destinatário nos disparos em massa: links do nosso domínio
// de live (/ao-vivo, /pedido, /vip) ganham ?d=<código>&utm_source=disparo&utm_campaign=<id curto>.
// Sem link reconhecido, nada muda.

const LINK_RE = /https?:\/\/checkout\.bananacalcados\.com\.br\/(?:ao-vivo|pedido|vip)\/[^\s"'<>]*/gi;
const BASE_RE = /checkout\.bananacalcados\.com\.br\/(?:ao-vivo|pedido|vip)\//i;

export function hasTrackableLink(value: unknown): boolean {
  return BASE_RE.test(typeof value === "string" ? value : JSON.stringify(value ?? ""));
}

export function shortDispatchId(dispatchId: string): string {
  return String(dispatchId || "").replace(/-/g, "").slice(0, 8);
}

function trackingQuery(code: string, dispatchId: string): string {
  return `d=${code}&utm_source=disparo&utm_campaign=${shortDispatchId(dispatchId)}`;
}

/** Acrescenta o código a um link completo, preservando query/fragmento existentes. */
export function tagDispatchUrl(url: string, code: string, dispatchId: string): string {
  if (/[?&]d=/.test(url)) return url;
  // Não engole pontuação final de frase.
  const m = url.match(/^(.*?)([.,;:!?)]*)$/);
  let core = m ? m[1] : url;
  const tail = m ? m[2] : "";
  let hash = "";
  const h = core.indexOf("#");
  if (h >= 0) { hash = core.slice(h); core = core.slice(0, h); }
  const sep = core.includes("?") ? (core.endsWith("?") || core.endsWith("&") ? "" : "&") : "?";
  return `${core}${sep}${trackingQuery(code, dispatchId)}${hash}${tail}`;
}

export function tagDispatchText(text: string, code: string, dispatchId: string): string {
  if (!text || !code) return text;
  return text.replace(LINK_RE, (u) => tagDispatchUrl(u, code, dispatchId));
}

/**
 * Reescreve os componentes já montados de um modelo. `templateComponents` é a
 * definição (para saber se o botão URL aponta para o nosso domínio — aí o código
 * vai no sufixo variável).
 */
export function tagDispatchComponents(components: any[], templateComponents: any[], code: string, dispatchId: string): any[] {
  if (!Array.isArray(components) || !code) return components;
  const buttons = (templateComponents || []).find((c: any) => c?.type === "BUTTONS")?.buttons || [];
  const dynUrlButtons = buttons.filter((b: any) => b?.type === "URL" && String(b.url || "").includes("{{"));
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(node)) out[k] = k === "text" && typeof v === "string" ? tagDispatchText(v, code, dispatchId) : walk(v);
      return out;
    }
    return node;
  };
  return components.map((comp: any) => {
    if (comp?.type === "button" && comp?.sub_type === "url") {
      const def = dynUrlButtons[Number(comp.index) || 0];
      const base = String(def?.url || "");
      if (!BASE_RE.test(base) || !/\{\{\d+\}\}$/.test(base)) return walk(comp);
      return {
        ...comp,
        parameters: (comp.parameters || []).map((p: any) => {
          if (p?.type !== "text" || typeof p.text !== "string" || /[?&]d=/.test(p.text)) return p;
          const full = base.replace(/\{\{\d+\}\}/, p.text);
          const tagged = tagDispatchUrl(full, code, dispatchId);
          const prefix = base.split(/\{\{\d+\}\}/)[0];
          return { ...p, text: tagged.startsWith(prefix) ? tagged.slice(prefix.length) : p.text };
        }),
      };
    }
    return walk(comp);
  });
}
