// Shared helpers for automation flows:
//  - cashback variables (including "dias para expirar")
//  - purchase lookups (anchor date + "Comprou?" condition guard)
//
// Used by automation-trigger-pos-sale, automation-continue-flow,
// automation-queue-worker and automation-pos-followups-cron.

export function phoneSuffix8(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "").slice(-8);
}

export function fmtMoneyBR(v: number | null | undefined): string {
  const n = Number(v || 0);
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

/** Dias inteiros (mínimo 0) entre agora e uma data futura. */
export function daysUntil(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null;
  const t = new Date(dateIso).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = Math.ceil((t - Date.now()) / 86_400_000);
  return diff > 0 ? diff : 0;
}

/** "12 dias" / "1 dia" / "hoje" */
export function formatDaysLabel(days: number | null): string {
  if (days === null) return "";
  if (days <= 0) return "hoje";
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

export interface CashbackRow {
  coupon_code?: string | null;
  cashback_amount?: number | null;
  min_purchase?: number | null;
  expires_at?: string | null;
}

/** Monta as variáveis de cashback a partir de uma linha de internal_cashback. */
export function cashbackVars(cb: CashbackRow | null | undefined): Record<string, string> {
  const dias = daysUntil(cb?.expires_at);
  return {
    "{{valor_cashback}}": cb ? fmtMoneyBR(cb.cashback_amount) : "",
    "{{codigo_cashback}}": cb?.coupon_code || "",
    "{{cupom}}": cb?.coupon_code || "",
    "{{compra_minima}}": cb ? fmtMoneyBR(cb.min_purchase) : "",
    "{{validade_cashback}}": cb?.expires_at
      ? new Date(cb.expires_at).toLocaleDateString("pt-BR")
      : "",
    "{{dias_para_expirar}}": formatDaysLabel(dias),
  };
}

/** Busca o cashback ativo mais recente do telefone (usado ao retomar o fluxo). */
export async function fetchActiveCashback(
  supabase: any,
  phone: string,
): Promise<CashbackRow | null> {
  const suffix = phoneSuffix8(phone);
  if (suffix.length < 8) return null;
  try {
    const { data } = await supabase
      .from("internal_cashback")
      .select("coupon_code, cashback_amount, min_purchase, expires_at")
      .ilike("customer_phone", `%${suffix}`)
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch (_e) {
    return null;
  }
}

/** Data da última compra concluída do telefone (âncora "após a compra"). */
export async function lastPurchaseAt(
  supabase: any,
  phone: string,
): Promise<string | null> {
  const suffix = phoneSuffix8(phone);
  if (suffix.length < 8) return null;
  try {
    const { data } = await supabase
      .from("pos_sales")
      .select("created_at")
      .ilike("customer_phone", `%${suffix}`)
      .in("status", ["completed", "paid", "pending_pickup"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.created_at || null;
  } catch (_e) {
    return null;
  }
}

/** Houve compra concluída depois de `sinceIso`? (ignora a venda que disparou o fluxo) */
export async function hasPurchaseSince(
  supabase: any,
  phone: string,
  sinceIso: string,
  excludeSaleId?: string | null,
): Promise<boolean> {
  const suffix = phoneSuffix8(phone);
  if (suffix.length < 8) return false;
  try {
    let q = supabase
      .from("pos_sales")
      .select("id")
      .ilike("customer_phone", `%${suffix}`)
      .in("status", ["completed", "paid", "pending_pickup"])
      .gte("created_at", sinceIso)
      .limit(1);
    if (excludeSaleId) q = q.neq("id", excludeSaleId);
    const { data } = await q;
    return Array.isArray(data) && data.length > 0;
  } catch (_e) {
    return false;
  }
}

// ── Condição "Comprou?" ────────────────────────────────────────────────
// Materializada como um "guard" nas mensagens agendadas depois do nó.
// stopIf = "bought"      → encerra o fluxo se o cliente comprou desde `since`
// stopIf = "not_bought"  → encerra o fluxo se o cliente NÃO comprou

export interface PurchaseGuard {
  type: "purchase";
  since: string;
  stopIf: "bought" | "not_bought";
  /** Venda que disparou o fluxo — nunca conta como "comprou de novo". */
  excludeSaleId?: string | null;
}

export function buildPurchaseGuard(
  config: Record<string, unknown>,
  fromIso: string,
  excludeSaleId?: string | null,
): PurchaseGuard {
  const raw = config.windowDays ?? config.window;
  const windowDays = Number(raw) || 0; // "since_trigger" → 0
  const since = windowDays > 0
    ? new Date(Date.now() - windowDays * 86_400_000).toISOString()
    : fromIso;
  return {
    type: "purchase",
    since,
    stopIf: (config.stopIf as "bought" | "not_bought") || "bought",
    ...(excludeSaleId ? { excludeSaleId } : {}),
  };
}

/** true → a mensagem NÃO deve ser enviada (condição encerrou o fluxo). */
export async function guardBlocks(
  supabase: any,
  phone: string,
  guard: PurchaseGuard | null | undefined,
): Promise<boolean> {
  if (!guard || guard.type !== "purchase") return false;
  const bought = await hasPurchaseSince(supabase, phone, guard.since, guard.excludeSaleId);
  return guard.stopIf === "bought" ? bought : !bought;
}

/** Lê o guard gravado em recipient_data/payload. */
export function readGuard(container: unknown): PurchaseGuard | null {
  const g = (container as any)?.__guard__;
  return g && g.type === "purchase" ? (g as PurchaseGuard) : null;
}

// ── Espera ancorada na data da compra ──────────────────────────────────
// config.anchor === "purchase" → o prazo conta a partir da data da compra,
// e não do momento em que o fluxo foi retomado (clique em botão, resposta…).

export function isPurchaseAnchored(config: Record<string, unknown> | null | undefined): boolean {
  return (config as any)?.anchor === "purchase";
}

/**
 * Instante absoluto (epoch ms) em que o passo deve rodar quando a espera é
 * ancorada na compra. Retorna null quando não há âncora conhecida.
 * Nunca retorna um instante no passado distante: o mínimo é "agora".
 */
export function anchoredRunAtMs(
  anchorIso: string | null | undefined,
  delaySeconds: number,
): number | null {
  if (!anchorIso) return null;
  const base = new Date(anchorIso).getTime();
  if (!Number.isFinite(base)) return null;
  return Math.max(Date.now(), base + delaySeconds * 1000);
}
