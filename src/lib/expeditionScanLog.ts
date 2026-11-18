import { supabase } from "@/integrations/supabase/client";

export type ExpeditionScanFlow = "pos" | "classica" | "beta";
export type ExpeditionScanStage = "separacao" | "embalagem" | "conferencia";
export type ExpeditionScanMethod = "etiqueta_nova" | "codigo_antigo" | "manual" | "vincular" | "desfeito";

export interface ExpeditionScanLogEntry {
  flow: ExpeditionScanFlow;
  stage: ExpeditionScanStage;
  method: ExpeditionScanMethod;
  code_read?: string | null;
  variant_code?: string | null;
  variant_id?: string | null;
  sale_id?: string | null;
  sale_item_id?: string | null;
  expedition_order_id?: string | null;
  expedition_order_item_id?: string | null;
  product_name?: string | null;
  variant_name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  quantity?: number;
  store_id?: string | null;
  operator_name?: string | null;
}

/** Registro de auditoria isolado: nunca atrasa nem altera o fluxo da conferência. */
export function logExpeditionScan(entry: ExpeditionScanLogEntry): void {
  try {
    const request = (supabase.from("expedition_scan_log" as any) as any).insert({
      ...entry,
      quantity: entry.quantity ?? 1,
    });
    void Promise.resolve(request)
      .then((result: any) => {
        if (result?.error) console.warn("Falha silenciosa ao registrar bipagem da expedição", result.error);
      })
      .catch((error: unknown) => {
        console.warn("Falha silenciosa ao registrar bipagem da expedição", error);
      });
  } catch (error) {
    console.warn("Falha silenciosa ao registrar bipagem da expedição", error);
  }
}
