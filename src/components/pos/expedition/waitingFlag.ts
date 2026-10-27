import { supabase } from "@/integrations/supabase/client";

/** Regra: falta produto quando algum item ainda não chegou inteiro na Conferência/Concluído. */
export function hasMissingProducts(
  items: { quantity: number | null; expedition_conference_qty?: number | null; expedition_completed_qty?: number | null }[],
): boolean {
  return items.some(
    (i) =>
      (Number(i.expedition_conference_qty) || 0) + (Number(i.expedition_completed_qty) || 0) <
      (Number(i.quantity) || 0),
  );
}

/** Recalcula a tag "AGUARDANDO PRODUTO" a partir dos itens gravados (1 consulta + updates só onde muda). */
export async function syncWaitingProductsFlag(saleIds: string[]): Promise<void> {
  const ids = [...new Set(saleIds)].filter(Boolean);
  if (!ids.length) return;
  const { data, error } = await supabase
    .from("pos_sale_items")
    .select("sale_id, quantity, expedition_conference_qty, expedition_completed_qty")
    .in("sale_id", ids);
  if (error) throw error;
  const bySale = new Map<string, any[]>();
  for (const r of (data || []) as any[]) {
    if (!bySale.has(r.sale_id)) bySale.set(r.sale_id, []);
    bySale.get(r.sale_id)!.push(r);
  }
  const yes = ids.filter((id) => hasMissingProducts(bySale.get(id) || []));
  const no = ids.filter((id) => !yes.includes(id));
  if (yes.length)
    await supabase.from("pos_sales").update({ expedition_waiting_products: true } as any).in("id", yes).eq("expedition_waiting_products", false);
  if (no.length)
    await supabase.from("pos_sales").update({ expedition_waiting_products: false } as any).in("id", no).eq("expedition_waiting_products", true);
}
