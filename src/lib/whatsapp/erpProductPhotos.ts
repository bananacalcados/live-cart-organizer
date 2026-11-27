// Fase C: produtos do ERP no WhatsApp (catálogo do PDV/live, seletor de foto e venda online).
// Interruptor app_settings.product_source_whatsapp (padrão "shopify" = comportamento antigo).
import { supabase } from "@/integrations/supabase/client";
import type { ErpCatalogItem } from "@/lib/liveProductSource";

export interface ErpColorCard {
  id: string;            // erp:<produto>:<cor>
  masterId: string;
  productName: string;
  color: string | null;
  sizes: string[];
  price: number;
  image: string | null;  // foto do ERP por cor (medium) ou foto espelhada da Shopify
  imageSource: "erp" | "shopify" | null;
  liveCode: string | null;
  stockPerola: number;
  variants: Array<{ variantId: string; sku: string; size: string | null; shopifyVariantId: string | null }>;
}

const natural = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

/** Um cartão por produto+cor (todas as cores ativas, inclusive sem estoque). */
export function erpColorCards(items: ErpCatalogItem[]): ErpColorCard[] {
  const out: ErpColorCard[] = [];
  for (const it of items) {
    const byColor = new Map<string, ErpColorCard>();
    for (const v of it.variants || []) {
      const key = (v.color || "").trim().toLowerCase();
      let c = byColor.get(key);
      if (!c) {
        c = { id: `erp:${it.master_id}:${key || "unica"}`, masterId: it.master_id, productName: it.name, color: v.color || null, sizes: [],
          price: Number(v.price ?? it.sale_price ?? 0), image: null, imageSource: null, liveCode: v.live_code, stockPerola: 0, variants: [] };
        byColor.set(key, c);
        out.push(c);
      }
      if (v.image && (!c.image || (c.imageSource !== "erp" && v.image_source === "erp"))) { c.image = v.image; c.imageSource = v.image_source; }
      if (v.size && !c.sizes.includes(v.size)) c.sizes.push(v.size);
      c.stockPerola += Number(v.stock_perola || 0);
      c.variants.push({ variantId: v.variant_id, sku: v.gtin || v.sku || "", size: v.size, shopifyVariantId: v.shopify_variant_id });
    }
    for (const c of byColor.values()) c.sizes.sort(natural);
  }
  return out;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Texto do produto (também usado quando não há foto). */
export function erpCardCaption(c: Pick<ErpColorCard, "productName" | "color" | "sizes" | "price">): string {
  const lines = [`🛍 ${c.productName}`];
  if (c.color) lines.push(`🎨 Cor: ${c.color}`);
  if (c.sizes.length) lines.push(`📏 Tamanhos: ${c.sizes.join(", ")}`);
  lines.push("", `💸 *R$ ${brl(c.price)}*`);
  return lines.join("\n");
}

/**
 * URL para enviar pelo WhatsApp. O "medium" do servidor de fotos é WebP, que a API oficial
 * da Meta não aceita como imagem; o mesmo arquivo existe em JPG (_g.jpg). Preferimos o JPG.
 */
export function whatsappSendCandidates(url: string | null | undefined): string[] {
  const u = String(url || "");
  if (!u) return [];
  const m = u.match(/^(https:\/\/fotos\.servidorbanana\.com\/.+)_m\.webp$/);
  return m ? [`${m[1]}_g.jpg`, u] : [u];
}

/** Confere que a foto abre (evita mandar imagem quebrada). Meta só recebe JPG/PNG. */
export async function resolveSendableImage(url: string | null | undefined, provider: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  for (const c of whatsappSendCandidates(url)) {
    if (provider === "meta" && /\.webp(\?|$)/i.test(c)) continue;
    try {
      const r = await fetcher(c, { method: "HEAD" });
      const type = r.headers.get("content-type") || "";
      if (r.ok && type.startsWith("image/")) return c;
    } catch { /* tenta a próxima */ }
  }
  return null;
}

/** Estoque por loja das variações exibidas (uma consulta por página, pelo código de barras/SKU). */
export async function erpStoreStock(skus: string[]): Promise<Map<string, Array<{ store: string; stock: number }>>> {
  const codes = [...new Set(skus.filter(Boolean))].slice(0, 200);
  const res = new Map<string, Array<{ store: string; stock: number }>>();
  if (!codes.length) return res;
  const db = supabase as any;
  const [{ data: rows }, { data: stores }] = await Promise.all([
    db.from("pos_products").select("store_id,barcode,stock").in("barcode", codes).limit(1000),
    db.from("pos_stores").select("id,name").limit(50),
  ]);
  const names = new Map<string, string>((stores || []).map((s: any) => [s.id, s.name]));
  for (const r of rows || []) {
    const list = res.get(r.barcode) || [];
    const name = names.get(r.store_id) || "Loja";
    const ex = list.find((x) => x.store === name);
    if (ex) ex.stock += Number(r.stock || 0); else list.push({ store: name, stock: Number(r.stock || 0) });
    res.set(r.barcode, list);
  }
  return res;
}

/** Soma o estoque por loja de um cartão (todas as numerações da cor). */
export function cardStoreStock(card: ErpColorCard, stock: Map<string, Array<{ store: string; stock: number }>>) {
  const tot = new Map<string, number>();
  for (const v of card.variants) for (const s of stock.get(v.sku) || []) tot.set(s.store, (tot.get(s.store) || 0) + s.stock);
  return [...tot.entries()].map(([store, n]) => ({ store, stock: n })).sort((a, b) => a.store.localeCompare(b.store));
}
