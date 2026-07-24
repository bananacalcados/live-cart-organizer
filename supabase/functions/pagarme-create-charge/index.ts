import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkOrderStock } from "../_shared/check-order-stock.ts";
import { getActiveMpAccount } from "../_shared/mp-account.ts";
import { normalizeGatewayPaymentLabel, syncOrderPaymentToPosSale } from "../_shared/payment-method-sync.ts";

function maskCard(card: any) {
  if (!card) return card;
  return {
    ...card,
    number: card.number ? `****${String(card.number).replace(/\s/g, "").slice(-4)}` : undefined,
    cvv: card.cvv ? "***" : undefined,
  };
}

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function isAllowedOrigin(origin: string) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:") return false;
    return hostname.endsWith(".lovable.app") || hostname.endsWith(".lovableproject.com");
  } catch {
    return false;
  }
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

type DeclineCategory = "risk" | "card_data" | "minimum_amount" | "issuer" | "unknown";

interface ChargeResult {
  success: boolean;
  gateway: string;
  transactionId?: string;
  error?: string;
  pending?: boolean;
  mpAccountId?: string | null;
  isSandbox?: boolean;
  stopCascade?: boolean;
  declineCategory?: DeclineCategory;
}

function normalizeFailureCode(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("forwarded") || "";
  const forwardedFor = forwarded.match(/for="?([^;,"]+)"?/i)?.[1] || null;
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    req.headers.get("x-real-ip"),
    forwardedFor,
  ];

  for (const candidate of candidates) {
    const ip = String(candidate || "").trim().replace(/^\[|\]$/g, "");
    if (!ip || ip === "0.0.0.0" || ip === "::1" || ip === "127.0.0.1" || ip.toLowerCase() === "unknown") continue;
    return ip;
  }

  return null;
}

function humanizeMpError(codeOrMessage: string) {
  const code = normalizeFailureCode(codeOrMessage);
  switch (code) {
    case "cc_rejected_high_risk":
      return "Transação recusada pela análise de risco do cartão no Mercado Pago.";
    case "cc_rejected_bad_filled_security_code":
      return "Código de segurança inválido.";
    case "cc_rejected_bad_filled_date":
      return "Data de validade inválida.";
    case "cc_rejected_bad_filled_card_number":
      return "Número do cartão inválido.";
    case "cc_rejected_insufficient_amount":
      return "Cartão sem limite disponível.";
    default:
      return codeOrMessage || "Cobrança recusada";
  }
}

function categorizeDecline(codeOrMessage: string): { stopCascade: boolean; declineCategory: DeclineCategory } {
  const normalized = normalizeFailureCode(codeOrMessage);

  if (!normalized) {
    return { stopCascade: false, declineCategory: "unknown" };
  }

  // Dados do cartão genuinamente inválidos → não adianta tentar outro gateway (PARA)
  if (
    normalized.includes("bad_filled") ||
    normalized.includes("código de segurança inválido") || normalized.includes("codigo de seguranca invalido") ||
    normalized.includes("cartão inválido") || normalized.includes("cartao invalido") ||
    normalized.includes("número do cartão") || normalized.includes("numero do cartao") ||
    normalized.includes("data de validade") || normalized.includes("invalid_installments")
  ) {
    return { stopCascade: true, declineCategory: "card_data" };
  }

  // Valor mínimo — erro determinístico (PARA)
  if (normalized.includes("valor inferior a r$ 5,00") || normalized.includes("parcela 1 possui o valor inferior a r$ 5,00")) {
    return { stopCascade: true, declineCategory: "minimum_amount" };
  }

  // Recusa por RISCO/ANTIFRAUDE → a cascata DEVE CONTINUAR.
  // O antifraude do AppMax é mais flexível; muitos cartões (ex.: virtuais legítimos)
  // são barrados no MP/Pagar.me mas aprovados no próximo gateway.
  if (
    normalized.startsWith("cc_rejected_") ||
    normalized.includes("análise de segurança") || normalized.includes("analise de seguranca") ||
    normalized.includes("high_risk") || normalized.includes("antifraud") || normalized.includes("recusado_por_risco")
  ) {
    return { stopCascade: false, declineCategory: "risk" };
  }

  return { stopCascade: false, declineCategory: "unknown" };
}

