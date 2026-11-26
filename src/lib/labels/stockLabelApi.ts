import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { StockLabelMode, StockLabelQuantityItem, StockLabelScope } from "./stockLabelBatch";

/** Lojas que aceitam contagem por etiquetas (mesma lista do computador e do celular). */
export const STOCK_LABEL_STORES = [
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro" },
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Perola" },
];

export interface StockLabelStorePreview { stock: number; pending: number; posProductId: string | null; code: string | null }
export interface StockLabelApplyResult {
  batch_id: string; numero: number; labels: number; changed: number; total_delta: number;
  skipped?: Array<{ code: string; reason: string }>;
}

/** Códigos internos das variações (em lotes de 200). */
export async function fetchVariantCodes(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await (supabase.from("product_variant_codes" as any) as any)
      .select("variant_id, code").in("variant_id", ids.slice(i, i + 200));
    (data || []).forEach((r: any) => map.set(r.variant_id, r.code));
  }
  return map;
}

/** Saldo da loja por variação + horário do servidor (abre a contagem). */
export async function loadStockLabelPreview(masterIds: string[], storeId: string) {
  const { data: now, error: nowError } = await supabase.rpc("server_now");
  if (nowError) throw nowError;
  if (!masterIds.length) throw new Error("Não foi possível identificar o produto das variações.");
  const responses = await Promise.all(masterIds.map((idMaster) =>
    supabase.rpc("stock_label_preview", { p_master_id: idMaster, p_store_id: storeId })));
  const preview: Record<string, StockLabelStorePreview> = {};
  for (const response of responses) {
    if (response.error) throw response.error;
    for (const row of (response.data || []) as any[]) {
      preview[row.variant_id] = {
        stock: Number(row.stock || 0), pending: Number(row.pending_expedition || 0),
        posProductId: row.pos_product_id || null, code: row.code || null,
      };
    }
  }
  return { openedAt: now as unknown as string, preview };
}

/** Grava o lote (impressão, balanço ou adição) — o banco calcula os saldos. */
export async function applyStockLabelBatch(p: {
  storeId: string; mode: StockLabelMode; items: StockLabelQuantityItem[]; openedAt: string;
  masterId?: string; scope: StockLabelScope; userName?: string;
}): Promise<StockLabelApplyResult> {
  const { data, error } = await supabase.rpc("apply_stock_label_batch", {
    p_store_id: p.storeId,
    p_mode: p.mode,
    p_items: p.items as unknown as Json,
    p_opened_at: p.openedAt,
    p_master_id: p.masterId,
    p_scope: p.mode === "balance" ? p.scope : "selected",
    p_user_name: p.userName || undefined,
  });
  if (error) throw error;
  const result = data as unknown as StockLabelApplyResult;
  if (!result?.batch_id) throw new Error("O lote não foi confirmado pelo banco.");
  return result;
}
