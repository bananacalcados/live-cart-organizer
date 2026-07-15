// Routes a paid order from an event with default_store_id (physical channel)
// into pos_sales as pending_pickup, mirroring SendToPOSDialog logic server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LIVE_SELLER_BY_STORE: Record<string, string> = {
  "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2": "bec7d0b3-a1fd-4611-a165-6cd49f185a0a",
  "4ade7b44-5043-4ab1-a124-7a6ab5468e29": "559b9848-4e76-4942-9c58-b9987c479111",
};
// Loja "Site/Live" (ex-Tiny Shopify) — usada para eventos de canal 'site' sem loja física padrão.
const SITE_LIVE_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { order_id } = await req.json();
    if (!order_id) return new Response(JSON.stringify({ error: "order_id required" }), { status: 400, headers: corsHeaders });

    const { data: order } = await supabase
      .from("orders")
      .select("id, event_id, customer_id, products, discount_type, discount_value, pos_sale_id, stage, is_paid, payment_method_label, installments")
      .eq("id", order_id)
      .maybeSingle();

    if (!order) return new Response(JSON.stringify({ error: "order not found" }), { status: 404, headers: corsHeaders });
    if (order.pos_sale_id) return new Response(JSON.stringify({ skipped: "already routed" }), { headers: corsHeaders });

    const { data: event } = await supabase
      .from("events")
      .select("channel, default_store_id")
      .eq("id", order.event_id)
      .maybeSingle();

    // Aceitar eventos "site" também: rotear para a loja Site/Live (fallback).
    // Antes rejeitávamos site → agora entra como sale_type='live' em Site/Live.
    const isSiteChannel = event?.channel === "site";
    const resolvedStoreId = event?.default_store_id || (isSiteChannel ? SITE_LIVE_STORE_ID : null);

    if (!resolvedStoreId) {
      return new Response(JSON.stringify({ skipped: "no store to route" }), { headers: corsHeaders });
    }

    const storeId = resolvedStoreId as string;
    const sellerId = LIVE_SELLER_BY_STORE[storeId] || null;

    const { data: customer } = await supabase
      .from("customers")
      .select("instagram_handle, whatsapp")
      .eq("id", order.customer_id)
      .maybeSingle();

    const { data: reg } = await supabase.rpc("get_customer_last_address", { p_customer_id: order.customer_id });
    const customerName = reg?.full_name || customer?.instagram_handle || "Cliente Live";
    const whatsapp = reg?.whatsapp || customer?.whatsapp || "";

    // Resolve pos_customer: prefer CPF match (most reliable), fallback to phone suffix.
    let posCustomerId: string | null = null;
    const cpfDigits = (reg?.cpf || "").replace(/\D/g, "");
    const payload: any = {
      name: customerName,
      whatsapp: whatsapp || null,
      cpf: reg?.cpf || null,
      email: reg?.email || null,
      address: reg?.address || null,
      address_number: reg?.address_number || null,
      complement: reg?.complement || null,
      neighborhood: reg?.neighborhood || null,
      city: reg?.city || null,
      state: reg?.state || null,
      cep: reg?.cep || null,
    };

    let existingId: string | null = null;
    if (cpfDigits.length === 11) {
      const { data: byCpf } = await supabase
        .from("pos_customers")
        .select("id")
        .ilike("cpf", `%${cpfDigits}%`)
        .limit(1)
        .maybeSingle();
      existingId = byCpf?.id || null;
    }
    if (!existingId && whatsapp) {
      const suffix = whatsapp.replace(/\D/g, "").slice(-8);
      const { data: byPhone } = await supabase
        .from("pos_customers")
        .select("id")
        .ilike("whatsapp", `%${suffix}`)
        .limit(1)
        .maybeSingle();
      existingId = byPhone?.id || null;
    }

    if (existingId) {
      await supabase.from("pos_customers").update(payload).eq("id", existingId);
      posCustomerId = existingId;
    } else if (whatsapp || cpfDigits.length === 11) {
      const { data: created } = await supabase.from("pos_customers").insert(payload).select("id").single();
      posCustomerId = created?.id || null;
    }

    const products = (order.products as any[]) || [];
    const subtotal = products.reduce((s, p) => s + (p.price || 0) * (p.quantity || 0), 0);
    const discount = order.discount_type && order.discount_value
      ? order.discount_type === "percentage"
        ? subtotal * ((order.discount_value as number) / 100)
        : (order.discount_value as number)
      : 0;
    const total = Math.max(0, subtotal - discount);

    const shipping_address = reg ? {
      full_name: reg.full_name, cpf: reg.cpf, email: reg.email, whatsapp,
      cep: reg.cep, address: reg.address, number: reg.address_number,
      complement: reg.complement, neighborhood: reg.neighborhood, city: reg.city, state: reg.state,
    } : null;

    // Pedido de live JÁ PAGO online (PIX) → entra como receita ('paid' + paid_at),
    // contando no Faturamento Live. Só pedidos NÃO pagos ficam como 'pending_pickup'
    // (aguardando pagamento na retirada / aba Retiradas).
    const isPaid = !!(order as any).is_paid;
    const saleStatus = isPaid ? "paid" : "pending_pickup";
    const paidAt = isPaid ? new Date().toISOString() : null;

    const { data: sale, error: saleErr } = await supabase
      .from("pos_sales")
      .insert({
        store_id: storeId,
        seller_id: sellerId,
        customer_id: posCustomerId,
        customer_name: customerName,
        customer_phone: whatsapp,
        shipping_address,
        subtotal, discount, total,
        status: saleStatus,
        paid_at: paidAt,
        sale_type: "live",
        source_order_id: order.id,
        event_id: order.event_id,
        revenue_attribution: "store",
        payment_method: (order as any).payment_method_label || null,
        notes: `Auto-routed (Evento Físico - ${event.channel}). Pedido CRM: ${order.id.slice(0, 8)}`,
        payment_details: {
          source: "live_event_auto_route",
          event_channel: event.channel,
          customer_instagram: customer?.instagram_handle,
          customer_whatsapp: whatsapp,
          payment_method: (order as any).payment_method_label || null,
          installments: (order as any).installments || null,
        },

      })
      .select("id")
      .single();
    if (saleErr) throw saleErr;

    const items = products.map((p: any) => ({
      sale_id: sale.id,
      product_name: p.title,
      variant_name: p.variant,
      sku: p.sku || null,
      unit_price: p.price,
      quantity: p.quantity,
      total_price: p.price * p.quantity,
    }));
    if (items.length) await supabase.from("pos_sale_items").insert(items);

    await supabase.from("orders").update({ pos_sale_id: sale.id }).eq("id", order.id);

    // Tiny order creation is now MANUAL ONLY (via the "Enviar/Reenviar ao Tiny" button).
    // The live order is routed to POS (pos_sales row created above) without any
    // automatic Tiny push.

    return new Response(JSON.stringify({ success: true, sale_id: sale.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