async function notifyPaymentConfirmedLocal(orderId: string, gateway: string, transactionId: string) {
  try {
    const webhookUrl = Deno.env.get("AGENTE2_PAGAMENTO_CONFIRMADO") || "https://api.bananacalcados.com.br/webhook/pagamento-confirmado";
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pedido_id: orderId,
        loja: "centro",
        gateway,
        transaction_id: transactionId,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`payment-confirmado ${response.status}: ${errorBody}`);
    }

    console.log(`[payment-confirmado] Agente2 notified for order ${orderId} via ${gateway}`);
  } catch (error) {
    console.error("[payment-confirmado] Failed to notify Agente2:", error);
  }

  // Also trigger Livete payment confirmation (sends WhatsApp confirmation to customer)
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseKey) {
      fetch(`${supabaseUrl}/functions/v1/livete-payment-confirmation`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      }).catch(err => console.error("[payment-confirmado] livete confirmation error:", err));
    }
  } catch (err) {
    console.error("[payment-confirmado] livete trigger error:", err);
  }
}

// REGRA DE NEGÓCIO (NÃO REATIVAR SEM AUTORIZAÇÃO DO USUÁRIO):
// Criação automática de pedidos na Shopify está DESABILITADA em TODAS as situações.
async function autoCreateShopifyOrder(orderId: string, source: "orders" | "pos_sales", _supabaseUrl: string, _supabaseKey: string) {
  console.log(`[AUTO-SHOPIFY] DISABLED — skip ${source} ${orderId}`);
  return;
}

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
  // ── Mercado Pago (tokenização no frontend via MercadoPago.JS V2) ──
  // Quando o SDK do MP carrega no checkout, ele gera um token de cartão + device_id
  // e os envia aqui. Se o SDK falhar, esses campos ficam vazios e o MP é pulado
  // (degradação graciosa → cai direto no Pagar.me com o cartão cru).
  mpCardToken?: string;
  mpDeviceId?: string;
  mpPaymentMethodId?: string;
  mpIssuerId?: string;
  paymentAttemptId?: string;
}

