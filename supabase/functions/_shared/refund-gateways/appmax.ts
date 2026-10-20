// Adaptador de estorno Appmax (conta nova AppStore / API v1).
// Interface igual ao adaptador do Mercado Pago: consultar pagamento, executar
// estorno e consultar estorno (worker). Credencial: appmax_installations
// (service role). Pedido só encontrado na conta antiga (api/v3) é bloqueado —
// o reembolso dessa conta não foi confirmado na documentação.
// Estorno: POST https://api.appmax.com.br/v1/orders/refund-request
//   { order_id, type: "total" | "partial", value (centavos) }
// Parcial: a API aceita, mas ela não devolve de forma confiável o valor já
// estornado — então o sistema só permite INTEGRAL na Appmax (conferência segura).

const API = "https://api.appmax.com.br";
export const APPMAX_PAID = ["aprovado", "approved", "paid", "pago", "integrado", "autorizado", "authorized"];
export const APPMAX_REFUNDED = ["estornado", "refunded", "reembolsado"];
export const APPMAX_PARTIAL = ["estornado_parcialmente", "partially_refunded", "estorno_parcial", "parcialmente_estornado"];
export const APPMAX_LEGACY_BLOCK = "Conta Appmax antiga — estorno pelo sistema indisponível";
export const APPMAX_PARTIAL_ONLY_FULL = "A Appmax só permite estorno integral pelo sistema.";

let tokenCache: { token: string; exp: number } | null = null;

export async function appmaxToken(supabase: any): Promise<string | null> {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const { data } = await supabase.from("appmax_installations")
    .select("merchant_client_id, merchant_client_secret").eq("env", "production").eq("status", "installed").maybeSingle();
  if (!data?.merchant_client_id || !data?.merchant_client_secret) return null;
  const r = await fetch("https://auth.appmax.com.br/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: data.merchant_client_id, client_secret: data.merchant_client_secret }).toString(),
  });
  if (!r.ok) throw new Error(`oauth2 HTTP ${r.status}`);
  const t = String((await r.json()).access_token || "");
  if (!t) throw new Error("oauth2 sem token");
  tokenCache = { token: t, exp: Date.now() + 50 * 60 * 1000 };
  return t;
}

export interface AppmaxPayment {
  orderId: string;
  status: string;
  amount: number | null;      // reais
  method: "pix" | "cartao" | "boleto" | null;
  cardBrand: string | null;
  cardLast4: string | null;
  installments: number | null;
  dateApproved: string | null;
  raw: any;
}

export type AppmaxLookup =
  | { kind: "ok"; payment: AppmaxPayment }
  | { kind: "legacy" }
  | { kind: "not_found" }
  | { kind: "no_credentials" }
  | { kind: "retry"; error: string };

function toReais(v: any, localTotal: number | null): number | null {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return null;
  // A API v1 trabalha em centavos; alguns campos vêm em reais. Decide pela
  // proximidade com o total local quando houver; senão inteiro = centavos.
  if (localTotal && localTotal > 0) {
    const asCents = n / 100;
    return Math.abs(asCents - localTotal) < Math.abs(n - localTotal) ? Math.round(asCents * 100) / 100 : n;
  }
  return Number.isInteger(n) ? n / 100 : n;
}

function normalize(orderId: string, payload: any, localTotal: number | null): AppmaxPayment | null {
  const o = payload?.data?.order || payload?.data || payload?.order || payload;
  if (!o || String(o.id ?? "") !== String(orderId)) return null;
  const pay = o.payment || o.payments?.[0] || {};
  const typeRaw = String(o.payment_type || o.payment_method || pay.type || pay.method || "").toLowerCase();
  const method = typeRaw.includes("pix") ? "pix" : typeRaw.includes("boleto") ? "boleto" : typeRaw ? "cartao" : null;
  const card = pay.card || o.card || {};
  return {
    orderId: String(o.id),
    status: String(o.status || "").toLowerCase(),
    // API v1: total_paid em CENTAVOS (conferido: 35999 = R$ 359,99).
    amount: o.total_paid != null && isFinite(Number(o.total_paid)) && Number(o.total_paid) > 0
      ? Math.round(Number(o.total_paid)) / 100
      : toReais(o.total ?? o.total_amount ?? o.amount ?? pay.amount, localTotal),
    method,
    cardBrand: method === "cartao" ? (String(card.brand || pay.brand || o.card_brand || "").toLowerCase() || "cartao") : null,
    cardLast4: card.last_four_digits || card.last4 || pay.last4 || null,
    installments: Number(o.installments || pay.installments) || null,
    dateApproved: o.paid_at || o.approved_at || pay.paid_at || null,
    raw: o,
  };
}

/** Consulta o pedido na conta nova; se não existir lá, confere se é da conta antiga. */
export async function appmaxGetPayment(supabase: any, orderId: string, localTotal: number | null): Promise<AppmaxLookup> {
  let token: string | null;
  try { token = await appmaxToken(supabase); } catch (e: any) { return { kind: "retry", error: e?.message || "token" }; }
  if (!token) return { kind: "no_credentials" };
  let r: Response;
  try { r = await fetch(`${API}/v1/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); }
  catch (e: any) { return { kind: "retry", error: e?.message || "rede" }; }
  if (r.status >= 500 || r.status === 429) return { kind: "retry", error: `HTTP ${r.status}` };
  if (r.ok) {
    const p = normalize(orderId, await r.json().catch(() => null), localTotal);
    if (p) return { kind: "ok", payment: p };
  }
  // Não está na conta nova: é da conta antiga?
  const legacy = Deno.env.get("APPMAX_ACCESS_TOKEN");
  if (legacy) {
    try {
      const lr = await fetch(`https://admin.appmax.com.br/api/v3/order/${encodeURIComponent(orderId)}`, { headers: { "access-token": legacy } });
      if (lr.ok) {
        const j = await lr.json().catch(() => null);
        const o = j?.data?.order || j?.data;
        if (o && String(o.id ?? "") === String(orderId)) return { kind: "legacy" };
      }
    } catch (_) { /* sem prova de conta antiga */ }
  }
  return { kind: "not_found" };
}

