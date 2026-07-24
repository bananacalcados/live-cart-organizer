import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMpAccountForOrder } from "../_shared/mp-account.ts";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, mercadopago_payment_id, vindi_transaction_id, payment_method_label, payment_confirmed_source, is_paid, paid_at, products, discount_type, discount_value, shipping_cost, free_shipping")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr) throw orderErr;
    if (!order) throw new Error("Pedido não encontrado");

    // Compute expected total
    const products = (order.products as any[]) || [];
    const subtotal = products.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0);
    const discount = order.discount_type && order.discount_value
      ? order.discount_type === "percentage"
        ? subtotal * (Number(order.discount_value) / 100)
        : Number(order.discount_value)
      : 0;
    const shipping = order.free_shipping ? 0 : Number(order.shipping_cost || 0);
    const expectedTotal = Math.max(0, subtotal - discount + shipping);

    const result: any = {
      orderId,
      expectedTotal,
      confirmedSource: order.payment_confirmed_source,
      isPaid: order.is_paid,
      paidAt: order.paid_at,
      gateways: [],
    };

    // --- Mercado Pago lookup ---
    if (order.mercadopago_payment_id) {
      const mpId = String(order.mercadopago_payment_id);
      const account = await getMpAccountForOrder(supabase, orderId);
      const entry: any = { gateway: "mercadopago", paymentId: mpId, account: account?.account_name };
      if (!account?.access_token) {
        entry.error = "Nenhum token Mercado Pago disponível para consulta.";
      } else {
        try {
          const res = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, {
            headers: { Authorization: `Bearer ${account.access_token}` },
          });
          if (res.status === 404) {
            entry.status = "not_found";
            entry.error = "Pagamento não localizado no Mercado Pago (ID órfão).";
          } else if (!res.ok) {
            entry.error = `HTTP ${res.status}: ${await res.text()}`;
          } else {
            const p = await res.json();
            entry.status = p.status;
            entry.statusDetail = p.status_detail;
            entry.amount = p.transaction_amount;
            entry.currency = p.currency_id;
            entry.dateCreated = p.date_created;
            entry.dateApproved = p.date_approved;
            entry.paymentType = p.payment_type_id;
            entry.paymentMethod = p.payment_method_id;
            entry.installments = p.installments;
            entry.payer = {
              email: p.payer?.email,
              firstName: p.payer?.first_name,
              lastName: p.payer?.last_name,
              identification: p.payer?.identification,
            };
            entry.externalReference = p.external_reference;
            entry.receiptUrl = p.transaction_details?.external_resource_url
              || `https://www.mercadopago.com.br/activities/1/${mpId}`;
            entry.amountMatches = Math.abs(Number(p.transaction_amount || 0) - expectedTotal) < 0.01;
            entry.referenceMatches = !p.external_reference || p.external_reference === orderId;
          }
        } catch (e: any) {
          entry.error = e.message || String(e);
        }
      }
      result.gateways.push(entry);
    }

    if (result.gateways.length === 0) {
      result.warning = "Este pedido não tem ID de gateway conhecido para consulta.";
    }

    return new Response(JSON.stringify(result), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[gateway-payment-lookup] error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
