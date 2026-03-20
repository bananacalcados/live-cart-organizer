import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyPaymentConfirmed } from "../_shared/payment-confirmed.ts";

async function autoCreateShopifyOrder(_supabase: any, orderId: string, source: string, supabaseUrl: string, supabaseKey: string) {
  try {
    if (source !== "orders") return;
    console.log(`[AUTO-SHOPIFY] Creating Shopify order for ${source} ${orderId}...`);
    const res = await fetch(`${supabaseUrl}/functions/v1/shopify-create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    console.log(`[AUTO-SHOPIFY] Result:`, JSON.stringify(data).substring(0, 500));
  } catch (err: any) {
    console.error(`[AUTO-SHOPIFY] Error (non-blocking):`, err.message || err);
  }
}

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
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

// Status da Appmax em português
const APPMAX_PAID_STATUSES = ["aprovado", "integrado"];
const APPMAX_AUTHORIZED_STATUSES = ["autorizado"]; // análise em andamento, NÃO marcar como pago
const APPMAX_FAILED_STATUSES = ["cancelado", "estornado"];

// Eventos que NÃO devem acionar atualização de pagamento
const IGNORED_EVENTS = [
  "OrderAuthorized",
  "OrderBilletCreated",
  "OrderBilletOverdue",
  "OrderPendingIntegration",
  "CustomerCreated",
  "CustomerInterested",
];

// Eventos que confirmam pagamento
const PAID_EVENTS = ["OrderApproved", "OrderPaid", "OrderIntegrated"];

async function autoCreateTinyOrder(supabase: any, saleId: string, supabaseUrl: string, supabaseKey: string) {
  try {
    const { data: sale } = await supabase
      .from("pos_sales")
      .select("store_id, customer_name, customer_phone, payment_details, tiny_order_id")
      .eq("id", saleId)
      .maybeSingle();

    if (!sale || !sale.store_id) {
      console.log(`[AUTO-TINY] No store_id for sale ${saleId}, skipping`);
      return;
    }
    if (sale.tiny_order_id) {
      console.log(`[AUTO-TINY] Sale ${saleId} already has tiny_order_id=${sale.tiny_order_id}, skipping`);
      return;
    }

    const { data: saleItems } = await supabase
      .from("pos_sale_items")
      .select("*")
      .eq("sale_id", saleId);

    if (!saleItems || saleItems.length === 0) {
      console.log(`[AUTO-TINY] No items for sale ${saleId}, skipping`);
      return;
    }

    const pd = sale.payment_details || {};
    const tinyCustomer: any = {
      name: pd.customer_name || sale.customer_name || "Consumidor Final",
      cpf: pd.customer_cpf || "",
      email: pd.customer_email || "",
      whatsapp: pd.customer_phone || sale.customer_phone || "",
      address: pd.address_street || "",
      addressNumber: pd.address_number || "",
      neighborhood: pd.address_neighborhood || "",
      city: pd.address_city || "",
      state: pd.address_state || "",
      cep: pd.address_cep || "",
    };

    const tinyItems = saleItems.map((it: any) => ({
      sku: it.sku || "",
      name: it.product_name,
      variant: it.variant_name || null,
      quantity: it.quantity,
      price: Number(it.unit_price),
      barcode: it.barcode || null,
      tiny_id: it.tiny_product_id || null,
    }));

    const installments = pd.installments || 1;
    const paymentMethodLabel = pd.payment_method === "credit_card"
      ? (installments > 1 ? `Cartão de Crédito ${installments}x` : "Cartão de Crédito")
      : pd.payment_method === "pix" ? "PIX" : undefined;

    const tinyPayload = {
      store_id: sale.store_id,
      sale_id: saleId,
      customer: tinyCustomer,
      items: tinyItems,
      payment_method_name: paymentMethodLabel,
      notes: "Checkout online - webhook AppMax",
    };

    console.log(`[AUTO-TINY] Creating Tiny order for sale ${saleId}...`);
    const tinyRes = await fetch(
      `${supabaseUrl}/functions/v1/pos-tiny-create-sale`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(tinyPayload),
      }
    );
    const tinyData = await tinyRes.json();
    console.log(`[AUTO-TINY] Result:`, JSON.stringify(tinyData).substring(0, 500));
  } catch (err) {
    console.error(`[AUTO-TINY] Error (non-blocking):`, err);
  }
}

/**
 * Busca o pedido interno usando múltiplas estratégias:
 * 1. Por appmax_order_id (campo de vínculo direto)
 * 2. Por notes contendo o appmax ID (legado)
 * 3. Por telefone do cliente (via tabela customers) — pedidos não pagos mais recentes
 * 4. Por pos_sales com telefone
 */
async function findOrder(supabase: any, appmaxId: string | number, telephone: string | null) {
  // Strategy 1: Search by appmax_order_id (gateway link field)
  if (appmaxId) {
    const { data: orderByGateway } = await supabase
      .from("orders")
      .select("id, is_paid, notes, stage")
      .eq("appmax_order_id", String(appmaxId))
      .maybeSingle();

    if (orderByGateway) {
      console.log(`[appmax] Found order ${orderByGateway.id} via appmax_order_id`);
      return { source: "orders", record: orderByGateway };
    }

    const { data: saleByGateway } = await supabase
      .from("pos_sales")
      .select("id, status, notes")
      .eq("appmax_order_id", String(appmaxId))
      .maybeSingle();

    if (saleByGateway) {
      console.log(`[appmax] Found pos_sale ${saleByGateway.id} via appmax_order_id`);
      return { source: "pos_sales", record: saleByGateway };
    }
  }

  // Strategy 2 (fallback): Search orders by appmax reference in notes
  if (appmaxId) {
    const searchTerm = `appmax`;
    const { data: orders } = await supabase
      .from("orders")
      .select("id, is_paid, notes")
      .ilike("notes", `%${searchTerm}%`)
      .ilike("notes", `%${appmaxId}%`)
      .limit(1);

    if (orders?.length) {
      return { source: "orders", record: orders[0] };
    }

    const { data: sales } = await supabase
      .from("pos_sales")
      .select("id, status, notes")
      .ilike("notes", `%${searchTerm}%`)
      .ilike("notes", `%${appmaxId}%`)
      .limit(1);

    if (sales?.length) {
      return { source: "pos_sales", record: sales[0] };
    }
  }

  // Strategy 3: Search by customer phone (orders table via customers.whatsapp)
  if (telephone) {
    const phoneSuffix = telephone.replace(/\D/g, "").slice(-8);
    if (phoneSuffix.length >= 8) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id")
        .ilike("whatsapp", `%${phoneSuffix}`)
        .limit(5);

      if (customers?.length) {
        const customerIds = customers.map((c: any) => c.id);
        const { data: orders } = await supabase
          .from("orders")
          .select("id, is_paid, notes")
          .in("customer_id", customerIds)
          .eq("is_paid", false)
          .order("created_at", { ascending: false })
          .limit(1);

        if (orders?.length) {
          return { source: "orders", record: orders[0] };
        }
      }

      const { data: sales } = await supabase
        .from("pos_sales")
        .select("id, status, notes")
        .ilike("customer_phone", `%${phoneSuffix}`)
        .not("status", "in", '("paid","completed")')
        .order("created_at", { ascending: false })
        .limit(1);

      if (sales?.length) {
        return { source: "pos_sales", record: sales[0] };
      }
    }
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const payload = await req.json();
    console.log("AppMax webhook received:", JSON.stringify(payload).substring(0, 1000));

    const event = payload.event || payload.type;
    const data = payload.data || payload;
    const appmaxOrderId = data.order_id || data.id;
    const status = (data.status || "").toLowerCase();
    const telephone = data.telephone || data.phone || null;
    const transactionId = data.transaction_id || data.id || appmaxOrderId;

    console.log(`AppMax Event: ${event}, Status: ${status}, AppmaxOrderId: ${appmaxOrderId}, Phone: ${telephone}`);

    // Ignorar eventos que não devem acionar pagamento
    if (IGNORED_EVENTS.includes(event)) {
      console.log(`AppMax: Event ${event} is ignored (non-payment event).`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: `ignored_event_${event}` }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Status "autorizado" = análise em andamento, não marcar como pago
    if (APPMAX_AUTHORIZED_STATUSES.includes(status)) {
      console.log(`AppMax: pedido em status "${status}" (análise). Aguardando confirmação.`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "under_review" }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Determinar se é pagamento confirmado ou falha
    const isPaid = APPMAX_PAID_STATUSES.includes(status) || PAID_EVENTS.includes(event);
    const isFailed = APPMAX_FAILED_STATUSES.includes(status);

    if (!isPaid && !isFailed) {
      console.log(`AppMax status "${status}" / event "${event}" not actionable, skipping.`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Buscar pedido usando múltiplas estratégias
    const found = await findOrder(supabase, appmaxOrderId, telephone);

    if (!found) {
      console.error("AppMax: pedido não encontrado para o evento", JSON.stringify(payload));
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "order_not_found" }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const { source, record } = found;
    const ourOrderId = record.id;
    let updated = false;

    console.log(`AppMax: Found order ${ourOrderId} in ${source}`);

    if (source === "orders") {
      // Guard: already paid
      if (isPaid && record.is_paid === true) {
        console.log(`[appmax] Pedido ${ourOrderId} já confirmado — ignorando.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      if (isPaid && !record.is_paid) {
        const { error } = await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_at: new Date().toISOString(),
            stage: "paid",
            notes: `${record.notes || ""}\n🔔 Webhook AppMax: pago (${transactionId})`.trim(),
            appmax_order_id: String(appmaxOrderId),
          })
          .eq("id", ourOrderId);
        if (error) console.error("Error updating orders:", error);
        else {
          updated = true;
          console.log(`orders ${ourOrderId} marked as paid via AppMax webhook`);
          console.log(`[appmax] Vinculado appmax_order_id=${appmaxOrderId} ao pedido ${ourOrderId}`);
          await notifyPaymentConfirmed({
            pedido_id: ourOrderId,
            loja: 'centro',
            gateway: 'appmax',
            transaction_id: String(transactionId),
            source: 'appmax-webhook',
          });
          // Auto-create Shopify order
          await autoCreateShopifyOrder(supabase, ourOrderId, "orders", supabaseUrl, supabaseKey);
        }
      } else if (isFailed && record.is_paid) {
        // Reverter pagamento se já estava pago e veio status de falha
        const { error } = await supabase
          .from("orders")
          .update({
            is_paid: false,
            stage: "awaiting_payment",
            notes: `${record.notes || ""}\n⚠️ Pagamento revertido: reprovado pela Appmax (status ${status})`.trim(),
          })
          .eq("id", ourOrderId);
        if (error) console.error("Error reverting orders:", error);
        else { updated = true; console.log(`orders ${ourOrderId} payment REVERTED via AppMax webhook (status ${status})`); }
      }
    } else if (source === "pos_sales") {
      // Guard: already paid
      if (isPaid && (record.status === "paid" || record.status === "completed")) {
        console.log(`[appmax] pos_sale ${ourOrderId} já confirmado — ignorando.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      if (isPaid && record.status !== "paid" && record.status !== "completed") {
        const { error } = await supabase
          .from("pos_sales")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            payment_gateway: "appmax",
            notes: `🔔 Webhook AppMax: pago (${transactionId})`,
            appmax_order_id: String(appmaxOrderId),
          } as any)
          .eq("id", ourOrderId);
        if (error) console.error("Error updating pos_sales:", error);
        else {
          updated = true;
          console.log(`pos_sales ${ourOrderId} marked as paid via AppMax webhook`);
          // Auto-create Tiny order
          await autoCreateTinyOrder(supabase, ourOrderId, supabaseUrl, supabaseKey);
        }
      } else if (isFailed && (record.status === "online_pending" || record.status === "paid" || record.status === "completed")) {
        const { error } = await supabase
          .from("pos_sales")
          .update({
            status: "payment_failed",
            payment_gateway: "appmax",
            notes: `🔔 Webhook AppMax: ${status} - ${event || "unknown"}`,
          })
          .eq("id", ourOrderId);
        if (error) console.error("Error updating pos_sales to payment_failed:", error);
        else { updated = true; console.log(`pos_sales ${ourOrderId} marked as payment_failed via AppMax webhook`); }
      }
    }

    // Log to pos_checkout_attempts
    const logStatus = isPaid ? "success" : "error";
    const logMessage = isPaid
      ? `Webhook AppMax: pagamento confirmado (${transactionId})`
      : `Webhook AppMax: pagamento ${status} - ${event || "unknown"}`;

    await supabase.from("pos_checkout_attempts").insert({
      sale_id: ourOrderId,
      payment_method: "credit_card",
      status: logStatus,
      error_message: logMessage,
      gateway: "appmax",
      transaction_id: String(transactionId),
      metadata: { source: "webhook", event, appmax_status: status },
    });

    return new Response(
      JSON.stringify({ ok: true, updated, order_id: ourOrderId }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("appmax-webhook error:", error);
    return new Response(
      JSON.stringify({ ok: true, error: error.message }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});