import { supabase } from "@/integrations/supabase/client";

export type ProviderType = "mototaxi" | "transportadora";

export type DeliverySource =
  | "pos_centro"
  | "pos_perola"
  | "live"
  | "site"
  | "expedition_beta"
  | "expedition"
  | "pos";

export interface ServiceProvider {
  id: string;
  name: string;
  phone: string | null;
  document: string | null;
  provider_type: ProviderType;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeliveryCost {
  id: string;
  provider_id: string | null;
  provider_type: ProviderType;
  amount: number;
  source: DeliverySource;
  store_id: string | null;
  pos_sale_id: string | null;
  expedition_order_id: string | null;
  customer_name: string | null;
  notes: string | null;
  status: "pending" | "paid";
  payment_id: string | null;
  created_at: string;
}

export interface ProviderPayment {
  id: string;
  provider_id: string;
  paid_store_id: string | null;
  cash_register_id: string | null;
  total_amount: number;
  receipt_pdf_url: string | null;
  proof_file_url: string | null;
  paid_at: string;
  created_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface ProviderPayableSummary {
  provider: ServiceProvider;
  pendingTotal: number;
  pendingCount: number;
  costs: DeliveryCost[];
}

export const PROVIDER_TYPE_LABEL: Record<ProviderType, string> = {
  mototaxi: "🏍️ Mototaxista",
  transportadora: "🚚 Transportadora",
};

export const SOURCE_LABEL: Record<DeliverySource, string> = {
  pos_centro: "PDV Centro",
  pos_perola: "PDV Pérola",
  live: "Live Shopping",
  site: "Site",
  expedition_beta: "Expedição Beta",
  expedition: "Expedição",
  pos: "PDV",
};

export function sourceLabel(source: string): string {
  return (SOURCE_LABEL as Record<string, string>)[source] || source;
}

/** Maps a POS store name to the delivery source bucket. */
export function storeNameToSource(storeName?: string | null): DeliverySource {
  const n = (storeName || "").toLowerCase();
  if (n.includes("perola") || n.includes("pérola")) return "pos_perola";
  if (n.includes("centro")) return "pos_centro";
  if (n.includes("live")) return "live";
  if (n.includes("site")) return "site";
  return "pos";
}

export async function fetchProviders(activeOnly = true): Promise<ServiceProvider[]> {
  let q = supabase.from("service_providers" as any).select("*").order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data as any as ServiceProvider[]) || [];
}

export interface CreateDeliveryCostInput {
  provider_id: string;
  provider_type: ProviderType;
  amount: number;
  source: DeliverySource;
  store_id?: string | null;
  pos_sale_id?: string | null;
  expedition_order_id?: string | null;
  customer_name?: string | null;
  notes?: string | null;
}

export async function createDeliveryCost(input: CreateDeliveryCostInput) {
  const { error } = await supabase.from("delivery_costs" as any).insert({
    provider_id: input.provider_id,
    provider_type: input.provider_type,
    amount: input.amount,
    source: input.source,
    store_id: input.store_id ?? null,
    pos_sale_id: input.pos_sale_id ?? null,
    expedition_order_id: input.expedition_order_id ?? null,
    customer_name: input.customer_name ?? null,
    notes: input.notes ?? null,
    status: "pending",
  } as any);
  if (error) throw error;
}

/** Loads all pending delivery costs grouped by provider (universal across stores/modules). */
export async function fetchPayablesByProvider(): Promise<ProviderPayableSummary[]> {
  const [providersRes, costsRes] = await Promise.all([
    supabase.from("service_providers" as any).select("*"),
    supabase
      .from("delivery_costs" as any)
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);
  if (providersRes.error) throw providersRes.error;
  if (costsRes.error) throw costsRes.error;

  const providers = (providersRes.data as any as ServiceProvider[]) || [];
  const costs = (costsRes.data as any as DeliveryCost[]) || [];
  const byId = new Map<string, ServiceProvider>();
  providers.forEach((p) => byId.set(p.id, p));

  const grouped = new Map<string, DeliveryCost[]>();
  for (const c of costs) {
    if (!c.provider_id) continue;
    const arr = grouped.get(c.provider_id) || [];
    arr.push(c);
    grouped.set(c.provider_id, arr);
  }

  const summaries: ProviderPayableSummary[] = [];
  for (const [providerId, list] of grouped.entries()) {
    const provider = byId.get(providerId);
    if (!provider) continue;
    summaries.push({
      provider,
      pendingTotal: list.reduce((s, c) => s + Number(c.amount || 0), 0),
      pendingCount: list.length,
      costs: list,
    });
  }
  summaries.sort((a, b) => b.pendingTotal - a.pendingTotal);
  return summaries;
}

export interface PayProviderInput {
  provider: ServiceProvider;
  costIds: string[];
  totalAmount: number;
  cashRegisterId?: string | null;
  paidStoreId?: string | null;
  notes?: string | null;
}

/**
 * Settles a list of delivery costs:
 *  - creates a provider_payments row
 *  - marks the costs as paid (status + payment_id)
 *  - registers a cash withdrawal (sangria) on the open register so the money leaves the cash
 * Returns the created provider_payments row (with id) so the receipt can be generated.
 */
export async function payProvider(input: PayProviderInput): Promise<ProviderPayment> {
  const { provider, costIds, totalAmount, cashRegisterId, paidStoreId, notes } = input;

  const { data: payment, error: payErr } = await supabase
    .from("provider_payments" as any)
    .insert({
      provider_id: provider.id,
      paid_store_id: paidStoreId ?? null,
      cash_register_id: cashRegisterId ?? null,
      total_amount: totalAmount,
      notes: notes ?? null,
    } as any)
    .select("*")
    .single();
  if (payErr) throw payErr;

  const paymentRow = payment as any as ProviderPayment;

  const { error: updErr } = await supabase
    .from("delivery_costs" as any)
    .update({ status: "paid", payment_id: paymentRow.id } as any)
    .in("id", costIds);
  if (updErr) throw updErr;

  // Take the money out of the cash register (sangria), if an open register is provided.
  if (cashRegisterId && paidStoreId) {
    try {
      const { data: reg } = await supabase
        .from("pos_cash_registers")
        .select("withdrawals")
        .eq("id", cashRegisterId)
        .maybeSingle();
      const current = Number((reg as any)?.withdrawals || 0);
      await supabase
        .from("pos_cash_registers")
        .update({ withdrawals: current + totalAmount })
        .eq("id", cashRegisterId);

      await supabase.from("pos_cash_movements" as any).insert({
        cash_register_id: cashRegisterId,
        store_id: paidStoreId,
        type: "withdraw",
        amount: totalAmount,
        description: `Pagamento prestador: ${provider.name}`,
      } as any);
    } catch (e) {
      console.warn("Falha ao registrar sangria do pagamento de prestador:", e);
    }
  }

  return paymentRow;
}

export async function setPaymentReceiptUrl(paymentId: string, url: string) {
  await supabase
    .from("provider_payments" as any)
    .update({ receipt_pdf_url: url } as any)
    .eq("id", paymentId);
}

export async function setPaymentProofUrl(paymentId: string, url: string) {
  await supabase
    .from("provider_payments" as any)
    .update({ proof_file_url: url } as any)
    .eq("id", paymentId);
}
