// Pagamento dividido — checkout público paga uma parte de cada vez (Mercado Pago).
// Pedidos sem partes não passam por aqui (fluxo atual intacto).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getActiveMpAccount, getMpAccountByPaymentId } from "../_shared/mp-account.ts";
import { buildMpHeaders, mpGetPayment } from "../_shared/mp-http.ts";
import { approveSplitPart, splitPaymentEnabled, SPLIT_REF_PREFIX } from "../_shared/split-payment.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f-]{36}$/i;
const PIX_DISCOUNT_PCT = 5;
const MAX_PARTS = 4;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const PUBLIC_COLS = "id, seq, method, amount, discount_amount, charge_amount, installments, status, paid_at, gateway_tx_id";

async function isTargetPaid(sb: any, orderId?: string, saleId?: string) {
  if (orderId) {
    const { data } = await sb.from("orders").select("is_paid").eq("id", orderId).maybeSingle();
    return { exists: !!data, paid: !!data?.is_paid };
  }
  const { data } = await sb.from("pos_sales").select("status").eq("id", saleId).maybeSingle();
  return { exists: !!data, paid: ["paid", "completed"].includes(String(data?.status || "")) };
}

function listParts(sb: any, orderId?: string, saleId?: string) {
  const q = sb.from("payment_splits").select(PUBLIC_COLS).order("seq");
  return orderId ? q.eq("order_id", orderId) : q.eq("sale_id", saleId);
}

