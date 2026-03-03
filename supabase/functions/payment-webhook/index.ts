import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// VINDI/Yapay status mapping
const VINDI_PAID_STATUSES = [6, 87]; // 6=Aprovada, 87=Em Monitoramento
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

    const tinyPayload = {
      store_id: sale.store_id,
      sale_id: saleId,
      customer: tinyCustomer,
      items: tinyItems,
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
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const url = new URL(req.url);
  const gateway = url.searchParams.get("gateway") || "unknown";

  try {
    console.log(`payment-webhook received for gateway: ${gateway}`);

    if (gateway === "vindi") {
      return await handleVindi(req, supabase, supabaseUrl, supabaseKey);
    }
    // For pagarme/appmax, just acknowledge — they have dedicated webhooks
    console.log(`Gateway "${gateway}" has its own webhook. Acknowledging.`);
    return new Response(JSON.stringify({ ok: true, routed: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("payment-webhook error:", error);
    // Always return 200 to avoid retries from gateway
    return new Response(
      JSON.stringify({ ok: true, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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
      // Try form-urlencoded fallback
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isPaid = VINDI_PAID_STATUSES.includes(statusId);
  const isFailed = VINDI_FAILED_STATUSES.includes(statusId);

  if (!isPaid && !isFailed) {
    console.log(`VINDI status_id ${statusId} not actionable, skipping.`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Find order by token_transaction in notes (stored as "💳 Pago via vindi (TOKEN)")
  // or by order_number in the VINDI payload
  const orderNumber = rawPayload.order_number || rawPayload.transaction?.order_number;
  let ourOrderId: string | null = orderNumber || null;
  let orderSource: string | null = null;
  let updated = false;

  // Strategy 1: Use order_number (our orderId) directly
  if (ourOrderId) {
    const { data: order } = await supabase
      .from("orders")
      .select("id, is_paid, notes")
      .eq("id", ourOrderId)
      .maybeSingle();

    if (order) {
      orderSource = "orders";
      updated = await updateOrder(supabase, order, ourOrderId, isPaid, isFailed, tokenTransaction, statusId);
    } else {
      const { data: sale } = await supabase
        .from("pos_sales")
        .select("id, status")
        .eq("id", ourOrderId)
        .maybeSingle();

      if (sale) {
        orderSource = "pos_sales";
        updated = await updateSale(supabase, sale, ourOrderId, isPaid, isFailed, tokenTransaction, statusId, supabaseUrl, supabaseKey);
      }
    }
  }

  // Strategy 2: Search by token_transaction in notes
  if (!orderSource) {
    const searchTerm = `vindi (${tokenTransaction})`;

    const { data: orders } = await supabase
      .from("orders")
      .select("id, is_paid, notes")
      .ilike("notes", `%${searchTerm}%`)
      .limit(1);

    if (orders?.length) {
      const order = orders[0];
      ourOrderId = order.id;
      orderSource = "orders";
      updated = await updateOrder(supabase, order, ourOrderId!, isPaid, isFailed, tokenTransaction, statusId);
    } else {
      const { data: sales } = await supabase
        .from("pos_sales")
        .select("id, status, notes")
        .ilike("notes", `%${searchTerm}%`)
        .limit(1);

      if (sales?.length) {
        const sale = sales[0];
        ourOrderId = sale.id;
        orderSource = "pos_sales";
        updated = await updateSale(supabase, sale, ourOrderId!, isPaid, isFailed, tokenTransaction, statusId, supabaseUrl, supabaseKey);
      }
    }
  }

  if (!orderSource) {
    console.log(`Order not found for token_transaction=${tokenTransaction}`);
  }

  // Log to pos_checkout_attempts
  if (ourOrderId) {
    const logStatus = isPaid ? "success" : "error";
    const statusLabel = isPaid ? "aprovado" : `status ${statusId}`;
    const logMessage = `Webhook VINDI: ${statusLabel} (token: ${tokenTransaction})`;

    await supabase.from("pos_checkout_attempts").insert({
      sale_id: ourOrderId,
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
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      })
      .eq("id", orderId);
    if (error) { console.error("Error updating orders:", error); return false; }
    console.log(`orders ${orderId} marked as paid via VINDI webhook`);
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
      })
      .eq("id", saleId);
    if (error) { console.error("Error updating pos_sales:", error); return false; }
    console.log(`pos_sales ${saleId} marked as paid via VINDI webhook`);
    // Auto-create Tiny order
    await autoCreateTinyOrder(supabase, saleId, supabaseUrl, supabaseKey);
    return true;
  } else if (isFailed && sale.status === "online_pending") {
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
