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
        shipping: 0,
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

    if (payData.success && (payData.data?.status === "approved" || payData.data?.status === "paid" || payData.data?.id)) {
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
        throw new Error("Este pedido já foi pago.");
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

      if (sale.status === "paid") {
        throw new Error("Esta venda já foi paga.");
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

    // Try Pagar.me first
    const pagarmeKey = Deno.env.get("PAGARME_SECRET_KEY") || "";
    let result = await chargePagarme(chargeParams, products, pagarmeKey);

    // Fallback chain: Pagar.me -> AppMax
    if (!result.success) {
      const pagarmeError = result.error;
      console.log(`Pagar.me failed: ${pagarmeError}. Trying APPMAX fallback...`);

      // Try AppMax
      const appmaxToken = Deno.env.get("APPMAX_ACCESS_TOKEN") || "";
      if (appmaxToken) {
        const appmaxResult = await chargeAppmax(chargeParams, products, appmaxToken);
        if (appmaxResult.success) {
          result = appmaxResult;
        }
      }

      // If all failed, use the most descriptive error
      if (!result.success) {
        result.error = pagarmeError || result.error || "Pagamento recusado em todos os gateways";
      }
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