async function loadSplit(sb: any, splitId: string) {
  if (!UUID.test(String(splitId || ""))) throw new Error("Parte inválida");
  const { data } = await sb.from("payment_splits").select("*").eq("id", splitId).maybeSingle();
  if (!data) throw new Error("Parte não encontrada");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json();
    const action = String(body.action || "");
    const orderId = body.orderId && UUID.test(body.orderId) ? String(body.orderId) : undefined;
    const saleId = !orderId && body.saleId && UUID.test(body.saleId) ? String(body.saleId) : undefined;

    // ── get: partes do pedido ──
    if (action === "get") {
      if (!orderId && !saleId) return json({ error: "orderId ou saleId obrigatório" }, 400);
      const enabled = await splitPaymentEnabled(sb);
      const { data } = await listParts(sb, orderId, saleId);
      return json({ enabled, parts: data || [], pix_discount_pct: PIX_DISCOUNT_PCT });
    }

    // ── setup: define/redefine partes (só enquanto nenhuma foi paga) ──
    if (action === "setup") {
      if (!(await splitPaymentEnabled(sb))) return json({ error: "Pagamento dividido desativado" }, 403);
      if (!orderId && !saleId) return json({ error: "orderId ou saleId obrigatório" }, 400);
      const tgt = await isTargetPaid(sb, orderId, saleId);
      if (!tgt.exists) return json({ error: "Pedido não encontrado" }, 404);
      if (tgt.paid) return json({ error: "Pedido já pago" }, 409);
      const total = r2(Number(body.total));
      const parts = Array.isArray(body.parts) ? body.parts : [];
      if (!(total > 0 && total < 100000)) return json({ error: "Total inválido" }, 400);
      if (parts.length < 2 || parts.length > MAX_PARTS) return json({ error: `Use de 2 a ${MAX_PARTS} formas` }, 400);
      const rows = [];
      let sum = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const method = String(p.method);
        if (!["pix", "credit", "debit"].includes(method)) return json({ error: `Parte ${i + 1}: forma inválida` }, 400);
        const amount = r2(Number(p.amount));
        if (!(amount >= 1)) return json({ error: `Parte ${i + 1}: valor mínimo R$ 1,00` }, 400);
        const inst = method === "credit" ? Math.floor(Number(p.installments || 1)) : 1;
        if (inst < 1 || inst > 12) return json({ error: `Parte ${i + 1}: parcelas inválidas` }, 400);
        const discount = method === "pix" ? r2(amount * PIX_DISCOUNT_PCT / 100) : 0;
        sum = r2(sum + amount);
        rows.push({
          order_id: orderId ?? null, sale_id: saleId ?? null, seq: i + 1, method, amount,
          discount_amount: discount, charge_amount: r2(amount - discount), installments: inst,
        });
      }
      if (Math.abs(sum - total) > 0.009) return json({ error: "A soma das partes precisa ser igual ao total" }, 400);
      const { data: existing } = await listParts(sb, orderId, saleId);
      if ((existing || []).some((p: any) => p.status === "approved")) return json({ error: "Já existe parte paga — divisão travada" }, 409);
      const del = sb.from("payment_splits").delete();
      await (orderId ? del.eq("order_id", orderId) : del.eq("sale_id", saleId));
      const { error } = await sb.from("payment_splits").insert(rows);
      if (error) return json({ error: error.message }, 400);
      const { data } = await listParts(sb, orderId, saleId);
      return json({ parts: data || [] });
    }

    // ── clear: volta ao pagamento normal (só sem parte paga) ──
    if (action === "clear") {
      if (!orderId && !saleId) return json({ error: "orderId ou saleId obrigatório" }, 400);
      const { data: existing } = await listParts(sb, orderId, saleId);
      if ((existing || []).some((p: any) => p.status === "approved")) return json({ error: "Já existe parte paga" }, 409);
      const del = sb.from("payment_splits").delete();
      await (orderId ? del.eq("order_id", orderId) : del.eq("sale_id", saleId));
      return json({ ok: true });
    }

    // ── create_pix: Pix só desta parte ──
    if (action === "create_pix") {
      const s = await loadSplit(sb, body.splitId);
      if (s.method !== "pix") return json({ error: "Esta parte não é Pix" }, 400);
      if (s.status === "approved") return json({ error: "Parte já paga", already_paid: true }, 409);
      const tgt = await isTargetPaid(sb, s.order_id ?? undefined, s.sale_id ?? undefined);
      if (tgt.paid) return json({ error: "Pedido já pago", already_paid: true }, 409);
      const acc = await getActiveMpAccount(sb);
      if (!acc) return json({ error: "Mercado Pago indisponível" }, 503);
      const payer = body.payer || {};
      const cpf = String(payer.cpf || "").replace(/\D/g, "");
      const name = String(payer.name || "Cliente").trim().split(/\s+/);
      const mpBody = {
        transaction_amount: Number(s.charge_amount),
        payment_method_id: "pix",
        description: `Banana Calçados — Pedido #${String(s.order_id || s.sale_id).substring(0, 8)} (parte ${s.seq})`,
        external_reference: `${SPLIT_REF_PREFIX}${s.id}`,
        notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-webhook?gateway=mercadopago`,
        date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        payer: {
          email: acc.is_sandbox ? "test@testuser.com" : (payer.email || `${cpf || "cliente"}@cliente.bananacalcados.com.br`),
          first_name: name[0] || "Cliente",
          last_name: name.slice(1).join(" ") || ".",
          ...(cpf.length === 11 ? { identification: { type: "CPF", number: cpf } } : {}),
        },
      };
      const res = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: buildMpHeaders({ accessToken: acc.access_token, idempotencyKey: `split-pix-${s.id}-${Date.now()}` }),
        body: JSON.stringify(mpBody),
      });
      const mp = await res.json();
      if (!res.ok) return json({ error: mp?.message || "Falha ao gerar Pix" }, 400);
      await sb.from("payment_splits").update({ gateway: "mercadopago", gateway_tx_id: String(mp.id), status: "pending" }).eq("id", s.id);
      const t = mp.point_of_interaction?.transaction_data;
      return json({ paymentId: String(mp.id), qrCode: t?.qr_code || null, qrCodeBase64: t?.qr_code_base64 || null, expirationDate: mp.date_of_expiration || null });
    }

    // ── check: consulta o pagamento da parte ──
    if (action === "check") {
      const s = await loadSplit(sb, body.splitId);
      if (s.status === "approved") return json({ status: "approved" });
      if (!s.gateway_tx_id) return json({ status: "pending" });
      const acc = (await getMpAccountByPaymentId(sb, s.gateway_tx_id)) || (await getActiveMpAccount(sb));
      if (!acc) return json({ status: "pending" });
      const r = await mpGetPayment(acc.access_token, s.gateway_tx_id);
      const mp = await r.json();
      if (mp?.status === "approved" && String(mp.external_reference) === `${SPLIT_REF_PREFIX}${s.id}`) {
        const out = await approveSplitPart(sb, s.id, "mercadopago", String(mp.id));
        return json({ status: "approved", ...out });
      }
      return json({ status: mp?.status || "pending" });
    }

    // ── charge_card: crédito/débito só desta parte (token do MercadoPago.JS) ──
    if (action === "charge_card") {
      const s = await loadSplit(sb, body.splitId);
      if (s.method === "pix") return json({ error: "Esta parte é Pix" }, 400);
      if (s.status === "approved") return json({ error: "Parte já paga", already_paid: true }, 409);
      const tgt = await isTargetPaid(sb, s.order_id ?? undefined, s.sale_id ?? undefined);
      if (tgt.paid) return json({ error: "Pedido já pago", already_paid: true }, 409);
      if (!body.mpCardToken || !body.mpPaymentMethodId) return json({ error: "Dados do cartão inválidos" }, 400);
      const acc = await getActiveMpAccount(sb);
      if (!acc) return json({ error: "Mercado Pago indisponível" }, 503);
      const c = body.customer || {};
      const cpf = String(c.cpf || "").replace(/\D/g, "");
      const name = String(c.name || "Cliente").trim().split(/\s+/);
      const isDebit = s.method === "debit";
      const mpBody: Record<string, unknown> = {
        transaction_amount: Number(s.charge_amount),
        token: body.mpCardToken,
        payment_method_id: body.mpPaymentMethodId,
        installments: isDebit ? 1 : s.installments,
        binary_mode: true,
        capture: true,
        statement_descriptor: "BANANACALCAD",
        description: `Banana Calçados — Pedido #${String(s.order_id || s.sale_id).substring(0, 8)} (parte ${s.seq})`,
        external_reference: `${SPLIT_REF_PREFIX}${s.id}`,
        notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-webhook?gateway=mercadopago`,
        payer: {
          email: acc.is_sandbox ? "test@testuser.com" : (c.email || `${cpf}@cliente.bananacalcados.com.br`),
          first_name: name[0] || "Cliente",
          last_name: name.slice(1).join(" ") || ".",
          ...(cpf.length === 11 ? { identification: { type: "CPF", number: cpf } } : {}),
        },
        ...(body.mpIssuerId ? { issuer_id: body.mpIssuerId } : {}),
      };
      const res = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: buildMpHeaders({
          accessToken: acc.access_token,
          idempotencyKey: `split-card-${s.id}-${String(body.attemptId || crypto.randomUUID())}`,
          deviceId: body.mpDeviceId,
        }),
        body: JSON.stringify(mpBody),
      });
      const mp = await res.json();
      if (mp?.id) await sb.from("payment_splits").update({ gateway: "mercadopago", gateway_tx_id: String(mp.id) }).eq("id", s.id);
      if (res.ok && mp?.status === "approved") {
        const out = await approveSplitPart(sb, s.id, "mercadopago", String(mp.id));
        return json({ success: true, ...out });
      }
      if (mp?.id) await sb.from("payment_splits").update({ status: "refused" }).eq("id", s.id);
      // volta para pendente para permitir nova tentativa com outro cartão
      if (mp?.id) await sb.from("payment_splits").update({ status: "pending" }).eq("id", s.id);
      return json({ success: false, error: mp?.status_detail || mp?.message || "Pagamento recusado" });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (e) {
    console.error("[split-payment]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