// ── Mercado Pago charge (gateway #1) ─────────────────────────────
// Usa token gerado no frontend (MercadoPago.JS V2). binary_mode:true garante
// status definitivo (approved/rejected) sem ficar "in_process" pendente.
async function chargeMercadoPago(
  params: ChargeRequest,
  products: Array<{ title: string; price: number; quantity: number }>,
  supabase: any
): Promise<ChargeResult> {
  if (!params.mpCardToken || !params.mpPaymentMethodId) {
    return { success: false, gateway: "mercadopago", error: "Token MP ausente (SDK não carregou) — pulando" };
  }

  const mpAccount = await getActiveMpAccount(supabase);
  if (!mpAccount) {
    return { success: false, gateway: "mercadopago", error: "Nenhuma conta Mercado Pago ativa" };
  }

  const cpf = params.customer.cpf.replace(/\D/g, "");
  const email = mpAccount.is_sandbox
    ? "test@testuser.com"
    : (params.customer.email || `${cpf}@cliente.bananacalcados.com.br`);
  const amount = Math.round(params.totalAmountCents) / 100;
  const nameParts = (params.customer.name || "Cliente").trim().split(/\s+/);
  const firstName = nameParts[0] || "Cliente";
  const lastName = nameParts.slice(1).join(" ") || ".";

  const payer = {
    email,
    first_name: firstName,
    last_name: lastName,
    ...(cpf.length === 11 ? { identification: { type: "CPF", number: cpf } } : {}),
  };

  const body: Record<string, unknown> = {
    transaction_amount: Number(amount.toFixed(2)),
    token: params.mpCardToken,
    description: `Pedido #${String(params.orderId).substring(0, 8)}`,
    installments: params.installments || 1,
    payment_method_id: params.mpPaymentMethodId,
    payer,
  };
  if (!mpAccount.is_sandbox) {
    body.binary_mode = true;
    body.external_reference = String(params.orderId);
    body.notification_url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-webhook?gateway=mercadopago`;
    body.statement_descriptor = "BANANACALCAD";
    body.additional_info = {
      items: products.map((p, i) => ({
        id: `item_${i}`,
        title: String(p.title || "Produto").substring(0, 256),
        description: String(p.title || "Produto").substring(0, 256),
        quantity: Number(p.quantity) || 1,
        unit_price: Math.round(Number(p.price) * 100) / 100,
      })),
      payer: { first_name: firstName, last_name: lastName },
    };
    if (params.mpIssuerId) body.issuer_id = params.mpIssuerId;
  }

  try {
    const idemKey = `card-${params.orderId}-${params.paymentAttemptId || crypto.randomUUID()}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mpAccount.access_token}`,
      "X-Idempotency-Key": idemKey,
    };
    // device_id (fingerprint do navegador) — pontua na qualidade e reduz fraude
    if (!mpAccount.is_sandbox && params.mpDeviceId) headers["X-meli-session-id"] = params.mpDeviceId;

    console.log("[mercadopago] payload", JSON.stringify({
      isSandbox: mpAccount.is_sandbox,
      payment_method_id: body.payment_method_id,
      installments: body.installments,
      transaction_amount: body.transaction_amount,
      hasIssuer: Boolean((body as any).issuer_id),
      hasAdditionalInfo: Boolean((body as any).additional_info),
      hasNotificationUrl: Boolean((body as any).notification_url),
      hasDeviceHeader: Boolean(headers["X-meli-session-id"]),
      payer,
    }));

    const res = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    const requestId = res.headers.get("x-request-id") || res.headers.get("X-Request-Id");
    let data: any = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }
    console.log(`[mercadopago] charge HTTP ${res.status} status=${data.status} detail=${data.status_detail || data.error || data.message} id=${data.id} request_id=${requestId || "n/a"}`);

    if (data.status === "approved") {
      return { success: true, gateway: "mercadopago", transactionId: String(data.id), mpAccountId: mpAccount.account_id, isSandbox: mpAccount.is_sandbox };
    }
    if (data.status === "in_process" || data.status === "pending") {
      return { success: false, pending: true, gateway: "mercadopago", transactionId: String(data.id), mpAccountId: mpAccount.account_id, error: "Pagamento em análise", isSandbox: mpAccount.is_sandbox };
    }
    const rawErrMsg = data.status_detail || data.message || data.error || data.cause?.[0]?.description || data.raw || "Cobrança recusada";
    const errMsg = humanizeMpError(rawErrMsg);
    const failureMeta = categorizeDecline(rawErrMsg);
    if (mpAccount.is_sandbox && rawErrMsg === "internal_error") {
      return {
        success: false,
        gateway: "mercadopago",
        error: `Mercado Pago sandbox retornou erro interno no teste${requestId ? ` (request_id ${requestId})` : ""}. Nenhum gateway real foi tentado.`,
        isSandbox: true,
        stopCascade: true,
        declineCategory: "risk",
      };
    }
    return { success: false, gateway: "mercadopago", error: errMsg, isSandbox: mpAccount.is_sandbox, ...failureMeta };
  } catch (e) {
    console.error("[mercadopago] exception:", e);
    return { success: false, gateway: "mercadopago", error: `MP exception: ${(e as Error).message}`, isSandbox: mpAccount.is_sandbox };
  }
}

// ── Pagar.me tokenize + charge ──────────────────────────────────
async function chargePagarme(
  params: ChargeRequest,
  products: Array<{ title: string; price: number; quantity: number }>,
  secretKey: string,
  clientIp: string | null
): Promise<ChargeResult> {
  const safeParams = { ...params, card: maskCard(params.card) };
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
  // Distribute discount proportionally across items (only when items > total, i.e. discount)
  const itemsTotal = products.reduce((s, p) => s + Math.round(p.price * 100) * p.quantity, 0);
  const diff = itemsTotal - params.totalAmountCents;

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

  // Adjust last item to ensure total matches exactly when discount applied
  if (diff > 0) {
    const currentTotal = items.reduce((s, it) => s + it.amount * it.quantity, 0);
    const remaining = currentTotal - params.totalAmountCents;
    if (remaining !== 0 && items.length > 0) {
      const lastItem = items[items.length - 1];
      lastItem.amount = Math.max(1, lastItem.amount - Math.ceil(remaining / lastItem.quantity));
    }
  }

  // When total > items (shipping), add shipping as a separate line item
  // so Pagar.me charges the full amount including freight
  if (diff < 0) {
    const shippingCents = Math.abs(diff);
    items.push({
      amount: shippingCents,
      description: "Frete",
      quantity: 1,
      code: "shipping",
    });
  }

  const orderBody = {
    code: params.orderId,
    items,
    customer: {
      name: params.customer.name,
      email: params.customer.email || `${params.customer.cpf.replace(/\D/g, "")}@cliente.bananacalcados.com.br`,
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
          operation_type: "auth_and_capture",
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
        metadata: clientIp ? { customer_ip: clientIp } : undefined,
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
    return { success: true, gateway: "pagarme", transactionId: chargeData.id };
  }

  if (chargeData.status === "pending") {
    return { success: false, pending: true, gateway: "pagarme", transactionId: chargeData.id, error: "Pagamento em análise" };
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
  const rawErrorReason = antifraudStatus || gatewayErrors?.[0]?.message || acquirerMsg || chargeData.message || errorMsg;
  const failureMeta = categorizeDecline(rawErrorReason);

  console.error("Pagar.me detailed error:", { errorMsg, antifraudStatus, gatewayErrors, acquirerMsg, status: chargeData.status });
  return { success: false, gateway: "pagarme", error: errorMsg, ...failureMeta };
}


// ── VINDI / Yapay Intermediador fallback ────────────────────────
async function chargeVindi(
  params: ChargeRequest,
  products: Array<{ title: string; price: number; quantity: number }>,
  tokenAccount: string,
  clientIp: string | null
): Promise<ChargeResult> {
  const safeParams = { ...params, card: maskCard(params.card) };
  const cpf = params.customer.cpf.replace(/\D/g, "");
  const phone = params.customer.phone.replace(/\D/g, "");

  const body = {
    token_account: tokenAccount,
    customer: {
      name: params.customer.name,
      cpf,
      email: params.customer.email || `${cpf}@cliente.bananacalcados.com.br`,
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
      customer_ip: clientIp || undefined,
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
  console.log("VINDI/Yapay HTTP status:", res.status);
  console.log("VINDI/Yapay full response:", JSON.stringify(data).substring(0, 2000));

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
  return { success: false, gateway: "vindi", error: errorMsg, ...categorizeDecline(errorMsg) };
}

// ── APPMAX fallback (3-step API: customer → order → payment) ────
async function chargeAppmax(
  params: ChargeRequest,
  products: Array<{ title: string; price: number; quantity: number }>,
  accessToken: string,
  clientIp: string | null
): Promise<ChargeResult> {
  const safeParams = { ...params, card: maskCard(params.card) };
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
        email: params.customer.email || `${cpf}@cliente.bananacalcados.com.br`,
        telephone: phone,
        cpf,
        postcode: params.billingAddress.zipCode.replace(/\D/g, ""),
        address_street: params.billingAddress.street,
        address_street_number: params.billingAddress.number,
        address_street_district: params.billingAddress.neighborhood,
        address_city: params.billingAddress.city,
        address_state: params.billingAddress.state,
        address_street_complement: "",
        ip: clientIp || undefined,
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
        shipping: 0, // shipping is already included in adjusted product prices via discountRatio
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
    const appmaxTxId = String(payData.data?.id || appmaxOrderId);

    if (appmaxStatus === "approved" || appmaxStatus === "paid") {
      return { success: true, gateway: "appmax", transactionId: appmaxTxId };
    }

    // Pre-authorization = ainda não capturou. Aguarda webhook final da AppMax.
    if (payData.success && (appmaxStatus === "pre_authorized" || isPreAuth) && appmaxStatus !== "recusado_por_risco") {
      return {
        success: false,
        pending: true,
        gateway: "appmax",
        transactionId: appmaxTxId,
        error: "Pagamento em análise pela operadora.",
        stopCascade: true,
        declineCategory: "risk",
      };
    }

      const errorMsg = payData.text || payData.message || payData.data?.message || "AppMax payment declined";
      return {
        success: false,
        gateway: "appmax",
        error: errorMsg,
        ...categorizeDecline(errorMsg),
      };
  } catch (e) {
    console.error("APPMAX exception:", e);
    return { success: false, gateway: "appmax", error: `AppMax exception: ${e.message}` };
  }
}

// ── Main handler ────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const rawParams = await req.json();

    if (!rawParams.orderId || !rawParams.card || !rawParams.customer || !rawParams.totalAmountCents) {
      throw new Error("Missing required fields: orderId, card, customer, totalAmountCents");
    }

    const paymentAttemptId = rawParams.paymentAttemptId || null;
    const clientIp = getClientIp(req);
    console.log(`[PAYMENT] client_ip=${clientIp || "unavailable"}`);

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
          { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
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
          { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
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
          { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
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

    // ℹ️ Checagem de estoque apenas informativa (não bloqueia o pagamento).
    // A validação de estoque acontece no momento da criação do pedido (módulo Eventos).
    if (orderSource === "orders" && order) {
      try {
        const stockCheck = await checkOrderStock(supabase, order.products as any);
        if (!stockCheck.ok) {
          console.warn(`[pagarme] Aviso: estoque insuficiente no banco para order ${params.orderId} (não bloqueado):`, stockCheck.issues);
        }
      } catch (stockErr) {
        console.error("[pagarme] Erro na checagem de estoque (ignorado):", stockErr);
      }
    }

    // Use the totalAmountCents from the frontend (includes interest calculation)
    const totalCents = params.totalAmountCents;

    // Resolve shippingAmount server-side if not provided
    if (!params.shippingAmount && orderSource === "orders" && order) {
      params.shippingAmount = order.free_shipping ? 0 : Number(order.shipping_cost || 0);
    } else if (!params.shippingAmount && orderSource === "pos_sales") {
      const { data: saleShip } = await supabase.from("pos_sales").select("payment_details").eq("id", params.orderId).maybeSingle();
      const pd = saleShip?.payment_details as Record<string, unknown> | null;
      if (pd && typeof pd === "object" && pd.shipping_amount) {
        params.shippingAmount = Number(pd.shipping_amount) || 0;
      }
    }

    const chargeParams: ChargeRequest = {
      ...params,
      totalAmountCents: totalCents,
    };

    // ── Resolve store_id from pos_sales if applicable ──
    let resolvedStoreId: string | null = null;
    if (orderSource === "pos_sales") {
      const { data: saleForStore } = await supabase
        .from("pos_sales")
        .select("store_id")
        .eq("id", params.orderId)
        .maybeSingle();
      resolvedStoreId = saleForStore?.store_id || null;
    }

    // ── PERSIST CUSTOMER DATA BEFORE CHARGE ──
    if (orderSource === "pos_sales" && params.customer) {
      try {
        const custPhone = params.customer.phone?.replace(/\D/g, "") || "";
        const custCpf = params.customer.cpf?.replace(/\D/g, "") || "";
        const custEmail = params.customer.email || "";
        const custName = params.customer.name || "";
        const addr = params.billingAddress || {} as any;

        // Build payment_details JSON with all customer data
        const paymentDetails = {
          customer_name: custName,
          customer_cpf: custCpf,
          customer_email: custEmail,
          customer_phone: custPhone,
          address_street: addr.street || "",
          address_number: addr.number || "",
          address_neighborhood: addr.neighborhood || "",
          address_city: addr.city || "",
          address_state: addr.state || "",
          address_cep: (addr.zipCode || "").replace(/\D/g, ""),
          payment_method: "credit_card",
          installments: params.installments || 1,
        };

        // Update pos_sales with customer info BEFORE charging
        await supabase
          .from("pos_sales")
          .update({
            customer_name: custName,
            customer_phone: custPhone,
            payment_details: paymentDetails,
          } as any)
          .eq("id", params.orderId);

        // Upsert pos_customers
        if (custPhone || custCpf) {
          const customerData: any = {
            name: custName,
            email: custEmail || null,
            cpf: custCpf || null,
            whatsapp: custPhone || null,
            address: addr.street || null,
            address_number: addr.number || null,
            neighborhood: addr.neighborhood || null,
            city: addr.city || null,
            state: addr.state || null,
            cep: (addr.zipCode || "").replace(/\D/g, "") || null,
          };
          if (resolvedStoreId) customerData.store_id = resolvedStoreId;

          // Try upsert by phone
          if (custPhone.length >= 10) {
            const { data: existingCust } = await supabase
              .from("pos_customers")
              .select("id")
              .eq("whatsapp", custPhone)
              .maybeSingle();

            if (existingCust) {
              await supabase.from("pos_customers").update(customerData).eq("id", existingCust.id);
              // Link customer to sale
              await supabase.from("pos_sales").update({ customer_id: existingCust.id } as any).eq("id", params.orderId);
            } else {
              const { data: newCust } = await supabase.from("pos_customers").insert(customerData).select("id").maybeSingle();
              if (newCust) {
                await supabase.from("pos_sales").update({ customer_id: newCust.id } as any).eq("id", params.orderId);
              }
            }
          }
        }

        console.log(`Customer data persisted for sale ${params.orderId} BEFORE charge`);
      } catch (custErr) {
        console.error("Error persisting customer data (non-blocking):", custErr);
      }
    }

    // ── PERSIST CUSTOMER DATA (orders) BEFORE CHARGE ──
    if (orderSource === "orders" && params.customer) {
      try {
        await supabase
          .from("orders")
          .update({
            customer_name: params.customer.name,
            customer_phone: params.customer.phone,
            customer_email: params.customer.email,
          })
          .eq("id", params.orderId);
        console.log(`Customer data persisted for order ${params.orderId} BEFORE charge`);
      } catch (custErr) {
        console.error("Error persisting customer data to orders (non-blocking):", custErr);
      }
    }

    // ── Insert "processing" record for idempotency ──
    if (paymentAttemptId) {
      await supabase.from("pos_checkout_attempts").insert({
        sale_id: params.orderId,
        store_id: resolvedStoreId,
        payment_method: "card",
        status: "processing",
        amount: totalCents / 100,
        customer_name: params.customer.name,
        customer_phone: params.customer.phone,
        customer_email: params.customer.email,
        transaction_id: paymentAttemptId,
      } as any).then(() => {});
    }

    // ── DUPLICATE CHARGE GUARD ──
    // Bloqueia nova cobrança quando o pedido já tem:
    //   (a) cobrança APROVADA (status="success"), ou
    //   (b) PRÉ-AUTORIZAÇÃO em análise (status="pending") — captura assíncrona em curso.
    // A pré-autorização (ex.: AppMax/Vindi) segura o valor no cartão e a aprovação
    // final vem por webhook. Sem este guard, o cliente vê "não aprovado", tenta de
    // novo e acaba cobrado em dobro. Por isso a janela de 20min para o "pending".
    const PENDING_BLOCK_WINDOW_MS = 20 * 60 * 1000;
    const { data: recentBlocking } = await supabase
      .from("pos_checkout_attempts")
      .select("id, gateway, transaction_id, status, created_at")
      .eq("sale_id", params.orderId)
      .in("status", ["success", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentBlocking?.status === "success") {
      console.log(`[DUPLICATE-GUARD] Order ${params.orderId} already has a successful charge (gateway=${recentBlocking.gateway}, tx=${recentBlocking.transaction_id}). Blocking duplicate.`);
      // Also ensure the order is marked as paid (in case webhook hasn't arrived yet)
      const paymentLabel = normalizeGatewayPaymentLabel({
        gateway: recentBlocking.gateway,
        paymentMethodId: recentBlocking.gateway === "mercadopago" ? "pix" : "credit_card",
        installments: params.installments,
      }) || (recentBlocking.gateway === "mercadopago" ? "PIX" : (params.installments > 1 ? `Cartão de Crédito ${params.installments}x` : "Cartão de Crédito"));
      const paidAt = new Date().toISOString();
      if (orderSource === "orders") {
        await supabase.from("orders").update({ is_paid: true, payment_confirmed_source: 'gateway_webhook', payment_confirmed_source: 'gateway_webhook', paid_at: paidAt, stage: "paid", payment_method_label: paymentLabel, installments: params.installments }).eq("id", params.orderId).eq("is_paid", false);
        await syncOrderPaymentToPosSale(supabase, {
          orderId: params.orderId,
          paymentMethodLabel: paymentLabel,
          installments: params.installments,
          paymentGateway: recentBlocking.gateway,
          paidAt,
        });
      } else {
        await supabase.from("pos_sales").update({ status: "paid", paid_at: paidAt, payment_gateway: recentBlocking.gateway || null, payment_method: paymentLabel } as any).eq("id", params.orderId).not("status", "in", '("paid","completed")');
      }
      return new Response(
        JSON.stringify({ success: true, already_paid: true, gateway: recentBlocking.gateway || "cached" }),
        { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    if (recentBlocking?.status === "pending") {
      const pendingAgeMs = Date.now() - new Date(recentBlocking.created_at).getTime();
      if (pendingAgeMs < PENDING_BLOCK_WINDOW_MS) {
        console.log(`[DUPLICATE-GUARD] Order ${params.orderId} tem pré-autorização em análise (gateway=${recentBlocking.gateway}, tx=${recentBlocking.transaction_id}, há ${Math.round(pendingAgeMs / 1000)}s). Bloqueando nova cobrança para evitar duplicidade.`);
        return new Response(
          JSON.stringify({
            success: false,
            pending: true,
            already_processing: true,
            gateway: recentBlocking.gateway || null,
            error: "Já existe um pagamento em análise para este pedido. Aguarde a confirmação — NÃO tente novamente para evitar cobrança duplicada.",
          }),
          { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
        );
      }
      console.log(`[DUPLICATE-GUARD] Pré-autorização pendente do pedido ${params.orderId} expirou (${Math.round(pendingAgeMs / 1000)}s > janela). Permitindo nova tentativa.`);
    }

    // ── Gateway #1: Mercado Pago (só quando o frontend enviou token via SDK) ──
    const fallbackErrors: string[] = [];
    let mpAccountIdForOrder: string | null = null;
    let result: ChargeResult;

    if (chargeParams.mpCardToken) {
      console.log("[CASCATA] Token MP presente — tentando Mercado Pago como gateway #1...");
      result = await chargeMercadoPago(chargeParams, products, supabase);
      if (result.success) {
        mpAccountIdForOrder = result.mpAccountId || null;
        console.log(`[CASCATA] Mercado Pago APROVOU (tx: ${result.transactionId}).`);
      } else if (result.error) {
        fallbackErrors.push(`MercadoPago: ${result.error}`);
        console.log(`[CASCATA] Mercado Pago NAO processou (${result.error}). ${result.stopCascade ? "Bloqueando cascata." : "Tentando Pagar.me..."}`);
      }
    } else {
      console.log("[CASCATA] Sem token MP (SDK não carregou) — iniciando direto no Pagar.me.");
      result = { success: false, gateway: "mercadopago" };
    }

    if (!result.success && result.isSandbox) {
      console.log("[CASCATA] Conta Mercado Pago em sandbox — bloqueando fallback para gateways reais.");
      result.error = result.error || "O teste no Mercado Pago sandbox falhou antes de chegar aos gateways reais.";
    }

    // Gateway #2: Pagar.me
    const pagarmeKey = Deno.env.get("PAGARME_SECRET_KEY") || "";
    if (!result.success && !result.isSandbox && !result.stopCascade) {
      result = await chargePagarme(chargeParams, products, pagarmeKey, clientIp);
    }

    // Fallback chain: Pagar.me -> VINDI -> AppMax
    if (!result.success && !result.isSandbox && !result.stopCascade) {
      if (result.error) fallbackErrors.push(`Pagar.me: ${result.error}`);
      console.log(`[FALLBACK] Pagar.me NAO processou (${result.error}). Tentando VINDI/Yapay...`);


      const vindiKey = Deno.env.get("VINDI_API_KEY") || "";
      if (vindiKey) {
        const vindiResult = await chargeVindi(chargeParams, products, vindiKey, clientIp);
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
    if (!result.success && !result.isSandbox && !result.stopCascade) {
      console.log(`[FALLBACK] Nenhum gateway anterior aprovou. Tentando APPMAX...`);
      const appmaxToken = Deno.env.get("APPMAX_ACCESS_TOKEN") || "";
      if (appmaxToken) {
        const appmaxResult = await chargeAppmax(chargeParams, products, appmaxToken, clientIp);
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
      if (result.error && !fallbackErrors.some((entry) => entry.includes(result.gateway))) {
        fallbackErrors.push(`${result.gateway}: ${result.error}`);
      }
      // Log detailed errors for debugging, but show generic message to customer
      console.log(`[ALL-GATEWAYS-FAILED] Errors: ${fallbackErrors.join(" | ")}`);
      if (!(result.stopCascade && result.error)) {
        result.error = "Pagamento não aprovado. Verifique os dados do cartão ou tente outro cartão.";
      }
    }

    // ── Update processing record with final status ──
    // Pré-autorização (result.pending) é registrada como "pending" — NÃO como "failed" —
    // para que o DUPLICATE-GUARD bloqueie retentativas enquanto a captura está em curso.
    const finalAttemptStatus = result.success ? "success" : (result.pending ? "pending" : "failed");
    if (paymentAttemptId) {
      await supabase.from("pos_checkout_attempts")
        .update({ status: finalAttemptStatus, gateway: result.gateway || null, error_message: result.error || null } as any)
        .eq("transaction_id", paymentAttemptId)
        .eq("status", "processing")
        .then(() => {});
    }

    // ── PRÉ-AUTORIZAÇÃO EM ANÁLISE: vincula o gateway ao pedido para o webhook localizar
    // o pagamento e para evitar cobrança dupla, mesmo sem captura final ainda. ──
    if (!result.success && result.pending && result.transactionId) {
      const preAuthField: Record<string, string> = {};
      if (result.gateway === "appmax") preAuthField.appmax_order_id = String(result.transactionId);
      else if (result.gateway === "vindi") preAuthField.vindi_transaction_id = String(result.transactionId);
      else if (result.gateway === "pagarme") preAuthField.pagarme_order_id = String(result.transactionId);
      else if (result.gateway === "mercadopago") preAuthField.mercadopago_payment_id = String(result.transactionId);
      if (Object.keys(preAuthField).length) {
        if (orderSource === "orders") {
          await supabase.from("orders").update(preAuthField).eq("id", params.orderId);
        } else {
          await supabase.from("pos_sales").update(preAuthField as any).eq("id", params.orderId);
        }
        console.log(`[PRE-AUTH] ${result.gateway} pré-autorizou o pedido ${params.orderId} (tx ${result.transactionId}). Vinculado para evitar duplicidade.`);
      }
    }

    if (result.success) {
      // Build gateway-specific column update
      const gatewayIdField: Record<string, string> = {};
      if (result.gateway === "pagarme") {
        gatewayIdField.pagarme_order_id = String(result.transactionId);
      } else if (result.gateway === "vindi") {
        gatewayIdField.vindi_transaction_id = String(result.transactionId);
      } else if (result.gateway === "appmax") {
        gatewayIdField.appmax_order_id = String(result.transactionId);
      } else if (result.gateway === "mercadopago") {
        gatewayIdField.mercadopago_payment_id = String(result.transactionId);
        if (mpAccountIdForOrder) gatewayIdField.mp_account_id = mpAccountIdForOrder;
      }


      const paymentLabel = normalizeGatewayPaymentLabel({
        gateway: result.gateway,
        paymentTypeId: result.gateway === "mercadopago" ? "credit_card" : undefined,
        paymentMethodId: result.gateway === "mercadopago" ? "credit_card" : undefined,
        installments: params.installments,
      }) || (params.installments > 1 ? `Cartão de Crédito ${params.installments}x` : "Cartão de Crédito");
      const paidAt = new Date().toISOString();

      if (orderSource === "orders") {
        const { error: updErr } = await supabase
          .from("orders")
          .update({
            is_paid: true, payment_confirmed_source: 'gateway_webhook',
            paid_at: paidAt,
            stage: "paid",
            payment_method_label: paymentLabel,
            installments: params.installments,
            notes: `${order?.notes || ""}\n💳 Pago via ${result.gateway} (${result.transactionId})`.trim(),
            ...gatewayIdField,
          })
          .eq("id", params.orderId);
        if (updErr) {
          console.error("Failed to update orders:", updErr);
        } else {
          if (Object.keys(gatewayIdField).length) {
            const [field, val] = Object.entries(gatewayIdField)[0];
            console.log(`[${result.gateway}] Vinculado ${field}=${val} ao pedido ${params.orderId}`);
          }

          await syncOrderPaymentToPosSale(supabase, {
            orderId: params.orderId,
            paymentMethodLabel: paymentLabel,
            installments: params.installments,
            paymentGateway: result.gateway,
            transactionField: Object.keys(gatewayIdField)[0] || null,
            transactionValue: Object.values(gatewayIdField)[0] ? String(Object.values(gatewayIdField)[0]) : null,
            paidAt,
          });

          await notifyPaymentConfirmedLocal(params.orderId, result.gateway || "unknown", String(result.transactionId || params.orderId));
          await autoCreateShopifyOrder(params.orderId, orderSource, supabaseUrl, supabaseKey);
        }
      } else {
        const { error: updErr } = await supabase
          .from("pos_sales")
          .update({
            status: "paid",
            paid_at: paidAt,
            payment_gateway: result.gateway,
            payment_method: paymentLabel,
            notes: `💳 Pago via ${result.gateway} (${result.transactionId})`,
            ...gatewayIdField,
          })
          .eq("id", params.orderId);
        if (updErr) console.error("Failed to update pos_sales:", updErr);
        else if (Object.keys(gatewayIdField).length) {
          const [field, val] = Object.entries(gatewayIdField)[0];
          console.log(`[${result.gateway}] Vinculado ${field}=${val} ao pedido ${params.orderId}`);
        }
        else console.log(`pos_sales ${params.orderId} updated to paid`);

        // Tiny order creation is now MANUAL ONLY (via the "Enviar/Reenviar ao Tiny" button).
        // The payment confirmation above is all the webhook/charge flow does now.
      }
      console.log(`${orderSource} ${params.orderId} paid via ${result.gateway}`);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in pagarme-create-charge:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
