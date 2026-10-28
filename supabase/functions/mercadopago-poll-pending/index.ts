// Cron de fallback: varre pedidos awaiting_payment e consulta o status na API do MP.
// Suporta multi-conta: itera por todas as contas cadastradas tentando localizar o pagamento.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listAllMpAccountsForPolling, getMpAccountByPaymentId } from "../_shared/mp-account.ts";
import { mpGetPayment } from "../_shared/mp-http.ts";
import { runRefundPostActions } from "../_shared/refund-post-actions.ts";
import { closeAppmaxRefund } from "../_shared/refund-gateways/appmax-close.ts";
import { closeAustpayRefund } from "../_shared/refund-gateways/austpay-close.ts";
import { ensureRefundReceipt, RECEIPT_LAYOUT_SINCE } from "../_shared/refund-receipt.ts";
import { grantSelfserviceCashback } from "../_shared/selfservice-cashback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const accounts = await listAllMpAccountsForPolling(supabase);
  if (accounts.length === 0) {
    return new Response(JSON.stringify({ error: "no MP accounts available" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Janela: pedidos criados nas últimas 24h, ainda não pagos, com ID MP salvo
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [ordersRes, salesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, mercadopago_payment_id, mp_account_id, is_paid")
      .not("mercadopago_payment_id", "is", null)
      .eq("is_paid", false)
      .gte("created_at", since)
      .limit(50),
    supabase
      .from("pos_sales")
      .select("id, mercadopago_payment_id, mp_account_id, status")
      .not("mercadopago_payment_id", "is", null)
      .in("status", ["online_pending", "awaiting_payment", "pending"])
      .gte("created_at", since)
      .limit(50),
  ]);

  const orders = ordersRes.data || [];
  const sales = salesRes.data || [];

  let confirmed = 0;
  let checked = 0;
  const errors: any[] = [];

  // Tenta resolver status testando contas: começa pela conta vinculada (se houver), depois as demais
  const checkOne = async (mpId: string, preferredAccountId?: string | null): Promise<string | null> => {
    const ordered = [...accounts].sort((a, b) => {
      if (preferredAccountId && a.account_id === preferredAccountId) return -1;
      if (preferredAccountId && b.account_id === preferredAccountId) return 1;
      return 0;
    });

    for (const acc of ordered) {
      try {
        const r = await mpGetPayment(acc.access_token, mpId);
        if (r.ok) {
          const j = await r.json();
          return j.status || null;
        }
        // 401/404 — tenta a próxima conta
      } catch {
        // continua
      }
    }
    return null;
  };

  // CRM orders
  for (const o of orders) {
    checked++;
    const status = await checkOne(o.mercadopago_payment_id, o.mp_account_id);
    if (status === "approved") {
      try {
        await fetch(`${supabaseUrl}/functions/v1/payment-webhook?gateway=mercadopago`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ type: "payment", data: { id: o.mercadopago_payment_id } }),
        });
        confirmed++;
        console.log(`[poll] order ${o.id} confirmed via polling (mp=${o.mercadopago_payment_id})`);
      } catch (err: any) {
        errors.push({ id: o.id, err: err.message });
      }
    }
  }

  // POS sales
  for (const s of sales) {
    checked++;
    const status = await checkOne(s.mercadopago_payment_id, s.mp_account_id);
    if (status === "approved") {
      try {
        await fetch(`${supabaseUrl}/functions/v1/payment-webhook?gateway=mercadopago`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ type: "payment", data: { id: s.mercadopago_payment_id } }),
        });
        confirmed++;
        console.log(`[poll] sale ${s.id} confirmed via polling (mp=${s.mercadopago_payment_id})`);
      } catch (err: any) {
        errors.push({ id: s.id, err: err.message });
      }
    }
  }

  // ── Estornos em processamento/verificação (Fase 1): GET /v1/payments/{id}/refunds ──
  // Reaproveita este worker de 2 min — sem cron novo. Teto de 20 por execução.
  // "verificar" = a resposta do MP se perdeu (rede/5xx); aqui conferimos se o
  // estorno foi processado de verdade antes de liberar nova tentativa.
  let refundsChecked = 0;
  let refundsDone = 0;
  try {
    const { data: processingRefunds } = await supabase
      .from("gateway_refunds")
      .select("*")
      .eq("gateway", "mercadopago")
      .in("status", ["processando", "verificar"])
      .order("created_at", { ascending: true })
      .limit(20);

    for (const refund of processingRefunds || []) {
      refundsChecked++;
      const isVerificar = refund.status === "verificar";
      try {
        const account = await getMpAccountByPaymentId(supabase, refund.payment_id);
        if (!account) continue;
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${refund.payment_id}/refunds`, {
          headers: { Authorization: `Bearer ${account.access_token}` },
        });
        if (!r.ok) continue;
        const refundsList: any[] = await r.json();

        // "verificar": sem refund_id gravado — casa por mesmo valor criado
        // DEPOIS do registro. Se após 15 min não existir, marca falhou.
        const match = isVerificar
          ? (refundsList || []).find((item) =>
              Math.abs(Number(item?.amount || 0) - Number(refund.amount)) < 0.01
              && item?.date_created && new Date(item.date_created) >= new Date(refund.created_at))
          : (refundsList || []).find((item) => String(item?.id) === String(refund.refund_id));

        if (!match) {
          if (isVerificar && Date.now() - new Date(refund.created_at).getTime() > 15 * 60 * 1000) {
            await supabase.from("gateway_refunds").update({
              status: "falhou",
              error_message: "O Mercado Pago não processou este estorno (conferido após 15 min). Pode solicitar novamente.",
              updated_at: new Date().toISOString(),
            }).eq("id", refund.id).eq("status", "verificar");
          }
          continue;
        }

        const mpStatus = String(match.status || "");
        if (mpStatus === "approved") {
          await supabase.from("gateway_refunds").update({
            status: "concluido",
            refund_id: match.id != null ? String(match.id) : refund.refund_id,
            e2e_id: match.e2e_id || refund.e2e_id || null,
            mp_response: match,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", refund.id).in("status", ["processando", "verificar"]);
          await runRefundPostActions(supabase, refund, null);
          refundsDone++;
        } else if (["in_process", "pending"].includes(mpStatus)) {
          if (isVerificar) {
            await supabase.from("gateway_refunds").update({
              status: "processando",
              refund_id: match.id != null ? String(match.id) : refund.refund_id,
              e2e_id: match.e2e_id || refund.e2e_id || null,
              mp_response: match,
              updated_at: new Date().toISOString(),
            }).eq("id", refund.id).eq("status", "verificar");
          }
        } else {
          await supabase.from("gateway_refunds").update({
            status: "falhou",
            error_message: `Estorno recusado pelo Mercado Pago (status: ${mpStatus || "desconhecido"}).`,
            mp_response: match,
            updated_at: new Date().toISOString(),
          }).eq("id", refund.id).in("status", ["processando", "verificar"]);
        }
      } catch (err: any) {
        errors.push({ refund: refund.id, err: err.message });
      }
    }
  } catch (err: any) {
    errors.push({ refunds_sync: err.message });
  }

  // ── Estornos Appmax em processando/verificar: confere pelo status do pedido ──
  try {
    const { data: axRefunds } = await supabase.from("gateway_refunds").select("*")
      .eq("gateway", "appmax").in("status", ["processando", "verificar"])
      .order("created_at", { ascending: true }).limit(10);
    for (const refund of axRefunds || []) {
      refundsChecked++;
      try { if ((await closeAppmaxRefund(supabase, refund)) === "done") refundsDone++; }
      catch (err: any) { errors.push({ refund: refund.id, err: err.message }); }
    }
  } catch (err: any) {
    errors.push({ appmax_refunds_sync: err.message });
  }

  // AustPay: bounded read-only reconciliation, never resubmit uncertain refunds.
  try {
    const { data } = await supabase.from("gateway_refunds").select("id,payment_id,refund_id,amount,status,source,source_id,refund_type,reason,reason_text,cancel_order,requested_by")
      .eq("gateway", "austpay").in("status", ["processando", "verificar"]).order("updated_at", { ascending: true }).limit(10);
    for (const row of data || []) {
      refundsChecked++;
      try { if (await closeAustpayRefund(supabase, row) === "done") refundsDone++; }
      catch { errors.push({ refund: row.id, err: "Conferência AustPay indisponível" }); }
    }
  } catch { errors.push({ austpay_refunds_sync: "Consulta indisponível" }); }

  // ── Comprovantes pendentes (Fase 3): estornos concluídos sem PDF, poucos por rodada ──
  let receiptsMade = 0;
  try {
    const { data: noReceipt } = await supabase
      .from("gateway_refunds").select("id")
      .in("status", ["concluido","concluido_manual"]).is("receipt_path", null)
      .order("completed_at", { ascending: true }).limit(3);
    for (const r of noReceipt || []) {
      const res = await ensureRefundReceipt(supabase, r.id);
      if (res.ok) receiptsMade++; else errors.push({ receipt: r.id, err: res.error });
    }
    // Comprovantes no layout antigo: regera no mesmo caminho, mesmo código.
    const { data: old } = await supabase
      .from("gateway_refunds").select("id")
      .in("status", ["concluido","concluido_manual"]).not("receipt_path", "is", null)
      .lt("receipt_generated_at", RECEIPT_LAYOUT_SINCE)
      .order("completed_at", { ascending: true }).limit(3);
    for (const r of old || []) {
      const res = await ensureRefundReceipt(supabase, r.id, true);
      if (res.ok) receiptsMade++; else errors.push({ receipt: r.id, err: res.error });
    }
  } catch (err: any) {
    errors.push({ receipts: err.message });
  }

  // Repair notifications that failed before enqueue; bounded, no new cron.
  // The queue's unique key is the self-service idempotency boundary.
  try {
    const { data: events } = await supabase.from('events').select('id')
      .eq('operation_mode', 'whatsapp_autoatendimento').eq('is_active', true).limit(20);
    const eventIds = (events || []).map((e) => e.id);
    if (eventIds.length) {
      const { data: paidOrders } = await supabase.from('orders').select('id')
        .in('event_id', eventIds).eq('is_paid', true).neq('stage', 'cancelled')
        .gte('paid_at', since).order('paid_at', { ascending: false }).limit(100);
      const ids = (paidOrders || []).map((o) => o.id);
      if (ids.length) {
        const { data: credits } = await supabase.from('orders').select('id').in('id', ids)
          .is('selfservice_cashback_receipt', null).order('paid_at', { ascending: false }).limit(4);
        for (const credit of credits || []) {
          try { await grantSelfserviceCashback(supabase, credit.id); }
          catch (error) { errors.push({ cashback_pending: credit.id, details: String(error) }); }
        }
        const { data: queued, error: queueError } = await supabase.from('selfservice_message_queue')
          .select('order_id').in('order_id', ids).eq('kind', 'payment_confirmation');
        if (queueError) throw queueError;
        const done = new Set((queued || []).map((q) => q.order_id));
        for (const order of (paidOrders || []).filter((o) => !done.has(o.id)).slice(0, 4)) {
          const response = await fetch(`${supabaseUrl}/functions/v1/livete-payment-confirmation`, {
            method: 'POST', headers: { Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id }),
          });
          const result = await response.text();
          if (!response.ok) errors.push({ confirmation: order.id, status: response.status, details: result });
        }
      }
    }
  } catch (err: any) { errors.push({ confirmation_recovery: err.message }); }

  return new Response(
    JSON.stringify({ ok: true, accounts: accounts.length, checked, confirmed, refundsChecked, refundsDone, receiptsMade, errors: errors.slice(0, 5) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
