import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CardData {
  number: string;
  holderName: string;
  expMonth: string | number;
  expYear: string | number;
  cvv: string;
}

interface BillingAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

interface ChargeRequest {
  orderId: string;
  card: CardData;
  installments: number;
  customer: {
    name: string;
    email: string;
    cpf: string;
    phone: string;
  };
  billingAddress: BillingAddress;
  totalAmountCents: number;
  shippingAmount?: number;
}

// ── Pagar.me tokenize + charge ──────────────────────────────────
async function chargePagarme(
  params: ChargeRequest,
  products: Array<{ title: string; price: number; quantity: number }>,
  secretKey: string
): Promise<{ success: boolean; gateway: string; transactionId?: string; error?: string }> {
  const auth = btoa(`${secretKey}:`);

  // 1. Tokenize card server-side
  const publicKey = Deno.env.get("PAGARME_PUBLIC_KEY") || "";
  const tokenRes = await fetch("https://api.pagar.me/core/v5/tokens?appId=" + publicKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "card",
      card: {
        number: params.card.number.replace(/\s/g, ""),
        holder_name: params.card.holderName,
        exp_month: parseInt(params.card.expMonth),
        exp_year: parseInt(params.card.expYear),
        cvv: params.card.cvv,
      },
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("Pagar.me token error:", err);
    return { success: false, gateway: "pagarme", error: `Tokenization failed: ${err}` };
  }

  const tokenData = await tokenRes.json();
  const cardToken = tokenData.id;

  // 2. Create order/charge
  // Distribute discount proportionally across items
  const itemsTotal = products.reduce((s, p) => s + Math.round(p.price * 100) * p.quantity, 0);
  const diff = itemsTotal - params.totalAmountCents;

  // Distribute discount proportionally across all items
  const items = products.map((p, i) => {
    const unitCents = Math.round(p.price * 100);
    let adjustedCents = unitCents;
    if (diff > 0 && itemsTotal > 0) {
      const proportion = (unitCents * p.quantity) / itemsTotal;
      const itemDiscount = Math.round(diff * proportion / p.quantity);
      adjustedCents = Math.max(1, unitCents - itemDiscount);
    }
    return {
      amount: adjustedCents,
      description: p.title.substring(0, 256),
      quantity: p.quantity,
      code: `item_${i}`,
    };
  });

  // Adjust last item to ensure total matches exactly
  if (diff > 0) {
    const currentTotal = items.reduce((s, it) => s + it.amount * it.quantity, 0);
    const remaining = currentTotal - params.totalAmountCents;
    if (remaining !== 0 && items.length > 0) {
      const lastItem = items[items.length - 1];
      lastItem.amount = Math.max(1, lastItem.amount - Math.ceil(remaining / lastItem.quantity));
    }
  }

  const orderBody = {
    code: params.orderId,
    items,
    customer: {
      name: params.customer.name,
      email: params.customer.email,
      type: "individual",
      document: params.customer.cpf.replace(/\D/g, ""),
      phones: {
        mobile_phone: {
          country_code: "55",
          area_code: params.customer.phone.replace(/\D/g, "").substring(0, 2),
          number: params.customer.phone.replace(/\D/g, "").substring(2),
        },
      },
    },
    payments: [
      {
        payment_method: "credit_card",
        credit_card: {
          installments: params.installments,
          card_token: cardToken,
          card: {
            billing_address: {
              line_1: `${params.billingAddress.number}, ${params.billingAddress.street}, ${params.billingAddress.neighborhood}`,
              zip_code: params.billingAddress.zipCode.replace(/\D/g, ""),
              city: params.billingAddress.city,
              state: params.billingAddress.state,
              country: params.billingAddress.country || "BR",
            },
          },
        },
      },
    ],
  };

  const chargeRes = await fetch("https://api.pagar.me/core/v5/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(orderBody),
  });

  const chargeData = await chargeRes.json();
  console.log("Pagar.me charge response HTTP status:", chargeRes.status);
  console.log("Pagar.me charge full response:", JSON.stringify(chargeData).substring(0, 2000));

  if (chargeData.status === "paid") {
    return {
      success: true,
      gateway: "pagarme",
      transactionId: chargeData.id,
    };
  }

  // Extract the REAL reason — Pagar.me anti-fraud may reject even when acquirer approves
  const chargeObj = chargeData.charges?.[0];
  const lastTx = chargeObj?.last_transaction;
  const gatewayErrors = lastTx?.gateway_response?.errors;
  const acquirerMsg = lastTx?.acquirer_message;
  const antifraudStatus = lastTx?.antifraud_response?.status;
  
  // If antifraud rejected, the acquirer_message is misleading — use a clear message
  let errorMsg: string;
  if (antifraudStatus === "reproved" || antifraudStatus === "failed" || 
      (chargeData.status === "failed" && acquirerMsg === "Transação aprovada com sucesso")) {
    errorMsg = "Transação recusada pela análise de segurança. Tente outro cartão.";
  } else {
    errorMsg = gatewayErrors?.[0]?.message
      || acquirerMsg
      || chargeData.message
      || "Cobrança recusada";
  }
  
  console.error("Pagar.me detailed error:", { errorMsg, antifraudStatus, gatewayErrors, acquirerMsg, status: chargeData.status });
  return { success: false, gateway: "pagarme", error: errorMsg };
}


