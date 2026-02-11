import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CardData {
  number: string;
  holderName: string;
  expMonth: string;
  expYear: string;
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

  const items = products.map((p, i) => {
    const unitCents = Math.round(p.price * 100);
    let adjustedCents = unitCents;
    // apply discount proportionally to first item for simplicity
    if (i === 0 && diff > 0) {
      adjustedCents = Math.max(1, unitCents - Math.ceil(diff / p.quantity));
    }
    return {
      amount: adjustedCents,
      description: p.title.substring(0, 256),
      quantity: p.quantity,
      code: `item_${i}`,
    };
  });

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
  console.log("Pagar.me charge response status:", chargeData.status);

  if (chargeData.status === "paid" || chargeData.status === "pending") {
    return {
      success: true,
      gateway: "pagarme",
      transactionId: chargeData.id,
    };
  }

  const errorMsg = chargeData.charges?.[0]?.last_transaction?.gateway_response?.errors?.[0]?.message
    || chargeData.message
    || "Charge failed";
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
      price: p.price,
      digital_product: 1,
    })),
    payment: {
      method: "credit_card",
      credit_card: {
        number: params.card.number.replace(/\s/g, ""),
        name: params.card.holderName,
        month: params.card.expMonth.padStart(2, "0"),
        year: params.card.expYear.length === 2 ? `20${params.card.expYear}` : params.card.expYear,
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
    const params: ChargeRequest = await req.json();

    if (!params.orderId || !params.card || !params.customer) {
      throw new Error("Missing required fields: orderId, card, customer");
    }

    // Validate phone
    const phoneDigits = params.customer.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      throw new Error("Telefone inválido. Mínimo 10 dígitos.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch order + products
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", params.orderId)
      .maybeSingle();

    if (orderError || !order) {
      throw new Error(`Order not found: ${orderError?.message || "not found"}`);
    }

    if (order.is_paid) {
      throw new Error("Este pedido já foi pago.");
    }

    const products = order.products as Array<{ title: string; price: number; quantity: number }>;

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
      console.log(`Pagar.me failed: ${result.error}. Trying APPMAX fallback...`);
      const appmaxToken = Deno.env.get("APPMAX_ACCESS_TOKEN") || "";
      if (appmaxToken) {
        result = await chargeAppmax(chargeParams, products, appmaxToken);
      }
    }

    if (result.success) {
      // Mark order as paid
      await supabase
        .from("orders")
        .update({
          is_paid: true,
          paid_at: new Date().toISOString(),
          stage: "paid",
          notes: `${order.notes || ""}\n💳 Pago via ${result.gateway} (${result.transactionId})`.trim(),
        })
        .eq("id", params.orderId);

      console.log(`Order ${params.orderId} paid via ${result.gateway}`);
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