export interface AppmaxCheck {
  ok: boolean;
  error?: string;
  retry?: boolean;
  payment?: AppmaxPayment;
  remaining?: number;
  refundedSoFar?: number;
}

/** Mesmas regras do MP, adaptadas: só pedido pago na conta nova, integral apenas. */
export async function appmaxCheckPayment(supabase: any, orderId: string, localTotal: number, requestedAmount: number | null): Promise<AppmaxCheck> {
  const look = await appmaxGetPayment(supabase, orderId, localTotal);
  if (look.kind === "retry") return { ok: false, retry: true, error: "Não foi possível consultar o gateway agora" };
  if (look.kind === "no_credentials") return { ok: false, error: "Conta Appmax não conectada — estorno pelo sistema indisponível" };
  if (look.kind === "legacy") return { ok: false, error: APPMAX_LEGACY_BLOCK };
  if (look.kind === "not_found") return { ok: false, error: "Pedido Appmax não encontrado na conta conectada — estorno pelo sistema indisponível" };
  const p = look.payment;
  if (APPMAX_REFUNDED.includes(p.status)) return { ok: false, error: "Este pagamento já foi totalmente estornado.", payment: p, remaining: 0 };
  if (APPMAX_PARTIAL.includes(p.status)) return { ok: false, error: "Pedido Appmax já parcialmente estornado — estorno pelo sistema indisponível", payment: p };
  if (!APPMAX_PAID.includes(p.status)) return { ok: false, error: `Pedido Appmax não consta como pago (status ${p.status || "desconhecido"})`, payment: p };
  const remaining = Math.round((p.amount ?? localTotal) * 100) / 100;
  if (!(remaining > 0)) return { ok: false, error: "Valor do pedido Appmax indisponível — estorno pelo sistema indisponível", payment: p };
  if (requestedAmount != null && Math.abs(requestedAmount - remaining) > 0.009) {
    return { ok: false, error: `${APPMAX_PARTIAL_ONLY_FULL} Valor integral: ${remaining.toFixed(2).replace(".", ",")}.`, payment: p, remaining, refundedSoFar: 0 };
  }
  return { ok: true, payment: p, remaining, refundedSoFar: 0 };
}

export type AppmaxRefundResult =
  | { kind: "done"; raw: any; refundId: string | null }
  | { kind: "processing"; raw: any; refundId: string | null }
  | { kind: "verificar"; error: string; raw?: any }
  | { kind: "failed"; error: string; raw?: any };

/** Executa o estorno integral. Idempotência por consulta prévia do pedido. */
export async function appmaxExecuteRefund(supabase: any, orderId: string, amount: number): Promise<AppmaxRefundResult> {
  const pre = await appmaxGetPayment(supabase, orderId, amount);
  if (pre.kind === "retry") return { kind: "verificar", error: `Não consegui consultar a Appmax antes do estorno (${pre.error}).` };
  if (pre.kind !== "ok") return { kind: "failed", error: pre.kind === "legacy" ? APPMAX_LEGACY_BLOCK : "Pedido Appmax não encontrado na conta conectada." };
  if (APPMAX_REFUNDED.includes(pre.payment.status)) return { kind: "done", raw: pre.payment.raw, refundId: null };
  if (!APPMAX_PAID.includes(pre.payment.status)) return { kind: "failed", error: `Pedido Appmax não consta como pago (status ${pre.payment.status}).`, raw: pre.payment.raw };

  let token: string | null;
  try { token = await appmaxToken(supabase); } catch (e: any) { return { kind: "verificar", error: `Falha ao autenticar na Appmax: ${e?.message}` }; }
  if (!token) return { kind: "failed", error: "Conta Appmax não conectada." };
  let r: Response;
  try {
    r = await fetch(`${API}/v1/orders/refund-request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ order_id: Number(orderId), type: "total", value: Math.round(amount * 100) }),
    });
  } catch (e: any) {
    return { kind: "verificar", error: `Falha de rede ao chamar a Appmax: ${e?.message}` };
  }
  const raw = await r.json().catch(() => ({}));
  if (r.status >= 500) return { kind: "verificar", error: `Appmax instável (HTTP ${r.status}) — verificando se o estorno foi processado.`, raw };
  if (!r.ok) {
    const msg = String(raw?.message || raw?.error || raw?.text || `HTTP ${r.status}`);
    return { kind: "failed", error: `Appmax recusou o estorno: ${msg}`.slice(0, 400), raw };
  }
  const d = raw?.data || raw;
  const refundId = d?.id != null ? String(d.id) : d?.refund_id != null ? String(d.refund_id) : null;
  const st = String(d?.status || "").toLowerCase();
  if (APPMAX_REFUNDED.includes(st)) return { kind: "done", raw, refundId };
  return { kind: "processing", raw, refundId };
}

/** Worker: confere pelo status do pedido. */
export async function appmaxCheckRefund(supabase: any, orderId: string, amount: number): Promise<"done" | "pending" | "not_refunded" | "retry"> {
  const look = await appmaxGetPayment(supabase, orderId, amount);
  if (look.kind === "retry") return "retry";
  if (look.kind !== "ok") return "pending";
  if (APPMAX_REFUNDED.includes(look.payment.status)) return "done";
  if (APPMAX_PAID.includes(look.payment.status)) return "not_refunded";
  return "pending";
}
