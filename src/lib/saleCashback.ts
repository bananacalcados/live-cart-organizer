import { supabase } from "@/integrations/supabase/client";

export type PhoneCashback = {
  id: string; coupon_code: string; cashback_amount: number; min_purchase: number; expires_at: string;
  reserved_sale_id: string | null; reserved_order_id: string | null;
};

/** Cashbacks ativos do WhatsApp (uma chamada por modal aberto). */
export async function listPhoneCashbacks(phone: string): Promise<PhoneCashback[]> {
  if (phone.replace(/\D/g, "").length < 8) return [];
  const { data, error } = await supabase.rpc("available_cashbacks_for_phone" as any, { p_phone: phone });
  if (error) throw error;
  return ((data as any[]) || []).map((r) => ({ ...r, cashback_amount: Number(r.cashback_amount || 0), min_purchase: Number(r.min_purchase || 0) }));
}

/** Não envia valor: o banco confere dono, mínimo e reserva, e recalcula desconto/total. */
export async function setSaleCashback(saleId: string, cashbackId: string | null) {
  const { data, error } = await supabase.rpc("set_sale_cashback" as any, { p_sale_id: saleId, p_cashback_id: cashbackId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("O servidor não retornou o novo total");
  return { cashback_id: row.cashback_id || null, cashback_amount: Number(row.cashback_amount || 0), discount: Number(row.discount || 0), total: Number(row.total || 0) };
}

/** Mesmo teste do servidor: produtos (já com outros descontos) precisam alcançar o mínimo. */
export function cashbackReachesMin(productsBase: number, minPurchase: number) {
  return productsBase + 0.0001 >= minPurchase;
}
