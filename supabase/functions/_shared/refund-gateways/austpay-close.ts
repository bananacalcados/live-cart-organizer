import { austpayFetch, resolveAustpayConfig } from "../austpay.ts";
import { matchAustpayRefund, submitAustpayRefund, austpayCheckPayment, type AustpaySource } from "./austpay.ts";
import { runRefundPostActions } from "../refund-post-actions.ts";

async function persist(sb: any, row: any, tx: any, match: any, error?: string) {
  const done = match?.status === "COMPLETED" && tx?.status === "REFUNDED" && tx?.refunded_amount === Math.round(Number(row.amount) * 100);
  const failed = match && ["FAILED", "CANCELLED"].includes(match.status);
  const status = done ? "concluido" : failed ? "falhou" : "verificar";
  const patch = {
    status, refund_id: match?.id || row.refund_id || null,
    mp_response: tx || null, error_message: done ? null : error || `AustPay: estorno ${match?.status || "em conferência"}. Não repetir.`,
    completed_at: done ? match.updated_at || new Date().toISOString() : null, updated_at: new Date().toISOString(),
  };
  if (status === row.status && patch.refund_id === (row.refund_id || null) && !done && !failed) return { ok: true, status, message: patch.error_message };
  const { data, error: saveError } = await sb.from("gateway_refunds").update(patch).eq("id", row.id).eq("status", row.status).select("id").maybeSingle();
  if (saveError) throw new Error("Falha ao salvar a confirmação AustPay; não repetir a devolução.");
  if (done && data) await runRefundPostActions(sb, { ...row, ...patch }, null);
  return { ok: done || !failed, status, message: done ? "Estorno concluído na AustPay; comprovante disponível." : patch.error_message };
}

export async function executeAustpay(sb: any, row: any, src: AustpaySource) {
  const check = await austpayCheckPayment(sb, src, Number(row.amount));
  if (!check.ok || !("cfg" in check) || !check.cfg) {
    if ('gateway_window_open' in check && check.gateway_window_open===false) {
      await sb.from('gateway_refunds').update({status:'aguardando_aprovacao',error_message:check.error,updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','processando');
      return {ok:false,error:check.error};
    }
    await sb.from("gateway_refunds").update({ status: "verificar", error_message: check.error, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "processando");
    return { ok: false, verificar: true, error: check.error };
  }
  const result = await submitAustpayRefund(check.cfg, row);
  if (result.kind === "failed") {
    await sb.from("gateway_refunds").update({ status: "falhou", error_message: result.error, mp_response: result.raw, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "processando");
    return { ok: false, error: result.error };
  }
  return persist(sb, row, result.raw, result.match, result.error);
}

/** Existing worker only reads; no age-based retry or release of uncertain requests. */
export async function closeAustpayRefund(sb: any, row: any) {
  const cfg = await resolveAustpayConfig(sb);
  if (!cfg || cfg.env !== "production") return "pending";
  const r = await austpayFetch(cfg, `/v1/transactions/${encodeURIComponent(row.payment_id)}`);
  if (!r.ok) return "pending";
  const raw = await r.json(); const tx = raw?.id ? raw : raw?.data;
  const match = matchAustpayRefund(tx, row);
  if (!match) return "pending";
  const result = await persist(sb, row, tx, match);
  return result.status === "concluido" ? "done" : "pending";
}