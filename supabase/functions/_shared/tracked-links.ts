// Links rastreados por cliente: qualquer link do nosso redirecionador de grupo
// (checkout.bananacalcados.com.br/vip/<slug>) que sair em mensagem/modelo ganha
// um código por telefone (/vip/<slug>/<CODE>). Quando a cliente clica, o
// redirecionador sabe quem foi. Mesma pessoa + mesmo link = mesmo código.

const VIP_RE = /(https?:\/\/(?:checkout\.bananacalcados\.com\.br|live-cart-organizer\.lovable\.app)\/vip\/)([a-z0-9][a-z0-9_-]*)(?![a-z0-9_\/-])/gi;

export interface TrackCtx {
  source?: string | null;
  ref?: string | null;
  whatsappNumberId?: string | null;
}

async function issue(supabase: any, phone: string, slug: string, ctx: TrackCtx): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("tracked_link_issue", {
      p_phone: phone, p_slug: slug, p_source: ctx.source ?? null, p_ref: ctx.ref ?? null,
      p_number: ctx.whatsappNumberId ?? null,
    });
    if (error) { console.error("[tracked-links] issue", error.message); return null; }
    return typeof data === "string" ? data : null;
  } catch (e) {
    console.error("[tracked-links] issue", e);
    return null;
  }
}

/** Reescreve os links /vip/<slug> de um texto. Nunca falha: em erro mantém o link original. */
export async function tagTrackedText(supabase: any, phone: string, text: string, ctx: TrackCtx = {}): Promise<string> {
  if (!text || !phone || !/\/vip\//i.test(text)) return text;
  const slugs = new Set<string>();
  for (const m of text.matchAll(VIP_RE)) slugs.add(m[2].toLowerCase());
  if (slugs.size === 0) return text;
  const codes = new Map<string, string>();
  for (const s of slugs) {
    const c = await issue(supabase, phone, s, ctx);
    if (c) codes.set(s, c);
  }
  return text.replace(VIP_RE, (full, base, slug) => {
    const c = codes.get(String(slug).toLowerCase());
    return c ? `${base}${slug}/${c}` : full;
  });
}

/** Reescreve os parâmetros de texto dos componentes de um modelo (corpo, cabeçalho, cards). */
export async function tagTrackedComponents(supabase: any, phone: string, components: any, ctx: TrackCtx = {}): Promise<any> {
  if (!Array.isArray(components) || !phone) return components;
  if (!/\/vip\//i.test(JSON.stringify(components))) return components;
  const walk = async (node: any): Promise<any> => {
    if (Array.isArray(node)) return Promise.all(node.map(walk));
    if (node && typeof node === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = k === "text" && typeof v === "string" ? await tagTrackedText(supabase, phone, v, ctx) : await walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(components);
}
