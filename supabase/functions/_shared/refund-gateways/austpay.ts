import { austpayFetch, resolveAustpayConfig, type AustpayConfig } from "../austpay.ts";

export const AUSTPAY_FULL_ONLY = "Nesta fase, a AustPay permite somente estorno integral pelo sistema. A operadora ainda confere o prazo de cancelamento.";
const active = new Set(["PENDING", "PROCESSING", "TIMEOUT"]);
const final = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface AustpaySource {
  id: string;
  austpayTransactionId?: string | null;
  austpayReferenceIds?: string[];
  total: number;
}

/** Official amounts are always integer centavos; never infer units from the total. */
export function inspectAustpayTransaction(tx: any, src: AustpaySource, requested: number | null) {
  const fail = (error: string) => ({ ok: false, error, payment: tx });
  if (!tx || String(tx.id) !== src.austpayTransactionId) return fail("A identidade da cobrança AustPay não confere.");
  if (tx.currency !== "BRL" || tx.payment_method !== "CREDIT_CARD") return fail("Nesta fase, o estorno AustPay atende somente cartão de crédito em reais.");
  const ref = tx.external_reference ?? tx.metadata?.order_id ?? tx.metadata?.sale_id;
  if (ref && ![src.id, ...(src.austpayReferenceIds || [])].includes(String(ref))) return fail("A referência AustPay pertence a outra compra.");
  if (!Array.isArray(tx.refunds)) return fail("Histórico de estornos AustPay indisponível — bloqueado por segurança.");
  if (tx.refunds.some((r: any) => !final.has(r.status) || active.has(r.status))) return fail("Existe estorno pendente ou não verificável na AustPay. Não solicite novamente.");
  if (tx.status === "REFUNDED") return { ...fail("Este pagamento já foi totalmente estornado."), remaining: 0 };
  if (tx.status !== "APPROVED") return fail(`Pagamento AustPay não está aprovado para estorno (status ${String(tx.status || "desconhecido")}).`);
  if (!Number.isSafeInteger(tx.approved_amount) || tx.approved_amount <= 0 || !tx.approved_at || !Number.isFinite(Date.parse(tx.approved_at))) return fail("Valor ou horário da captura AustPay não confirmado.");
  if (!Number.isSafeInteger(tx.refunded_amount) || tx.refunded_amount < 0) return fail("Valor já estornado não verificável na AustPay.");
  if (tx.refunded_amount !== 0 || tx.refunds.some((r: any) => r.status === "COMPLETED")) return fail("Já existe devolução concluída nesta cobrança; estorno integral bloqueado.");
  const remaining = tx.approved_amount / 100;
  if (Math.round(src.total * 100) !== tx.approved_amount) return fail("Valor capturado na AustPay diverge do valor desta compra. Conferência necessária.");
  if (tx.provider === "CAPPTA" && Array.isArray(tx.ledger_entries) && tx.ledger_entries.some((l: any) => l.type === "TRANSACTION" && (l.settled === true || l.fully_settled_at || l.settlement_items?.some((i: any) => i.status === "PAID")))) return fail("Cobrança Cappta já liquidada — cancelamento pela API indisponível.");
  if (requested != null && (!Number.isFinite(requested) || Math.abs(requested * 100 - tx.approved_amount) > 0.001)) return { ...fail(AUSTPAY_FULL_ONLY), remaining };
  return { ok: true, payment: tx, remaining, refundedSoFar: 0 };
}

