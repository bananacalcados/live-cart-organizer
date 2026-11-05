// Verificação independente de webhooks de pagamento (Fase 3 de segurança).
// Regra: nunca confiar no corpo do aviso. Valor/status vêm da API do provedor
// com NOSSA chave; o valor é comparado com o que o sistema cobraria do pedido.
// Modo dry run (app_settings.webhook_strict_mode=false): a decisão nova só é
// registrada em webhook_verification_log; a decisão antiga continua valendo.

export type Decision = "confirm" | "reject_unverified" | "reject_amount" | "skip";

/** Tolerância para pedidos: R$1,00 ou 1%, o que for maior. */
export function orderTolerance(expected: number): number {
  return Math.max(1, expected * 0.01);
}
/** Tolerância exata (PDV e fallback por telefone). */
export const EXACT_TOLERANCE = 0.05;

export function requestIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  return xf ? xf.split(",")[0].trim() : null;
}

let strictCache: { v: boolean; at: number } | null = null;
export async function isStrictMode(supabase: any): Promise<boolean> {
  if (strictCache && Date.now() - strictCache.at < 30_000) return strictCache.v;
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "webhook_strict_mode").maybeSingle();
    const v = data?.value === true || data?.value === "true";
    strictCache = { v, at: Date.now() };
    return v;
  } catch {
    return false; // na dúvida, comportamento antigo
  }
}

export async function securityEvent(supabase: any, event: string, ip: string | null, details: Record<string, unknown>) {
  try { await supabase.from("security_events").insert({ event, ip, details }); } catch (_) { /* não bloqueia */ }
}

/** Aviso diário quando o segredo de assinatura não está configurado. */
export async function warnMissingSecretOncePerDay(supabase: any, provider: string) {
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data } = await supabase.from("security_events").select("id")
      .eq("event", "webhook_secret_missing").gte("created_at", since)
      .contains("details", { provider }).limit(1);
    if (!data?.length) await securityEvent(supabase, "webhook_secret_missing", null, { provider });
  } catch (_) { /* ignore */ }
}

export async function hmacHex(algo: "SHA-1" | "SHA-256", secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: algo }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface VerificationRow {
  provider: string;
  source?: "live" | "replay";
  event_type?: string | null;
  external_id?: string | null;
  transaction_id?: string | null;
  order_id?: string | null;
  sale_id?: string | null;
  verified: boolean;
  api_status?: string | null;
  api_amount?: number | null;
  expected_amount?: number | null;
  old_decision: string;
  new_decision: Decision;
  reason?: string | null;
  strict_mode: boolean;
  applied?: boolean;
  details?: Record<string, unknown>;
}

export async function logVerification(supabase: any, row: VerificationRow) {
  try { await supabase.from("webhook_verification_log").insert({ source: "live", ...row }); }
  catch (e: any) { console.warn("[webhook-verify] log failed", e?.message); }
}

