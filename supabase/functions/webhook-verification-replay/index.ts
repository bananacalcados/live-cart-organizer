// Replay em dry run (sem efeitos em pedidos/vendas): reaplica a verificação
// nova da Fase 3 aos últimos pagamentos confirmados por webhook de cada provedor
// e grava o resultado em webhook_verification_log (source='replay').
// Acesso: somente service role ou admin.
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { mpGetPayment } from "../_shared/mp-http.ts";
import { getMpAccountByPaymentId } from "../_shared/mp-account.ts";
import { appmaxLookup, posAmountOk, expectedOrderAmounts, orderAmountOk, pagarmeLookup } from "../_shared/webhook-verification.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(withAccessLog("webhook-verification-replay", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  // Token temporário de execução (app_settings.webhook_replay_token, apagado após o uso).
  const replayTok = req.headers.get("x-replay-token") || "";
  let tokOk = false;
  if (replayTok.length >= 32) {
    const { data: s } = await supabase.from("app_settings").select("value").eq("key", "webhook_replay_token").maybeSingle();
    tokOk = typeof s?.value === "string" && s.value === replayTok;
  }
  if (token !== key && !tokOk) {
    const { data: u } = await supabase.auth.getUser(token);
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "forbidden" }, 403);
  }
  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider || "mercadopago");
  const limit = Math.min(200, Number(body.limit) || 200);
  const offset = Math.max(0, Number(body.offset) || 0);
  const runId = String(body.run_id || crypto.randomUUID());

  const gw = provider === "mercadopago" ? "mercadopago" : provider;
  let q = supabase.from("pos_checkout_attempts").select("sale_id, transaction_id, amount, created_at, metadata")
    .eq("gateway", gw).eq("status", "success").not("transaction_id", "is", null)
    .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (provider !== "pagarme") q = q.eq("metadata->>source", "webhook");
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of rows || []) {
    const tx = String(r.transaction_id);
    if (seen.has(tx)) continue;
    seen.add(tx);
    const id = String(r.sale_id || "");
    const { data: ord } = await supabase.from("orders").select("id, is_paid, appmax_order_id, pagarme_order_id, mercadopago_payment_id").eq("id", id).maybeSingle();
    const { data: sale } = ord ? { data: null } : await supabase.from("pos_sales").select("id, status, total, appmax_order_id, pagarme_order_id").eq("id", id).maybeSingle();
    const paidNow = ord ? !!ord.is_paid : ["paid", "completed"].includes(String(sale?.status || ""));
    let apiStatus: string | null = null, apiAmount: number | null = null, verified = false, err = "";
    let extRef = "";
    try {
      if (provider === "mercadopago") {
        const acc = await getMpAccountByPaymentId(supabase, tx);
        const res = acc ? await mpGetPayment(acc.access_token, tx) : null;
        if (res?.ok) { const p = await res.json(); apiStatus = p.status; apiAmount = Number(p.transaction_amount || 0); verified = p.status === "approved"; extRef = String(p.external_reference || ""); }
        else err = `HTTP ${res?.status ?? "sem conta"}`;
      } else if (provider === "appmax") {
        const amxId = String(ord?.appmax_order_id || sale?.appmax_order_id || tx);
        const exp0 = ord ? await expectedOrderAmounts(supabase, ord.id) : null;
        const a = await appmaxLookup(supabase, amxId, exp0?.base ?? Number(sale?.total || 0));
        apiStatus = a.status; apiAmount = a.amount; verified = a.found && a.paid; err = a.error || "";
      } else {
        let pid = /^(or_|ch_)/.test(tx) ? tx : "";
        if (!pid) {
          const code = String(ord?.pagarme_order_id || sale?.pagarme_order_id || id);
          const k = Deno.env.get("PAGARME_SECRET_KEY")!;
          const lr = await fetch(`https://api.pagar.me/core/v5/orders?code=${encodeURIComponent(code)}&size=5`, { headers: { Authorization: `Basic ${btoa(k + ":")}` } });
          const lj = lr.ok ? await lr.json() : null;
          pid = String((lj?.data || []).find((o: any) => o.status === "paid")?.id || lj?.data?.[0]?.id || "");
        }
        if (pid) { const a = await pagarmeLookup(pid); apiStatus = a.status; apiAmount = a.amount; verified = a.found && a.paid; err = a.error || ""; }
        else err = "pagarme_order_not_found";
      }
    } catch (e: any) { err = e?.message || "erro"; }

    let decision = "confirm", reason = "", expected: number | null = null;
    const laterRefund = /estorn|refund|charged_back|chargeback/i.test(String(apiStatus || ""));
    if (laterRefund) { decision = "skip"; reason = `estornado_depois (${apiStatus})`; }
    else if (!verified) { decision = "reject_unverified"; reason = err || `api_status=${apiStatus}`; }
    else if (ord) {
      const exp = await expectedOrderAmounts(supabase, ord.id);
      expected = exp?.min ?? null;
      const idOk = provider !== "mercadopago" || ord.mercadopago_payment_id === tx || extRef === ord.id;
      if (!exp || !orderAmountOk(apiAmount || 0, exp)) { decision = "reject_amount"; reason = `api=${apiAmount} esperado>=${exp?.min} base=${exp?.base}`; }
      else if (!idOk) { decision = "reject_unverified"; reason = "id_ref_mismatch"; }
    } else if (sale) {
      expected = Number(sale.total || 0);
      let ok = posAmountOk(apiAmount || 0, expected);
      if (!ok && r.amount != null) ok = posAmountOk(apiAmount || 0, Number(r.amount));
      if (!ok) { decision = "reject_amount"; reason = `api=${apiAmount} total=${expected} tentativa=${r.amount}`; }
    } else { decision = "reject_unverified"; reason = "registro_nao_encontrado"; }

    const row = {
      provider, source: "replay", event_type: "replay", transaction_id: tx, order_id: ord?.id ?? null, sale_id: sale?.id ?? null,
      verified, api_status: apiStatus, api_amount: apiAmount, expected_amount: expected, old_decision: "confirm",
      new_decision: decision, reason, strict_mode: false, applied: false, details: { run_id: runId, paid_now: paidNow, attempt_at: r.created_at },
    };
    out.push(row);
  }
  if (out.length) await supabase.from("webhook_verification_log").insert(out);
  const summary: Record<string, number> = {};
  for (const o of out) summary[o.new_decision] = (summary[o.new_decision] || 0) + 1;
  return json({ provider, run_id: runId, total: out.length, summary, rejected: out.filter((o) => o.new_decision !== "confirm").map((o) => ({ tx: o.transaction_id, order: o.order_id, sale: o.sale_id, reason: o.reason, paid_now: o.details.paid_now })) });
}));
