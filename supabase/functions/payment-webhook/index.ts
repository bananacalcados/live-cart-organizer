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

// VINDI/Yapay status mapping
const VINDI_PAID_STATUSES = [6]; // Somente "Aprovada" é pagamento confirmado
const VINDI_FAILED_STATUSES = [7, 13, 14, 88, 89]; // Cancelada, Cancel.Manual, Estornada, Rejeitada, Fraude

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
      notes: "Checkout online - webhook VINDI",
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const url = new URL(req.url);
  const gateway = url.searchParams.get("gateway") || "unknown";

  const ALLOWED_GATEWAYS = ["mercadopago", "pagarme", "vindi", "appmax"];
  if (!ALLOWED_GATEWAYS.includes(gateway)) {
    return new Response(JSON.stringify({ error: "Invalid gateway" }), {
      status: 400,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  try {
    console.log(`payment-webhook received for gateway: ${gateway}`);

    if (gateway === "vindi") {
      return await handleVindi(req, supabase, supabaseUrl, supabaseKey);
    }
    if (gateway === "mercadopago") {
      return await handleMercadoPago(req, supabase, supabaseUrl, supabaseKey);
    }
    // For pagarme/appmax, just acknowledge — they have dedicated webhooks
    console.log(`Gateway "${gateway}" has its own webhook. Acknowledging.`);
    return new Response(JSON.stringify({ ok: true, routed: false }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("payment-webhook error:", error);
    return new Response(
      JSON.stringify({ ok: true, error: error.message }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});

async function validateMercadoPagoSignature(req: Request, body: string): Promise<boolean> {
  const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.log("[mercadopago] MERCADOPAGO_WEBHOOK_SECRET not set, skipping signature validation");
    return true; // Allow if secret not configured (graceful degradation)
  }

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");

  if (!xSignature || !xRequestId) {
    console.warn("[mercadopago] Missing x-signature or x-request-id headers");
    return false;
  }

  try {
    // Parse x-signature: "ts=...,v1=..."
    const parts: Record<string, string> = {};
    for (const part of xSignature.split(",")) {
      const [key, ...vals] = part.split("=");
      parts[key.trim()] = vals.join("=").trim();
    }

    const ts = parts["ts"];
    const v1 = parts["v1"];
    if (!ts || !v1) {
      console.warn("[mercadopago] Invalid x-signature format");
      return false;
    }

    // Extract data.id from body
    const parsed = JSON.parse(body);
    const dataId = parsed?.data?.id;

    // Build the manifest string as per MP docs
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    // Compute HMAC-SHA256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(manifest));
    const computed = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");

    if (computed !== v1) {
      console.error(`[mercadopago] Signature mismatch: computed=${computed.substring(0, 16)}... expected=${v1.substring(0, 16)}...`);
      return false;
    }

    console.log("[mercadopago] Signature validated successfully");
    return true;
  } catch (err) {
    console.error("[mercadopago] Signature validation error:", err);
    return false;
  }
}

async function handleMercadoPago(req: Request, supabase: any, supabaseUrl: string, supabaseKey: string) {
  const rawBody = await req.text();
  
  // Validate webhook signature
  const isValid = await validateMercadoPagoSignature(req, rawBody);
  if (!isValid) {
    console.error("[mercadopago] Invalid webhook signature, rejecting");
    return new Response(JSON.stringify({ ok: false, error: "invalid_signature" }), {
      status: 401,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const body = JSON.parse(rawBody);
  console.log("MercadoPago webhook:", JSON.stringify(body).substring(0, 500));

  // MercadoPago IPN sends { action, type, data: { id } }
  const action = body.action || body.type;
  const paymentId = body.data?.id;

  if (!paymentId) {
    console.log("No payment ID in MercadoPago webhook, skipping.");
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  // Only process payment updates
  if (body.type !== "payment") {
    console.log(`MercadoPago webhook type=${body.type}, not payment. Skipping.`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  // Fetch real payment status from MercadoPago API
  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!accessToken) {
    console.error("MERCADOPAGO_ACCESS_TOKEN not configured");
    return new Response(JSON.stringify({ ok: true, error: "no_token" }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!mpRes.ok) {
    console.error(`MercadoPago API error ${mpRes.status} for payment ${paymentId}`);
    return new Response(JSON.stringify({ ok: true, error: "api_error" }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const mpPayment = await mpRes.json();
  const status = mpPayment.status; // approved, pending, rejected, etc.
  const mpIdStr = String(paymentId);

  console.log(`MercadoPago payment ${paymentId} status=${status}`);

  if (status !== "approved") {
    console.log(`MercadoPago status ${status} not actionable, skipping.`);
    return new Response(JSON.stringify({ ok: true, skipped: true, status }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  // Find the order by mercadopago_payment_id
  let updated = false;
  let orderId: string | null = null;

  // Try orders first
  const { data: order } = await supabase
    .from("orders")
    .select("id, is_paid, store_id")
    .eq("mercadopago_payment_id", mpIdStr)
    .maybeSingle();

  if (order) {
    orderId = order.id;
    if (order.is_paid) {
      console.log(`[mercadopago] Order ${order.id} already paid, skipping.`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase
      .from("orders")
      .update({
        is_paid: true,
        paid_at: new Date().toISOString(),
        stage: "paid",
        notes: `🔔 Webhook MercadoPago: PIX aprovado (${mpIdStr})`,
      })
      .eq("id", order.id);

    if (error) {
      console.error("Error updating order:", error);
    } else {
      console.log(`[mercadopago] Order ${order.id} marked as paid via webhook`);
      updated = true;

      // Notify payment confirmed
      let lojaName = "centro";
      if (order.store_id) {
        const { data: storeData } = await supabase
          .from("pos_stores")
          .select("name")
          .eq("id", order.store_id)
          .single();
        if (storeData?.name) lojaName = storeData.name.toLowerCase();
      }
      await notifyPaymentConfirmed({
        pedido_id: order.id,
        loja: lojaName,
        gateway: "mercadopago",
        transaction_id: mpIdStr,
        source: "mercadopago-webhook",
      });

      // Auto-create Shopify order DISABLED — user wants manual control
      // await autoCreateShopifyOrder(supabase, order.id, "orders", supabaseUrl, supabaseKey);
    }
  } else {
    // Try pos_sales
    const { data: sale } = await supabase
      .from("pos_sales")
      .select("id, status, store_id")
      .eq("mercadopago_payment_id", mpIdStr)
      .maybeSingle();

    if (sale) {
      orderId = sale.id;
      if (sale.status === "paid" || sale.status === "completed") {
        console.log(`[mercadopago] pos_sale ${sale.id} already paid, skipping.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }

      const { error } = await supabase
        .from("pos_sales")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          payment_gateway: "mercadopago",
          notes: `🔔 Webhook MercadoPago: PIX aprovado (${mpIdStr})`,
        })
        .eq("id", sale.id);

      if (error) {
        console.error("Error updating pos_sales:", error);
      } else {
        console.log(`[mercadopago] pos_sale ${sale.id} marked as paid via webhook`);
        updated = true;

        // Auto-create Tiny order
        await autoCreateTinyOrder(supabase, sale.id, supabaseUrl, supabaseKey);
      }
    } else {
      console.log(`[mercadopago] No order found for mercadopago_payment_id=${mpIdStr}`);
    }
  }

  // Log to pos_checkout_attempts
  if (orderId) {
    await supabase.from("pos_checkout_attempts").insert({
      sale_id: orderId,
      payment_method: "pix",
      status: "success",
      error_message: `Webhook MercadoPago: PIX aprovado (${mpIdStr})`,
      gateway: "mercadopago",
      transaction_id: mpIdStr,
      metadata: { source: "webhook", status, gateway: "mercadopago" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, updated, order_id: orderId }),
    { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
  );
}

async function handleVindi(req: Request, supabase: any, supabaseUrl: string, supabaseKey: string) {
  // Yapay can send JSON or form-urlencoded
  let tokenTransaction: string | null = null;
  let statusId: number | null = null;
  let rawPayload: any = {};

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await req.formData();
    tokenTransaction = formData.get("token_transaction") as string;
    statusId = Number(formData.get("status_id")) || null;
    rawPayload = Object.fromEntries(formData.entries());
  } else {
    const body = await req.text();
    try {
      rawPayload = JSON.parse(body);
      tokenTransaction = rawPayload.token_transaction || rawPayload.transaction?.token_transaction;
      statusId = Number(rawPayload.status_id || rawPayload.transaction?.status_id) || null;
    } catch {
      const params = new URLSearchParams(body);
      tokenTransaction = params.get("token_transaction");
      statusId = Number(params.get("status_id")) || null;
      rawPayload = Object.fromEntries(params.entries());
    }
  }

  console.log(`VINDI webhook: token=${tokenTransaction}, status_id=${statusId}`);
  console.log("VINDI payload:", JSON.stringify(rawPayload).substring(0, 1000));

  if (!tokenTransaction) {
    console.log("No token_transaction in payload. Skipping.");
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  // Validate against Yapay API to confirm real status
  const vindiKey = Deno.env.get("VINDI_API_KEY");
  if (vindiKey) {
    try {
      const validateRes = await fetch(
        `https://api.intermediador.yapay.com.br/api/v3/transactions/get_by_token?token_account=${vindiKey}&token_transaction=${tokenTransaction}`,
        { method: "GET" }
      );
      const validateData = await validateRes.json();
      if (validateData?.message_response?.message === "success") {
        const tx = validateData?.data_response?.transaction;
        statusId = tx?.status_id || statusId;
        console.log(`VINDI API confirmed status_id=${statusId} (${tx?.status_name})`);
      } else {
        console.log("VINDI API validation failed, using webhook status_id");
      }
    } catch (e) {
      console.error("Error validating with VINDI API:", e);
    }
  }

  if (!statusId) {
    console.log("No status_id resolved. Skipping.");
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const isPaid = VINDI_PAID_STATUSES.includes(statusId);
  const isFailed = VINDI_FAILED_STATUSES.includes(statusId);

  // Status 87 = "Em Monitoramento" (análise antifraude) — apenas logar, sem atualizar banco
  if (statusId === 87) {
    console.log(`VINDI: pedido em monitoramento (análise antifraude). Aguardando resultado. token=${tokenTransaction}`);
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "under_review" }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  if (!isPaid && !isFailed) {
    console.log(`VINDI status_id ${statusId} not actionable, skipping.`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const orderNumber = rawPayload.order_number || rawPayload.transaction?.order_number;
  let ourOrderId: string | null = orderNumber || null;
  let orderSource: string | null = null;
  let updated = false;
  let order: any = null;
  let sale: any = null;

  // Strategy 1: Search by vindi_transaction_id (gateway link field)
  {
    const { data: orderByGateway } = await supabase
      .from("orders")
      .select("id, is_paid, notes, store_id")
      .eq("vindi_transaction_id", String(tokenTransaction))
      .maybeSingle();

    if (orderByGateway) {
      order = orderByGateway;
      ourOrderId = order.id;
      orderSource = "orders";
      console.log(`[vindi] Found order ${order.id} via vindi_transaction_id`);
    } else {
      const { data: saleByGateway } = await supabase
        .from("pos_sales")
        .select("id, status, notes")
        .eq("vindi_transaction_id", String(tokenTransaction))
        .maybeSingle();

      if (saleByGateway) {
        sale = saleByGateway;
        ourOrderId = sale.id;
        orderSource = "pos_sales";
        console.log(`[vindi] Found pos_sale ${sale.id} via vindi_transaction_id`);
      }
    }
  }

  // Strategy 2 (fallback): Use order_number (our orderId) directly
  if (!orderSource && ourOrderId) {
    const { data: orderById } = await supabase
      .from("orders")
      .select("id, is_paid, notes, store_id")
      .eq("id", ourOrderId)
      .maybeSingle();

    if (orderById) {
      order = orderById;
      orderSource = "orders";
      console.log(`[vindi] Found order ${order.id} via internal id`);
    } else {
      const { data: saleById } = await supabase
        .from("pos_sales")
        .select("id, status, notes")
        .eq("id", ourOrderId)
        .maybeSingle();

      if (saleById) {
        sale = saleById;
        orderSource = "pos_sales";
        console.log(`[vindi] Found pos_sale ${sale.id} via internal id`);
      }
    }
  }

  // NOTE: Removed old ILIKE notes fallback — replaced by vindi_transaction_id search above

  if (orderSource === "orders" && order) {
    // Guard: already paid
    if (isPaid && order.is_paid === true) {
      console.log(`[vindi] Pedido ${order.id} já confirmado — ignorando.`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    updated = await updateOrder(supabase, order, order.id, isPaid, isFailed, tokenTransaction, statusId);
  } else if (orderSource === "pos_sales" && sale) {
    // Guard: already paid
    if (isPaid && (sale.status === "paid" || sale.status === "completed")) {
      console.log(`[vindi] pos_sale ${sale.id} já confirmado — ignorando.`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_paid" }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    updated = await updateSale(supabase, sale, sale.id, isPaid, isFailed, tokenTransaction, statusId, supabaseUrl, supabaseKey);
  }

  if (!orderSource) {
    console.log(`Order not found for token_transaction=${tokenTransaction}`);
  }

  // Log to pos_checkout_attempts
  const resolvedId = ourOrderId || tokenTransaction;
  if (resolvedId) {
    const logStatus = isPaid ? "success" : "error";
    const statusLabel = isPaid ? "aprovado" : `status ${statusId}`;
    const logMessage = `Webhook VINDI: ${statusLabel} (token: ${tokenTransaction})`;

    await supabase.from("pos_checkout_attempts").insert({
      sale_id: resolvedId,
      payment_method: "credit_card",
      status: logStatus,
      error_message: logMessage,
      gateway: "vindi",
      transaction_id: String(tokenTransaction),
      metadata: { source: "webhook", status_id: statusId, gateway: "vindi" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, updated, order_id: ourOrderId }),
    { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
  );
}

async function updateOrder(
  supabase: any,
  order: any,
  orderId: string,
  isPaid: boolean,
  isFailed: boolean,
  tokenTransaction: string,
  statusId: number
): Promise<boolean> {
  if (isPaid && !order.is_paid) {
    const { error } = await supabase
      .from("orders")
      .update({
        is_paid: true,
        paid_at: new Date().toISOString(),
        stage: "paid",
        notes: `${order.notes || ""}\n🔔 Webhook VINDI: aprovado (${tokenTransaction})`.trim(),
        vindi_transaction_id: String(tokenTransaction),
      })
      .eq("id", orderId);
    if (error) { console.error("Error updating orders:", error); return false; }
    console.log(`orders ${orderId} marked as paid via VINDI webhook`);
    console.log(`[vindi] Vinculado vindi_transaction_id=${tokenTransaction} ao pedido ${orderId}`);
    // Busca store_id real do pedido
    let lojaName = 'centro'; // fallback
    if (sale?.store_id) {
      const { data: storeData } = await supabase
        .from('pos_stores')
        .select('name')
        .eq('id', sale.store_id)
        .single();
      if (storeData?.name) lojaName = storeData.name.toLowerCase();
    } else if (order?.store_id) {
      const { data: storeData } = await supabase
        .from('pos_stores')
        .select('name')
        .eq('id', order.store_id)
        .single();
      if (storeData?.name) lojaName = storeData.name.toLowerCase();
    }
    await notifyPaymentConfirmed({
      pedido_id: orderId,
      loja: lojaName,
      gateway: 'vindi',
      transaction_id: String(tokenTransaction),
      source: 'vindi-webhook',
    });
    // Auto-create Shopify order DISABLED — user wants manual control
    // await autoCreateShopifyOrder(supabase, orderId, "orders", supabaseUrl, supabaseKey);
    return true;
  }
  // Reverter pagamento se já estava pago e veio status de falha (ex: antifraude reprovou)
  if (isFailed && order.is_paid) {
    const { error } = await supabase
      .from("orders")
      .update({
        is_paid: false,
        stage: "awaiting_payment",
        notes: `${order.notes || ""}\n⚠️ Pagamento revertido: reprovado pela Yapay (status ${statusId})`.trim(),
      })
      .eq("id", orderId);
    if (error) { console.error("Error reverting orders:", error); return false; }
    console.log(`orders ${orderId} payment REVERTED via VINDI webhook (status ${statusId})`);
    return true;
  }
  return false;
}

async function updateSale(
  supabase: any,
  sale: any,
  saleId: string,
  isPaid: boolean,
  isFailed: boolean,
  tokenTransaction: string,
  statusId: number,
  supabaseUrl: string,
  supabaseKey: string
): Promise<boolean> {
  if (isPaid && sale.status !== "paid" && sale.status !== "completed") {
    const { error } = await supabase
      .from("pos_sales")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_gateway: "vindi",
        notes: `🔔 Webhook VINDI: aprovado (${tokenTransaction})`,
        vindi_transaction_id: String(tokenTransaction),
      } as any)
      .eq("id", saleId);
    if (error) { console.error("Error updating pos_sales:", error); return false; }
    console.log(`pos_sales ${saleId} marked as paid via VINDI webhook`);
    console.log(`[vindi] Vinculado vindi_transaction_id=${tokenTransaction} ao pedido ${saleId}`);
    // Auto-create Tiny order
    await autoCreateTinyOrder(supabase, saleId, supabaseUrl, supabaseKey);
    return true;
  } else if (isFailed && (sale.status === "online_pending" || sale.status === "paid" || sale.status === "completed")) {
    const { error } = await supabase
      .from("pos_sales")
      .update({
        status: "payment_failed",
        payment_gateway: "vindi",
        notes: `🔔 Webhook VINDI: status ${statusId}`,
      })
      .eq("id", saleId);
    if (error) { console.error("Error updating pos_sales:", error); return false; }
    console.log(`pos_sales ${saleId} marked as payment_failed via VINDI webhook`);
    return true;
  }
  return false;
}