/** Idempotência: transação já aplicada pela regra nova. */
export async function alreadyApplied(supabase: any, provider: string, txId: string | null): Promise<boolean> {
  if (!txId) return false;
  const { data } = await supabase.from("webhook_verification_log").select("id")
    .eq("provider", provider).eq("transaction_id", txId).eq("applied", true).eq("new_decision", "confirm").limit(1);
  return !!data?.length;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

/**
 * Menor valor que o sistema poderia legitimamente cobrar deste pedido
 * (mesmas regras do checkout: produtos - desconto + frete, prêmio da roleta,
 * desconto Pix só sem cashback). Pagar a mais nunca é recusado (juros de cartão).
 */
export async function expectedOrderAmounts(supabase: any, orderId: string): Promise<{ base: number; min: number; pixPct: number } | null> {
  const { data: o } = await supabase.from("orders")
    .select("id, products, discount_type, discount_value, shipping_cost, free_shipping, cashback_id, cashback_amount")
    .eq("id", orderId).maybeSingle();
  if (!o) return null;
  const items = Array.isArray(o.products) ? o.products : [];
  const subtotal = items.reduce((s: number, p: any) => s + (Number(p?.price) || 0) * (Number(p?.quantity) || 0), 0);
  const disc = o.discount_type && o.discount_value
    ? (o.discount_type === "percentage" ? subtotal * (Number(o.discount_value) / 100) : Number(o.discount_value))
    : 0;
  const shipping = o.free_shipping ? 0 : Number(o.shipping_cost || 0);
  const base = round2(Math.max(0, subtotal - disc + shipping));

  // Prêmio da roleta aplicado a este pedido (abatimento server-side).
  let prizeOff = 0;
  try {
    const { data: prizes } = await supabase.from("customer_prizes").select("prize_type, prize_value").eq("applied_order_id", orderId).limit(5);
    for (const p of prizes || []) {
      const t = String(p.prize_type || "").toLowerCase();
      const v = Number(p.prize_value || 0);
      if (t.includes("percent") || t === "%") prizeOff += Math.max(0, subtotal - disc) * v / 100;
      else if (t.includes("frete") || t.includes("shipping")) prizeOff += shipping;
      else prizeOff += v;
    }
  } catch (_) { /* sem prêmio */ }

  let pixPct = 0;
  const hasCashback = !!o.cashback_id || Number(o.cashback_amount || 0) > 0;
  if (!hasCashback) {
    try {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "pix_discount_percent").maybeSingle();
      pixPct = Number(String(data?.value ?? "").replace(/"/g, "")) || 0;
    } catch (_) { /* 0 */ }
  }
  const afterPrize = Math.max(0, base - prizeOff);
  const min = round2(afterPrize * (1 - pixPct / 100));
  return { base, min, pixPct };
}

/** Pedido: aceita pagamento >= menor valor legítimo - tolerância. */
export function orderAmountOk(apiAmount: number, exp: { base: number; min: number }): boolean {
  if (!(apiAmount > 0) || !(exp.base > 0)) return false;
  return apiAmount >= exp.min - orderTolerance(exp.base);
}

export function exactAmountOk(apiAmount: number, expected: number): boolean {
  return apiAmount > 0 && expected > 0 && Math.abs(apiAmount - expected) <= EXACT_TOLERANCE;
}

/** Marca para conferência manual (não altera o status de pagamento). */
export async function flagReview(supabase: any, table: "orders" | "pos_sales", id: string) {
  try { await supabase.from(table).update({ payment_review_required: true }).eq("id", id).eq("payment_review_required", false); }
  catch (_) { /* ignore */ }
}

// ---------- Consultas aos provedores ----------

export interface ApiPayment { found: boolean; paid: boolean; status: string | null; amount: number | null; error?: string; raw?: any }

export async function pagarmeLookup(id: string): Promise<ApiPayment> {
  const key = Deno.env.get("PAGARME_SECRET_KEY");
  if (!key) return { found: false, paid: false, status: null, amount: null, error: "no_credentials" };
  const path = id.startsWith("ch_") ? `charges/${id}` : `orders/${id}`;
  try {
    const r = await fetch(`https://api.pagar.me/core/v5/${path}`, { headers: { Authorization: `Basic ${btoa(key + ":")}`, Accept: "application/json" } });
    if (!r.ok) return { found: false, paid: false, status: null, amount: null, error: `HTTP ${r.status}` };
    const j = await r.json();
    const charges = Array.isArray(j.charges) ? j.charges : (j.object === "charge" || path.startsWith("charges") ? [j] : []);
    const paidCents = charges.filter((c: any) => c.status === "paid").reduce((s: number, c: any) => s + Number(c.paid_amount ?? c.amount ?? 0), 0);
    const status = String(j.status || "");
    const currencyOk = charges.every((c: any) => !c.currency || String(c.currency).toUpperCase() === "BRL");
    return { found: true, paid: status === "paid" && currencyOk && paidCents > 0, status, amount: paidCents / 100, raw: { id: j.id, code: j.code } };
  } catch (e: any) {
    return { found: false, paid: false, status: null, amount: null, error: e?.message || "network" };
  }
}

export async function appmaxLookup(supabase: any, orderId: string, localTotal: number | null): Promise<ApiPayment> {
  const { appmaxGetPayment, APPMAX_PAID } = await import("./refund-gateways/appmax.ts");
  const look = await appmaxGetPayment(supabase, orderId, localTotal);
  if (look.kind === "ok") {
    const p = look.payment;
    return { found: true, paid: APPMAX_PAID.includes(p.status), status: p.status, amount: p.amount };
  }
  if (look.kind === "legacy") {
    // Conta antiga (api/v3): status/valor em reais.
    const legacy = Deno.env.get("APPMAX_ACCESS_TOKEN");
    try {
      const lr = await fetch(`https://admin.appmax.com.br/api/v3/order/${encodeURIComponent(orderId)}`, { headers: { "access-token": legacy! } });
      const j = await lr.json();
      const o = j?.data?.order || j?.data;
      const status = String(o?.status || "").toLowerCase();
      const amount = Number(o?.total ?? o?.total_products ?? 0) || null;
      return { found: true, paid: ["aprovado", "integrado"].includes(status), status, amount };
    } catch (e: any) {
      return { found: false, paid: false, status: null, amount: null, error: e?.message || "legacy" };
    }
  }
  return { found: false, paid: false, status: null, amount: null, error: look.kind === "retry" ? look.error : look.kind };
}

/** PDV: nunca abaixo do total da venda (−R$0,05); acima é aceito (juros do cartão repassados). */
export function posAmountOk(apiAmount: number, total: number): boolean {
  return apiAmount > 0 && total > 0 && apiAmount >= total - EXACT_TOLERANCE;
}