// ── VINDI / Yapay Intermediador fallback ────────────────────────
async function chargeVindi(
  params: ChargeRequest,
  products: Array<{ title: string; price: number; quantity: number }>,
  tokenAccount: string
): Promise<{ success: boolean; gateway: string; transactionId?: string; error?: string }> {
  const cpf = params.customer.cpf.replace(/\D/g, "");
  const phone = params.customer.phone.replace(/\D/g, "");

  const body = {
    token_account: tokenAccount,
    customer: {
      name: params.customer.name,
      cpf,
      email: params.customer.email,
      contacts: [
        { type_contact: "M", number_contact: phone },
      ],
      addresses: [
        {
          type_address: "B",
          postal_code: params.billingAddress.zipCode.replace(/\D/g, ""),
          street: params.billingAddress.street,
          number: params.billingAddress.number,
          neighborhood: params.billingAddress.neighborhood || "N/A",
          city: params.billingAddress.city,
          state: params.billingAddress.state,
        },
      ],
    },
    transaction_product: products.map((p, i) => ({
      description: p.title.substring(0, 255),
      quantity: String(p.quantity),
      price_unit: p.price.toFixed(2),
      code: String(i + 1),
    })),
    transaction: {
      available_payment_methods: "3,4,5,16,18,20,25",
      customer_ip: "0.0.0.0",
      shipping_type: "Envio",
      shipping_price: params.shippingAmount?.toFixed(2) || "0",
      url_notification: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-webhook?gateway=vindi`,
      order_number: params.orderId,
      free: "Pedido via loja",
    },
    payment: {
      payment_method_id: "3",
      card_name: params.card.holderName.toUpperCase(),
      card_number: params.card.number.replace(/\s/g, ""),
      card_expdate_month: params.card.expMonth.toString().padStart(2, "0"),
      card_expdate_year: params.card.expYear.toString().length === 2 ? `20${params.card.expYear}` : String(params.card.expYear),
      card_cvv: params.card.cvv,
      split: String(params.installments),
      card_holder_doc: cpf,
    },
  };

  const res = await fetch("https://api.intermediador.yapay.com.br/api/v3/transactions/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("VINDI/Yapay response:", JSON.stringify(data).substring(0, 1500));

  if (data?.message_response?.message === "success") {
    const tx = data?.data_response?.transaction;
    const statusId = tx?.status_id;
    // 6=Aprovada — only accept explicitly approved
    if (statusId === 6) {
      return { success: true, gateway: "vindi", transactionId: String(tx.token_transaction) };
    }
    return { success: false, gateway: "vindi", error: tx?.status_name || "Transação não aprovada" };
  }

  const errorMsg = data?.message_response?.message || data?.error_response?.general_errors?.[0]?.message || "Erro Yapay/VINDI";
  return { success: false, gateway: "vindi", error: errorMsg };
}

// ── APPMAX fallback (3-step API: customer → order → payment) ────
async function chargeAppmax(
  params: ChargeRequest,
  products: Array<{ title: string; price: number; quantity: number }>,
  accessToken: string
): Promise<{ success: boolean; gateway: string; transactionId?: string; error?: string }> {
  const base = "https://admin.appmax.com.br/api/v3";
  const headers = { "Content-Type": "application/json" };
  const totalReais = params.totalAmountCents / 100;
  const phone = params.customer.phone.replace(/\D/g, "");
  const cpf = params.customer.cpf.replace(/\D/g, "");

  try {
    // 1. Create customer
    const custRes = await fetch(`${base}/customer`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        "access-token": accessToken,
        firstname: params.customer.name.split(" ")[0],
        lastname: params.customer.name.split(" ").slice(1).join(" ") || ".",
        email: params.customer.email,
        telephone: phone,
        cpf,
        postcode: params.billingAddress.zipCode.replace(/\D/g, ""),
        address_street: params.billingAddress.street,
        address_street_number: params.billingAddress.number,
        address_street_district: params.billingAddress.neighborhood,
        address_city: params.billingAddress.city,
        address_state: params.billingAddress.state,
        address_street_complement: "",
        ip: "0.0.0.0",
      }),
    });
    const custData = await custRes.json();
    console.log("APPMAX customer response:", JSON.stringify(custData).substring(0, 500));
    if (!custData.success || !custData.data?.id) {
      return { success: false, gateway: "appmax", error: `AppMax customer error: ${custData.text || custData.message || JSON.stringify(custData.data).substring(0, 200)}` };
    }
    const customerId = custData.data.id;

    // 2. Create order
    const productsTotal = products.reduce((s, p) => s + p.price * p.quantity, 0);
    const discountRatio = productsTotal > 0 ? totalReais / productsTotal : 1;
    const orderProducts = products.map((p, i) => ({
      sku: `sku_${i}`,
      name: p.title.substring(0, 200),
      qty: p.quantity,
      price: Math.round(p.price * discountRatio * 100) / 100,
      digital_product: 0,
    }));

    const orderRes = await fetch(`${base}/order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        "access-token": accessToken,
        customer_id: customerId,
        products: orderProducts,
        shipping: params.shippingAmount || 0,
        custom_reference: params.orderId,
      }),
    });
    const orderData = await orderRes.json();
    console.log("APPMAX order response:", JSON.stringify(orderData).substring(0, 500));
    if (!orderData.success || !orderData.data?.id) {
      return { success: false, gateway: "appmax", error: `AppMax order error: ${orderData.text || orderData.message || JSON.stringify(orderData.data).substring(0, 200)}` };
    }
    const appmaxOrderId = orderData.data.id;

    // 3. Process payment
    const month = String(params.card.expMonth ?? "").replace(/\D/g, "").slice(-2).padStart(2, "0");
    const rawYear = String(params.card.expYear ?? "").replace(/\D/g, "");
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;

    const payRes = await fetch(`${base}/payment/credit-card`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        "access-token": accessToken,
        cart: {
          order_id: appmaxOrderId,
        },
        customer: {
          customer_id: customerId,
        },
        payment: {
          CreditCard: {
            number: params.card.number.replace(/\s/g, ""),
            name: params.card.holderName,
            month,
            year,
            cvv: params.card.cvv,
            document_number: cpf,
            installments: params.installments,
          },
        },
      }),
    });
    const payData = await payRes.json();
    console.log("APPMAX payment response:", JSON.stringify(payData).substring(0, 500));

    const appmaxStatus = payData.data?.status;
    const appmaxText = payData.text || payData.message || "";
    const isPreAuth = appmaxText.toLowerCase().includes("pre autorização realizada com sucesso") || appmaxText.toLowerCase().includes("pré autorização realizada com sucesso");
    if (payData.success && (appmaxStatus === "approved" || appmaxStatus === "paid" || appmaxStatus === "pre_authorized" || isPreAuth)) {
      return {
        success: true,
        gateway: "appmax",
        transactionId: String(payData.data?.id || appmaxOrderId),
      };
    }

    return {
      success: false,
      gateway: "appmax",
      error: payData.text || payData.message || payData.data?.message || "AppMax payment declined",
    };
  } catch (e) {
    console.error("APPMAX exception:", e);
    return { success: false, gateway: "appmax", error: `AppMax exception: ${e.message}` };
  }
}

