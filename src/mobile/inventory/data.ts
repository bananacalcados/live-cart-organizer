import { supabase } from "@/integrations/supabase/client";
import { resolveInventoryProductCode } from "@/lib/inventoryStockCode";

export interface MobileMasterHit { id: string; name: string; sku_root: string; sale_price: number | null }

export function looksLikeStockCode(value: string): boolean {
  const q = value.trim();
  return /^[0-9A-Za-z][0-9A-Za-z./-]*$/.test(q) && /\d/.test(q);
}

/** Primeiro tenta o código exato; só depois busca por nome/sku do pai (até 30). */
export async function searchMasters(term: string, options: { codeOnly?: boolean } = {}): Promise<{
  hits: MobileMasterHit[];
  exactMasterId?: string;
  exactVariantId?: string;
  notFoundCode?: string;
}> {
  const q = term.trim();
  if (!q) return { hits: [] };

  const exact = await resolveInventoryProductCode(q);
  if (exact) {
    return { hits: [], exactMasterId: exact.master_id, exactVariantId: exact.variant_id || undefined };
  }
  if (options.codeOnly) return { hits: [], notFoundCode: q };

  const safe = q.replace(/[%,()]/g, " ");
  const { data, error } = await supabase
    .from("products_master")
    .select("id,name,sku_root,sale_price")
    .or(`name.ilike.%${safe}%,sku_root.ilike.${safe}%`)
    .order("name")
    .limit(30);
  if (error) throw error;
  const hits = (data || []) as MobileMasterHit[];
  return { hits, notFoundCode: hits.length === 0 && looksLikeStockCode(q) ? q : undefined };
}

export interface MobileSheet {
  master: { id: string; name: string; sku_root: string; sale_price: number | null; brand: string | null };
  variants: { id: string; color: string | null; size: string | null; gtin: string | null; sku: string | null; sale_price_override: number | null; is_active: boolean | null }[];
  stock: { barcode: string; store_id: string; stock: number }[];
  stores: { id: string; name: string }[];
  photos: { color_key: string; url_thumb: string; url_medium: string; position: number }[];
}

export async function loadSheet(masterId: string, photosOn: boolean): Promise<MobileSheet | null> {
  const { data: master } = await supabase.from("products_master").select("id,name,sku_root,sale_price,brand").eq("id", masterId).maybeSingle();
  if (!master) return null;
  const { data: variants } = await supabase
    .from("product_variants").select("id,color,size,gtin,sku,sale_price_override,is_active").eq("master_id", masterId).order("color").order("size");
  const gtins = (variants || []).map((v: any) => v.gtin).filter(Boolean) as string[];
  const [st, stores, photos] = await Promise.all([
    gtins.length ? supabase.from("pos_products").select("barcode,store_id,stock").in("barcode", gtins) : Promise.resolve({ data: [] as any[] }),
    supabase.from("pos_stores").select("id,name").order("name"),
    photosOn
      ? supabase.from("product_color_photos").select("color_key,url_thumb,url_medium,position").eq("master_id", masterId).order("position")
      : Promise.resolve({ data: [] as any[] }),
  ]);
  return {
    master: master as any,
    variants: (variants || []) as any,
    stock: ((st as any).data || []) as any,
    stores: ((stores as any).data || []) as any,
    photos: ((photos as any).data || []) as any,
  };
}

/** Estoque por variação somado por loja (linhas do PDV casadas pelo código de barras). */
export function stockByVariant(sheet: MobileSheet) {
  return sheet.variants.map((v) => {
    const rows = sheet.stock.filter((s) => s.barcode === v.gtin);
    const perStore = sheet.stores
      .map((s) => ({ store: s.name, qty: rows.filter((r) => r.store_id === s.id).reduce((a, r) => a + (Number(r.stock) || 0), 0) }))
      .filter((x) => x.qty !== 0);
    return { variant: v, total: perStore.reduce((a, x) => a + x.qty, 0), perStore };
  });
}
