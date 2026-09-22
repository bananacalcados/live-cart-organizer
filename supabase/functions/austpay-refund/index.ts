// ── AustPay (Rinne): estorno total ou parcial ─────────────────────────────
// Fase 2 do plano. Exige usuário logado. Não altera nenhum outro gateway.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/require-user.ts";
import { austpayFetch, getAustpayConfig, toCents } from "../_shared/austpay.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { orderId, transactionId, amount } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let txId = transactionId ? String(transactionId) : "";
    if (!txId && orderId) {
      const { data: order } = await supabase
        .from("orders").select("austpay_transaction_id").eq("id", orderId).maybeSingle();
      txId = String(order?.austpay_transaction_id || "");
      if (!txId) {
        const { data: sale } = await supabase
          .from("pos_sales").select("austpay_transaction_id").eq("id", orderId).maybeSingle();
        txId = String(sale?.austpay_transaction_id || "");
      }
    }
    if (!txId) return json({ error: "Transação AustPay não encontrada para este pedido." }, 400);

    const cfg = getAustpayConfig();
    if (!cfg) return json({ error: "AustPay não configurada." }, 503);

    const body: Record<string, unknown> = {};
    if (Number(amount) > 0) body.amount = toCents(Number(amount));

    const res = await austpayFetch(cfg, `/v1/transactions/${txId}/refund`, {
      method: "POST",
      body,
    });
    const text = await res.text();
    if (!res.ok) return json({ error: `AustPay ${res.status}: ${text.substring(0, 500)}` }, 502);

    console.log(`[austpay-refund] estorno solicitado para tx=${txId}`);
    return json({ ok: true, transactionId: txId, result: JSON.parse(text || "{}") });
  } catch (error) {
    console.error("[austpay-refund] erro:", error);
    return json({ error: (error as Error)?.message || String(error) }, 500);
  }
});