// ── Main handler ────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawParams = await req.json();

    if (!rawParams.orderId || !rawParams.card || !rawParams.customer || !rawParams.totalAmountCents) {
      throw new Error("Missing required fields: orderId, card, customer, totalAmountCents");
    }

    const paymentAttemptId = rawParams.paymentAttemptId || null;

    // ── Idempotency: check if this attemptId is already processing ──
    if (paymentAttemptId) {
      const { data: existingAttempt } = await createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      ).from("pos_checkout_attempts")
        .select("status")
        .eq("transaction_id", paymentAttemptId)
        .eq("status", "processing")
        .maybeSingle();

      if (existingAttempt) {
        return new Response(
          JSON.stringify({ success: false, error: "Pagamento já em processamento. Aguarde.", already_processing: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Build billingAddress from customer.address if not provided directly
    if (!rawParams.billingAddress && rawParams.customer?.address) {
      const addr = rawParams.customer.address;
      rawParams.billingAddress = {
        street: addr.street || "",
        number: addr.number || "S/N",
        neighborhood: addr.neighborhood || "",
        city: addr.city || "",
        state: addr.state || "",
        zipCode: (addr.cep || addr.zipCode || "").replace(/\D/g, ""),
        country: "BR",
      };
    }

    // Ensure billingAddress exists with defaults
    if (!rawParams.billingAddress) {
      rawParams.billingAddress = {
        street: "Não informado", number: "S/N", neighborhood: "Não informado",
        city: "Não informado", state: "MG", zipCode: "00000000", country: "BR",
      };
    }

    const params: ChargeRequest = rawParams;

    // Validate phone
    const phoneDigits = params.customer.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      throw new Error("Telefone inválido. Mínimo 10 dígitos.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch order — try CRM orders first, then pos_sales
    let products: Array<{ title: string; price: number; quantity: number }> = [];
    let isPaid = false;
    let orderSource: "orders" | "pos_sales" = "orders";

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", params.orderId)
      .maybeSingle();

    if (order) {
      if (order.is_paid) {
        return new Response(
          JSON.stringify({ success: true, already_paid: true, gateway: "cached" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      isPaid = order.is_paid;
      products = order.products as Array<{ title: string; price: number; quantity: number }>;
      orderSource = "orders";
    } else {
      // Fallback: try pos_sales
      const { data: sale, error: saleError } = await supabase
        .from("pos_sales")
        .select("*")
        .eq("id", params.orderId)
        .maybeSingle();

      if (saleError || !sale) {
        throw new Error(`Order not found in orders or pos_sales: ${orderError?.message || saleError?.message || "not found"}`);
      }

      if (sale.status === "paid" || sale.status === "completed") {
        return new Response(
          JSON.stringify({ success: true, already_paid: true, gateway: "cached" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch sale items
      const { data: items } = await supabase
        .from("pos_sale_items")
        .select("*")
        .eq("sale_id", sale.id);

      products = (items || []).map((it: any) => ({
        title: it.product_name + (it.variant_name ? ` - ${it.variant_name}` : ""),
        price: Number(it.unit_price),
        quantity: it.quantity,
      }));

      orderSource = "pos_sales";
      console.log(`Using pos_sales fallback for sale ${params.orderId}, ${products.length} items`);
    }

    // Use the totalAmountCents from the frontend (includes interest calculation)
    const totalCents = params.totalAmountCents;

    const chargeParams: ChargeRequest = {
      ...params,
      totalAmountCents: totalCents,
    };

    // ── Insert "processing" record for idempotency ──
    if (paymentAttemptId) {
      await supabase.from("pos_checkout_attempts").insert({
        sale_id: params.orderId,
        payment_method: "card",
        status: "processing",
        amount: totalCents / 100,
        customer_name: params.customer.name,
        customer_phone: params.customer.phone,
        customer_email: params.customer.email,
        transaction_id: paymentAttemptId,
      } as any).then(() => {});
    }

    // Try Pagar.me first
    const fallbackErrors: string[] = [];
    const pagarmeKey = Deno.env.get("PAGARME_SECRET_KEY") || "";
    let result = await chargePagarme(chargeParams, products, pagarmeKey);

    // Fallback chain: Pagar.me -> VINDI -> AppMax
    if (!result.success) {
      if (result.error) fallbackErrors.push(`Pagar.me: ${result.error}`);
      console.log(`[FALLBACK] Pagar.me NAO processou (${result.error}). Tentando VINDI/Yapay...`);

      const vindiKey = Deno.env.get("VINDI_API_KEY") || "";
      if (vindiKey) {
        const vindiResult = await chargeVindi(chargeParams, products, vindiKey);
        if (vindiResult.success) {
          console.log(`[FALLBACK] VINDI/Yapay APROVOU (tx: ${vindiResult.transactionId}). Parando fallback.`);
          result = vindiResult;
        } else {
          if (vindiResult.error) fallbackErrors.push(`VINDI: ${vindiResult.error}`);
          console.log(`[FALLBACK] VINDI/Yapay NAO processou (${vindiResult.error}).`);
        }
      } else {
        console.log("[FALLBACK] VINDI API key not configured. Skipping.");
      }
    }

    // PROTEÇÃO: só tenta AppMax se NENHUM gateway anterior capturou o pagamento
    if (!result.success) {
      console.log(`[FALLBACK] Nenhum gateway anterior aprovou. Tentando APPMAX...`);
      const appmaxToken = Deno.env.get("APPMAX_ACCESS_TOKEN") || "";
      if (appmaxToken) {
        const appmaxResult = await chargeAppmax(chargeParams, products, appmaxToken);
        if (appmaxResult.success) {
          console.log(`[FALLBACK] APPMAX APROVOU (tx: ${appmaxResult.transactionId}). Parando fallback.`);
          result = appmaxResult;
        } else if (appmaxResult.error) {
          fallbackErrors.push(`APPMAX: ${appmaxResult.error}`);
          console.log(`[FALLBACK] APPMAX NAO processou (${appmaxResult.error}).`);
        }
      } else {
        console.log("[FALLBACK] APPMAX access token not configured. Skipping.");
      }
    }

    if (!result.success) {
      result.error = fallbackErrors[0] || result.error || "Pagamento recusado em todos os gateways";
    }

    // ── Update processing record with final status ──
    if (paymentAttemptId) {
      await supabase.from("pos_checkout_attempts")
        .update({ status: result.success ? "success" : "failed", gateway: result.gateway || null, error_message: result.error || null } as any)
        .eq("transaction_id", paymentAttemptId)
        .eq("status", "processing")
        .then(() => {});
    }

    if (result.success) {
      if (orderSource === "orders") {
        const { error: updErr } = await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_at: new Date().toISOString(),
            stage: "paid",
            notes: `${order?.notes || ""}\n💳 Pago via ${result.gateway} (${result.transactionId})`.trim(),
          })
          .eq("id", params.orderId);
        if (updErr) console.error("Failed to update orders:", updErr);
      } else {
        const { error: updErr } = await supabase
          .from("pos_sales")
          .update({
            status: "paid",
            payment_gateway: result.gateway,
            notes: `💳 Pago via ${result.gateway} (${result.transactionId})`,
          })
          .eq("id", params.orderId);
        if (updErr) console.error("Failed to update pos_sales:", updErr);
        else console.log(`pos_sales ${params.orderId} updated to paid`);
      }
      console.log(`${orderSource} ${params.orderId} paid via ${result.gateway}`);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in pagarme-create-charge:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