export async function austpayCheckPayment(sb: any, src: AustpaySource, amount: number | null) {
  const cfg = await resolveAustpayConfig(sb);
  if (!cfg || cfg.env !== "production") return { ok: false, error: "AustPay de produção indisponível para estorno." };
  if (!src.austpayTransactionId) return { ok: false, error: "Cobrança AustPay não vinculada à compra." };
  const ids = [...new Set([src.id, ...(src.austpayReferenceIds || [])])];
  const { data: parts, error: partsError } = await sb.from("payment_splits").select("id").or(`sale_id.in.(${ids.join(",")}),order_id.in.(${ids.join(",")})`).limit(1);
  if (partsError || parts?.length) return { ok: false, error: "Compra com pagamento dividido ou não verificável — estorno AustPay bloqueado." };
  const { data: bad, error } = await sb.from("pos_checkout_attempts").select("id").in("sale_id", ids).eq("transaction_id", src.austpayTransactionId).eq("status", "invalidated").limit(1);
  if (error || bad?.length) return { ok: false, error: "Captura AustPay invalidada ou não verificável." };
  try {
    const r = await austpayFetch(cfg, `/v1/transactions/${encodeURIComponent(src.austpayTransactionId)}`);
    if (!r.ok) return { ok: false, retry: r.status >= 500 || r.status === 429, error: `Consulta AustPay recusada (HTTP ${r.status}).` };
    const raw = await r.json();
    const tx = raw?.id ? raw : raw?.data;
    return { ...inspectAustpayTransaction(tx, src, amount), cfg };
  } catch { return { ok: false, retry: true, error: "Não foi possível consultar a AustPay agora." }; }
}

/** Correlate by refund ID or our unique description, never by amount alone. */
export function matchAustpayRefund(tx: any, row: any) {
  if (String(tx?.id) !== String(row.payment_id) || !Array.isArray(tx.refunds)) return null;
  const matches = tx.refunds.filter((r: any) =>
    (row.refund_id ? String(r.id) === String(row.refund_id) : String(r.description || "").includes(`BCREF:${row.id}`))
    && String(r.transaction_id) === String(row.payment_id)
    && Number(r.amount) === Math.round(Number(row.amount) * 100));
  return matches.length === 1 ? matches[0] : null;
}

export async function submitAustpayRefund(cfg: AustpayConfig, row: any) {
  // Exactly one request. No automatic resubmission even on HTTP 409/5xx/timeout.
  try {
    // Transações do estabelecimento só aceitam estorno pela rota do próprio merchant
    // (a rota da empresa responde "settlement already in progress").
    let merchantId = cfg.merchantId;
    if (!merchantId) {
      const g = await austpayFetch(cfg, `/v1/transactions/${encodeURIComponent(row.payment_id)}`);
      const gj = await g.json().catch(() => null);
      const t = gj?.id ? gj : gj?.data;
      merchantId = t?.merchant_id || t?.merchant?.id || null;
    }
    const base = merchantId ? `/v1/merchants/${encodeURIComponent(merchantId)}/transactions` : "/v1/transactions";
    const r = await austpayFetch(cfg, `${base}/${encodeURIComponent(row.payment_id)}/refunds`, {
      method: "POST", body: {
        refund_reason: "CUSTOMER_REQUEST", refund_amount: Math.round(Number(row.amount) * 100),
        description: `BCREF:${row.id} ${row.reason_text || row.reason}`.slice(0, 500),
      },
    });
    const raw = await r.json().catch(() => null);
    if (!r.ok) {
      const issue = String(raw?.error?.details?.issues?.[0]?.value || "");
      const error = /settlement is already in progress/i.test(issue)
        ? "A AustPay não permite mais estornar esta venda pelo sistema: o repasse (liquidação) dela já começou. Peça o cancelamento direto ao suporte da AustPay."
        : `AustPay (HTTP ${r.status}): ${String(issue || raw?.error?.message || raw?.message || "resposta não verificável").slice(0, 350)}`;
      return { kind: !raw || raw.status === "PENDING_REFUND" || raw.data?.status === "PENDING_REFUND" || r.status >= 500 || [408, 409, 429].includes(r.status) ? "verificar" : "failed", error, raw };
    }
    const tx = raw?.id ? raw : raw?.data;
    const match = matchAustpayRefund(tx, row);
    if (match?.status === "COMPLETED" && tx.status === "REFUNDED" && tx.refunded_amount === Math.round(Number(row.amount) * 100)) return { kind: "done", raw: tx, match };
    return { kind: "verificar", raw: tx, match, error: "Solicitação recebida pela AustPay; aguardando confirmação da devolução, sem repetir." };
  } catch { return { kind: "verificar", error: "Resposta da AustPay não confirmada. Não repita o estorno." }; }
}