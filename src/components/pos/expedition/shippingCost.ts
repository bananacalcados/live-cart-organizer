import { supabase } from "@/integrations/supabase/client";
import { fetchProviders } from "@/lib/deliveryProviders";
import { isMototaxi, isPickup } from "./expeditionTypes";

/**
 * Persiste o custo de envio da expedição:
 *  - grava pos_sales.shipping_cost (aparece nos dashboards de custo)
 *  - registra/atualiza delivery_costs vinculado ao prestador (quando identificado)
 * Nunca lança erro de custo para não travar a expedição.
 */
export async function saveExpeditionShippingCost(params: {
  saleId: string;
  storeId: string | null;
  carrier: string;
  courierProviderId?: string | null;
  courierName?: string | null;
  cost: number;
  customerName?: string | null;
}) {
  const { saleId, storeId, carrier, courierProviderId, courierName, cost, customerName } = params;

  await supabase
    .from("pos_sales")
    .update({ shipping_cost: isPickup(carrier) ? 0 : cost || 0 } as any)
    .eq("id", saleId);

  try {
    await supabase
      .from("delivery_costs" as any)
      .delete()
      .eq("pos_sale_id", saleId)
      .eq("source", "expedition")
      .eq("status", "pending");

    if (isPickup(carrier) || !cost || cost <= 0) return;

    let providerId: string | null = courierProviderId || null;
    const providerType = isMototaxi(carrier) ? "mototaxi" : "transportadora";
    if (!providerId) {
      const providers = await fetchProviders(true).catch(() => []);
      const target = (isMototaxi(carrier) ? courierName : carrier) || "";
      providerId =
        providers.find(
          (p) => p.provider_type === providerType && p.name.trim().toLowerCase() === target.trim().toLowerCase(),
        )?.id || null;
    }

    await supabase.from("delivery_costs" as any).insert({
      provider_id: providerId,
      provider_type: providerType,
      amount: cost,
      source: "expedition",
      store_id: storeId,
      pos_sale_id: saleId,
      customer_name: customerName || null,
      notes: `Expedição — ${carrier}${courierName ? ` (${courierName})` : ""}`,
      status: "pending",
    } as any);
  } catch (e) {
    console.warn("Falha ao registrar custo de entrega da expedição:", e);
  }
}
