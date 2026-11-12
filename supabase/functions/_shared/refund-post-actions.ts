// Ações pós-estorno concluído (Mercado Pago — Fase 1).
// Compartilhado entre mp-refund (execução imediata) e mercadopago-poll-pending
// (estornos que ficaram "processando", ex.: Pix in_process).
// NÃO mexe em estoque nem em nota fiscal nesta fase.
import { ensureRefundReceipt } from "./refund-receipt.ts";

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export async function appendRefundHistory(supabase: any, row: any, userEmail: string | null) {
  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const line = `[ESTORNO ${String(row.gateway).toUpperCase()}${row.status==='concluido_manual'?` MANUAL · protocolo ${row.manual_reference}`:''} ${when}] ${brl(Number(row.amount))} (${row.refund_type}) — motivo: ${row.reason}${row.reason_text ? ` (${row.reason_text})` : ""} — por ${userEmail || row.requested_by || "sistema"}`;
  const table = row.source === "order" ? "orders" : "pos_sales";
  try {
    const { data } = await supabase.from(table).select("notes").eq("id", row.source_id).maybeSingle();
    const current = (data?.notes || "") as string;
    // Nunca sobrescreve anotações existentes — só acrescenta.
    await supabase.from(table).update({ notes: current ? `${current}\n${line}` : line }).eq("id", row.source_id);
  } catch (e: any) {
    console.warn("[refund-post] history append failed:", e?.message);
  }
}

export async function linkRefundToExchange(supabase: any, row: any) {
  try {
    await supabase
      .from("trocas_devolucoes")
      .update({ estorno_forma: row.gateway === "austpay" ? "austpay" : row.gateway === "appmax" ? "appmax" : "mercadopago", gateway_refund_id: row.id })
      .eq("pedido_original_id", row.source_id)
      .is("gateway_refund_id", null);
  } catch (e: any) {
    console.warn("[refund-post] link exchange failed:", e?.message);
  }
}

/** Venda ainda não despachada sai da Expedição (status cancelado devolve o estoque pelo trigger existente). */
export async function maybeCancelUnshippedSale(supabase: any, saleId: string | null | undefined) {
  if (!saleId) return false;
  const { data } = await supabase.from("pos_sales").select("status, shipped_at, expedition_stage").eq("id", saleId).maybeSingle();
  if (!data || data.status === "cancelled" || data.shipped_at || data.expedition_stage === "concluido") return false;
  const { error } = await supabase.from("pos_sales").update({ status: "cancelled", status_cancelamento: "cancelado" }).eq("id", saleId).neq("status", "cancelled").is("shipped_at", null);
  return !error;
}

export async function maybeCancelRefundedOrder(supabase: any, row: any) {
  if (!row.cancel_order || row.refund_type !== "integral") return;
  if (row.source === "pos_sale") {
    if (row.reason !== "cancelamento_antes_envio") return;
    try { await maybeCancelUnshippedSale(supabase, row.source_id); } catch (e: any) { console.warn("[refund-post] cancel sale failed:", e?.message); }
    return;
  }
  if (row.source !== "order") return;
  if (row.reason === "cancelamento_antes_envio") {
    try {
      const { data: o } = await supabase.from("orders").select("pos_sale_id").eq("id", row.source_id).maybeSingle();
      await maybeCancelUnshippedSale(supabase, o?.pos_sale_id);
    } catch (e: any) { console.warn("[refund-post] cancel linked sale failed:", e?.message); }
  }
  try {
    const { data } = await supabase.from("orders").select("stage").eq("id", row.source_id).maybeSingle();
    if (data && !["shipped", "delivered", "cancelled"].includes(String(data.stage || ""))) {
      await supabase.from("orders").update({ stage: "cancelled", updated_at: new Date().toISOString() }).eq("id", row.source_id);
    }
  } catch (e: any) {
    console.warn("[refund-post] cancel order failed:", e?.message);
  }
}

export async function runRefundPostActions(supabase: any, row: any, userEmail: string | null) {
  await appendRefundHistory(supabase, row, userEmail);
  await linkRefundToExchange(supabase, row);
  await maybeCancelRefundedOrder(supabase, row);
  // Comprovante interno (Fase 3) — falha aqui nunca desfaz o estorno.
  try {
    const r = await ensureRefundReceipt(supabase, row.id);
    if (!r.ok) console.warn("[refund-post] receipt:", r.error);
  } catch (e: any) {
    console.warn("[refund-post] receipt failed:", e?.message);
  }
}
