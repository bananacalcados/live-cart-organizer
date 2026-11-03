import { supabase } from "@/integrations/supabase/client";

/**
 * Vendas que contam para faturamento/comissão no PDV.
 *
 * Regra do negócio:
 * - Venda SEM live (loja/online): conta pela data do pagamento.
 * - Venda de LIVE (event_id): só conta quando a Expedição do PDV foi CONCLUÍDA,
 *   e entra no período da data de conclusão (expedition_finished_at). Assim a
 *   comissão só é paga sobre o que foi de fato enviado.
 * O valor é sempre sem frete (use saleNet sobre as linhas).
 */
export const COMMISSION_REVENUE_STATUSES = ["completed", "pending_sync", "paid"];

export interface CommissionSalesOptions {
  startIso: string;
  endIso: string;
  select: string;
  storeId?: string;
  requireReleased?: boolean;
}

export function isLiveSaleCountable(sale: { event_id?: string | null; expedition_stage?: string | null; expedition_finished_at?: string | null }, startIso: string, endIso: string): boolean {
  if (!sale.event_id) return true;
  if (sale.expedition_stage !== "concluido" || !sale.expedition_finished_at) return false;
  return sale.expedition_finished_at >= startIso && sale.expedition_finished_at <= endIso;
}

async function paginate(build: () => any): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await build().order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/** Retorna as linhas com `effective_at` (data em que a venda conta). */
export async function fetchCommissionSales(opts: CommissionSalesOptions): Promise<any[]> {
  const { startIso, endIso, storeId, requireReleased } = opts;
  const select = `${opts.select}, event_id, expedition_stage, expedition_finished_at, paid_at, created_at`;
  const base = () => {
    let q: any = supabase.from("pos_sales").select(select)
      .in("status", COMMISSION_REVENUE_STATUSES)
      .neq("revenue_attribution", "site_pickup_only")
      .neq("status_cancelamento", "cancelado");
    if (storeId) q = q.eq("store_id", storeId);
    if (requireReleased) q = q.not("sale_released_at", "is", null);
    return q;
  };
  const [nonLive, live] = await Promise.all([
    paginate(() => base().is("event_id", null)
      .or(`and(paid_at.gte.${startIso},paid_at.lte.${endIso}),and(paid_at.is.null,created_at.gte.${startIso},created_at.lte.${endIso})`)),
    paginate(() => base().not("event_id", "is", null)
      .eq("expedition_stage", "concluido")
      .gte("expedition_finished_at", startIso)
      .lte("expedition_finished_at", endIso)),
  ]);
  return [
    ...nonLive.map((s) => ({ ...s, effective_at: s.paid_at || s.created_at })),
    ...live.map((s) => ({ ...s, effective_at: s.expedition_finished_at })),
  ];
}
