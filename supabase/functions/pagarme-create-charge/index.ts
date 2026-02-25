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

  const gatewayErrors = chargeData.charges?.[0]?.last_transaction?.gateway_response?.errors;
  const acquirerMsg = chargeData.charges?.[0]?.last_transaction?.acquirer_message;
  const errorMsg = gatewayErrors?.[0]?.message
    || acquirerMsg
    || chargeData.message
    || "Charge failed";
  console.error("Pagar.me detailed error:", { errorMsg, gatewayErrors, acquirerMsg, status: chargeData.status });
  return { success: false, gateway: "pagarme", error: errorMsg };
}

// ── APPMAX fallback ─────────────────────────────────────────────
async function chargeAppmax(
  params: ChargeRequest,
  products: Array<{ title: string; price: number; quantity: number }>,
  accessToken: string
): Promise<{ success: boolean; gateway: string; transactionId?: string; error?: string }> {
  const totalReais = params.totalAmountCents / 100;
  const phone = params.customer.phone.replace(/\D/g, "");

  // Distribute discount proportionally across product prices for APPMAX
  const productsTotal = products.reduce((s, p) => s + p.price * p.quantity, 0);
  const discountRatio = productsTotal > 0 ? totalReais / productsTotal : 1;

  const month = String(params.card.expMonth ?? "").replace(/\D/g, "").slice(-2).padStart(2, "0");
  const rawYear = String(params.card.expYear ?? "").replace(/\D/g, "");
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;

  const body: Record<string, unknown> = {
    access_token: accessToken,
    customer: {
      firstname: params.customer.name.split(" ")[0],
      lastname: params.customer.name.split(" ").slice(1).join(" ") || ".",
      email: params.customer.email,
      telephone: phone,
      cpf: params.customer.cpf.replace(/\D/g, ""),
    },
    products: products.map((p, i) => ({
      sku: `sku_${i}`,
      name: p.title.substring(0, 200),
      qty: p.quantity,
      price: Math.round(p.price * discountRatio * 100) / 100,
      digital_product: 1,
    })),
    payment: {
      method: "credit_card",
      credit_card: {
        number: params.card.number.replace(/\s/g, ""),
        name: params.card.holderName,
        month,
        year,
        cvv: params.card.cvv,
      },
      installments: params.installments,
    },
    total: totalReais,
    shipping: {
      firstname: params.customer.name.split(" ")[0],
      lastname: params.customer.name.split(" ").slice(1).join(" ") || ".",
      address_1: `${params.billingAddress.street}, ${params.billingAddress.number}`,
      city: params.billingAddress.city,
      zone: params.billingAddress.state,
      postcode: params.billingAddress.zipCode.replace(/\D/g, ""),
      country_id: "BR",
    },
    billing_address: {
      firstname: params.customer.name.split(" ")[0],
      lastname: params.customer.name.split(" ").slice(1).join(" ") || ".",
      address_1: `${params.billingAddress.street}, ${params.billingAddress.number}`,
      city: params.billingAddress.city,
      zone: params.billingAddress.state,
      postcode: params.billingAddress.zipCode.replace(/\D/g, ""),
      country_id: "BR",
    },
  };

  const res = await fetch("https://admin.appmax.com.br/api/v3/checkout/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("APPMAX response:", JSON.stringify(data).substring(0, 500));

  if (data.success || data.data?.status === "approved" || data.data?.id) {
    return {
      success: true,
      gateway: "appmax",
      transactionId: String(data.data?.id || data.id || ""),
    };
  }

  return {
    success: false,
    gateway: "appmax",
    error: data.message || data.error || "APPMAX charge failed",
  };
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

    // If Pagar.me fails, try APPMAX
    if (!result.success) {
      const pagarmeError = result.error;
      console.log(`Pagar.me failed: ${pagarmeError}. Trying APPMAX fallback...`);
      const appmaxToken = Deno.env.get("APPMAX_ACCESS_TOKEN") || "";
      if (appmaxToken) {
        const appmaxResult = await chargeAppmax(chargeParams, products, appmaxToken);
        if (appmaxResult.success) {
          result = appmaxResult;
        } else {
          // Both failed — show the more descriptive Pagar.me error
          result.error = pagarmeError || appmaxResult.error || "Pagamento recusado";
        }
      }
    }

    if (result.success) {
      if (orderSource === "orders") {
        await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_at: new Date().toISOString(),
            stage: "paid",
            notes: `${order?.notes || ""}\n💳 Pago via ${result.gateway} (${result.transactionId})`.trim(),
          })
          .eq("id", params.orderId);
      } else {
        await supabase
          .from("pos_sales")
          .update({
            status: "paid",
            payment_gateway: result.gateway,
            notes: `💳 Pago via ${result.gateway} (${result.transactionId})`,
          })
          .eq("id", params.orderId);
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
