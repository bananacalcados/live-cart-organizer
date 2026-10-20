// Estorno Mercado Pago pelo sistema — Fase 1.
// Segurança: exige JWT de usuário logado + permissão "estornos" (user_module_permissions)
// ou papel admin. Interruptor geral e teto de aprovação na tabela refund_settings
// (escrita SÓ via service role aqui, ação set_config, só admin; padrão desligado,
// teto vazio = não-admin sempre aguarda aprovação). Estorno aguardando aprovação
// NUNCA chama o Mercado Pago. Falha de rede/5xx do MP vira status "verificar"
// (nunca "falhou") — o worker confere se o estorno foi processado antes de
// permitir nova tentativa (índice único parcial por payment_id).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getMpAccountForOrder, getMpAccountForSale } from "../_shared/mp-account.ts";
import { buildMpHeaders, mpGetPayment } from "../_shared/mp-http.ts";
import { runRefundPostActions } from "../_shared/refund-post-actions.ts";
import { loadMpSalePayments, MP_SALE_AMBIGUOUS } from "../_shared/mp-sale-payment.ts";
import { ensureRefundReceipt, signedReceiptUrl } from "../_shared/refund-receipt.ts";
import { planReceiptSend, executeReceiptSend } from "../_shared/refund-receipt-send.ts";

const MAX_REFUND_AGE_DAYS = 180;

const REASONS = ["cancelamento_antes_envio", "devolucao", "troca_com_diferenca", "outro"] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface SourceRow {
  id: string;
  paymentOrderId?: string | null;
  paymentError?: string | null;
  paymentId: string | null;
  mpAccountId: string | null;
  total: number;
  label: string;
  channel: "live" | "pdv";
  customerName: string | null;
  isPaid: boolean;
  stageOrStatus: string | null;
  shipped: boolean;
  createdAt: string | null;
}

async function loadSource(supabase: any, source: string, id: string): Promise<SourceRow | null> {
  if (source === "order") {
    const { data } = await supabase
      .from("orders")
      .select("id, mercadopago_payment_id, mp_account_id, products, discount_type, discount_value, free_shipping, shipping_cost, stage, is_paid, paid_externally, created_at, customer:customers(full_name)")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    // Valor final = produtos - desconto + frete (mesma fórmula do front)
    const productsTotal = (Array.isArray(data.products) ? data.products : []).reduce(
      (sum: number, p: any) => sum + (Number(p?.price) || 0) * (Number(p?.quantity) || 0), 0);
    const discount = data.discount_type && data.discount_value
      ? (data.discount_type === "percentage" ? productsTotal * (Number(data.discount_value) / 100) : Number(data.discount_value))
      : 0;
    const shipping = data.free_shipping ? 0 : Number(data.shipping_cost || 0);
    const total = Math.max(0, productsTotal - discount + shipping);
    return {
      id: data.id,
      paymentId: data.mercadopago_payment_id,
      mpAccountId: data.mp_account_id,
      total,
      label: "Pedido da Live",
      channel: "live",
      customerName: data.customer?.full_name || null,
      isPaid: !!(data.is_paid || data.paid_externally),
      stageOrStatus: data.stage || null,
      shipped: ["shipped", "delivered"].includes(String(data.stage || "")),
      createdAt: data.created_at,
    };
  }
  const { data } = await supabase
    .from("pos_sales")
    .select("id, mercadopago_payment_id, mp_account_id, total, status, payment_method, created_at, paid_at, shipped_at, customer_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const payments = await loadMpSalePayments(supabase, [data]);
  const resolved = payments.get(data.id);
  return {
    id: data.id,
    paymentId: resolved?.paymentId ?? null,
    mpAccountId: resolved?.accountId ?? null,
    paymentOrderId: resolved?.orderId,
    paymentError: resolved?.error,
    total: Number(data.total || 0),
    label: data.payment_method ? `Venda PDV (${data.payment_method})` : "Venda PDV",
    channel: "pdv",
    customerName: data.customer_name || null,
    isPaid: !!data.paid_at || ["paid", "completed", "shipped", "delivered"].includes(String(data.status || "")),
    stageOrStatus: data.status || null,
    shipped: !!data.shipped_at || ["shipped", "delivered"].includes(String(data.status || "")),
    createdAt: data.created_at,
  };
}

async function isPointSale(supabase: any, source: string, sourceId: string, paymentId: string | null): Promise<boolean> {
  if (source !== "pos_sale") return false;
  const bySale = await supabase.from("point_payment_intents").select("id").eq("sale_id", sourceId).limit(1);
  if (bySale.data && bySale.data.length > 0) return true;
  if (paymentId) {
    const byPayment = await supabase.from("point_payment_intents").select("id").eq("mp_payment_id", paymentId).limit(1);
    if (byPayment.data && byPayment.data.length > 0) return true;
  }
  return false;
}

async function getConfig(supabase: any): Promise<{ enabled: boolean; approval_threshold: number | null; receipt_footer_contact: string; receipt_message_template: string }> {
  const { data } = await supabase.rpc("refund_config");
  return {
    enabled: !!data?.enabled,
    approval_threshold: data?.approval_threshold == null ? null : Number(data.approval_threshold),
    receipt_footer_contact: String(data?.receipt_footer_contact || ""),
    receipt_message_template: String(data?.receipt_message_template || ""),
  };
}

function extractUuid(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = String(text).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

interface MpCheck {
  ok: boolean;
  error?: string;
  payment?: any;
  account?: any;
  remaining?: number;
  refundedSoFar?: number;
}

async function checkPayment(
  supabase: any,
  src: SourceRow,
  requestedAmount: number | null,
): Promise<MpCheck> {
  if (src.paymentError) return { ok: false, error: src.paymentError };
  if (!src.paymentId) return { ok: false, error: "Esta venda/pedido não tem pagamento do Mercado Pago vinculado." };

  const account = src.channel === "live" || src.paymentOrderId
    ? await getMpAccountForOrder(supabase, src.paymentOrderId || src.id)
    : await getMpAccountForSale(supabase, src.id);
  if (!account) return { ok: false, error: "Conta do Mercado Pago não encontrada para esta venda." };

  const resp = await mpGetPayment(account.access_token, src.paymentId);
  if (!resp.ok) {
    return { ok: false, error: `Não consegui consultar o pagamento no Mercado Pago (HTTP ${resp.status}).` };
  }
  const payment = await resp.json();

  if (!["approved", "partially_refunded"].includes(payment.status)) {
    return { ok: false, error: `O pagamento está com status "${payment.status}" no Mercado Pago — só é possível estornar pagamentos aprovados.`, payment, account };
  }

  // Coerência: se o external_reference tem um UUID e ele pertence a OUTRA
  // venda/pedido do sistema, bloqueia. (Links de pagamento usam referências
  // próprias — UUID desconhecido não bloqueia.)
  const refUuid = extractUuid(payment.external_reference);
  if (refUuid && refUuid !== src.id.toLowerCase()) {
    const [otherSale, otherOrder] = await Promise.all([
      supabase.from("pos_sales").select("id").eq("id", refUuid).maybeSingle(),
      supabase.from("orders").select("id, pos_sale_id").eq("id", refUuid).maybeSingle(),
    ]);
    // Pedido da live convertido em venda do PDV é a MESMA compra — libera.
    const samePurchase = otherOrder.data && otherOrder.data.pos_sale_id === src.id;
    if ((otherSale.data || otherOrder.data) && !samePurchase) {
      return { ok: false, error: "A referência do pagamento no Mercado Pago pertence a outra venda/pedido. Estorno bloqueado por segurança.", payment, account };
    }
  }

  const approvedAt = payment.date_approved ? new Date(payment.date_approved) : null;
  if (approvedAt && (Date.now() - approvedAt.getTime()) > MAX_REFUND_AGE_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, error: `Pagamento aprovado há mais de ${MAX_REFUND_AGE_DAYS} dias — o Mercado Pago não permite mais estorno.`, payment, account };
  }

  const txAmount = Number(payment.transaction_amount || 0);
  const refundedSoFar = Number(payment.transaction_details?.total_refunded_amount || 0);
  const remaining = Math.max(0, Math.round((txAmount - refundedSoFar) * 100) / 100);

  if (remaining <= 0) {
    return { ok: false, error: "Este pagamento já foi totalmente estornado.", payment, account, remaining, refundedSoFar };
  }
  if (requestedAmount != null) {
    if (!(requestedAmount > 0)) return { ok: false, error: "Informe um valor de estorno maior que zero.", payment, account, remaining, refundedSoFar };
    if (requestedAmount > remaining + 0.009) {
      return { ok: false, error: `Valor solicitado (${brl(requestedAmount)}) maior que o valor ainda não estornado (${brl(remaining)}).`, payment, account, remaining, refundedSoFar };
    }
  }
  return { ok: true, payment, account, remaining, refundedSoFar };
}


async function executeMpRefund(supabase: any, row: any, account: any, payment: any, userEmail: string | null) {
  const isPix = payment.payment_method_id === "pix" || payment.payment_type_id === "bank_transfer";
  const headers = buildMpHeaders({ accessToken: account.access_token, idempotencyKey: row.idempotency_key });
  if (isPix) headers["X-Render-In-Process-Refunds"] = "true";

  const isFull = Math.abs(Number(row.amount) - Number(payment.transaction_amount)) < 0.01
    || Math.abs(Number(row.amount) - (Number(payment.transaction_amount) - Number(payment.transaction_details?.total_refunded_amount || 0))) < 0.01;
  const body = isFull ? {} : { amount: Number(row.amount) };

  let resp: Response;
  try {
    resp = await fetch(`https://api.mercadopago.com/v1/payments/${row.payment_id}/refunds`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    // Falha de rede/timeout: o MP PODE ter processado e só a resposta se perdeu.
    // Marca "verificar" (mantém a idempotency_key) — o worker confere antes de
    // permitir qualquer nova tentativa. NUNCA marcar "falhou" aqui.
    await supabase.from("gateway_refunds").update({ status: "verificar", error_message: `Falha de rede ao chamar o Mercado Pago: ${e?.message}`, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, verificar: true, error: "Falha de comunicação com o Mercado Pago. O estorno ficou em verificação — NÃO refaça o estorno; o sistema confere sozinho se ele foi processado." };
  }

  const respBody = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    // 5xx do MP: mesma incerteza da falha de rede — pode ter processado.
    if (resp.status >= 500) {
      await supabase.from("gateway_refunds").update({ status: "verificar", error_message: `Mercado Pago instável (HTTP ${resp.status}) — verificando se o estorno foi processado.`, mp_response: respBody, updated_at: new Date().toISOString() }).eq("id", row.id);
      return { ok: false, verificar: true, error: "O Mercado Pago está instável. O estorno ficou em verificação — NÃO refaça o estorno; o sistema confere sozinho se ele foi processado." };
    }
    const rawMsg = String(respBody?.message || respBody?.error || `HTTP ${resp.status}`);
    const insufficient = /insufficient|saldo|balance/i.test(rawMsg) || respBody?.causes?.some?.((c: any) => /insufficient|balance/i.test(String(c?.code || c?.description || "")));
    const friendly = insufficient
      ? `Saldo insuficiente na conta ${account.account_name} do Mercado Pago para este estorno.`
      : `Mercado Pago recusou o estorno: ${rawMsg}`;
    await supabase.from("gateway_refunds").update({ status: "falhou", error_message: friendly, mp_response: respBody, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, error: friendly };
  }

  const mpStatus = String(respBody?.status || "");
  const done = mpStatus === "approved";
  const processing = !done && ["in_process", "pending"].includes(mpStatus);
  const newStatus = done ? "concluido" : processing ? "processando" : "falhou";

  await supabase.from("gateway_refunds").update({
    status: newStatus,
    refund_id: respBody?.id != null ? String(respBody.id) : null,
    e2e_id: respBody?.e2e_id || null,
    mp_response: respBody,
    error_message: newStatus === "falhou" ? `Status inesperado do Mercado Pago: ${mpStatus || "desconhecido"}` : null,
    completed_at: done ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);

  if (done) await runRefundPostActions(supabase, row, userEmail);

  return {
    ok: true,
    status: newStatus,
    message: done
      ? "Estorno concluído no Mercado Pago."
      : processing
        ? "Estorno em processamento no Mercado Pago (Pix pode levar alguns minutos). O sistema acompanha e atualiza sozinho."
        : "O Mercado Pago retornou um status inesperado — verifique a lista de estornos.",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Não autorizado." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) return json({ error: "Não autorizado." }, 401);
  const userId = claimsData.claims.sub as string;
  const userEmail = (claimsData.claims.email as string) || null;

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  const { data: canRefund } = await supabase.rpc("has_module_access", { _user_id: userId, _module: "estornos" });
  if (!isAdmin && !canRefund) {
    return json({ error: "Você não tem permissão de estornos. Peça a um administrador." }, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Corpo inválido." }, 400); }
  const action = String(body?.action || "");

  // ── Configuração (leitura: quem tem permissão; escrita: só admin) ──
  if (action === "get_config") {
    const cfg = await getConfig(supabase);
    return json({ ok: true, config: cfg, isAdmin: !!isAdmin });
  }

  if (action === "set_config") {
    if (!isAdmin) return json({ error: "Só administradores podem alterar as configurações de estorno." }, 403);
    // Escrita SÓ aqui (service role + admin). A tabela refund_settings não tem
    // grant de escrita para usuários logados — ninguém altera pelo navegador.
    const updates: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: userId };
    if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
    if (body.approval_threshold === null || typeof body.approval_threshold === "number") {
      updates.approval_threshold = body.approval_threshold;
    }
    if (typeof body.receipt_footer_contact === "string") {
      updates.receipt_footer_contact = body.receipt_footer_contact.slice(0, 300);
    }
    if (typeof body.receipt_message_template === "string") {
      updates.receipt_message_template = body.receipt_message_template.slice(0, 1000) || null;
    }
    const { error: upErr } = await supabase.from("refund_settings").upsert({ id: true, ...updates }, { onConflict: "id" });
    if (upErr) return json({ error: `Falha ao salvar configuração: ${upErr.message}` }, 500);
    return json({ ok: true, config: await getConfig(supabase) });
  }

  // ── Comprovante interno (Fase 3): só estorno concluído ──
  if (action === "receipt") {
    const refundId = String(body?.id || "");
    if (!refundId) return json({ error: "Estorno não informado." }, 400);
    const r = await ensureRefundReceipt(supabase, refundId);
    if (!r.ok || !r.path) return json({ error: r.error || "Não consegui gerar o comprovante." }, 400);
    const url = await signedReceiptUrl(supabase, r.path);
    if (!url) return json({ error: "Não consegui gerar o link do comprovante." }, 500);
    return json({ ok: true, url, code: r.code, path: r.path });
  }

  // ── Fase 4: prévia e envio do comprovante pelo WhatsApp (sempre manual) ──
  if (action === "receipt_send_preview" || action === "send_receipt") {
    const refundId = String(body?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(refundId)) return json({ error: "Estorno não informado." }, 400);
    const numberId = typeof body?.whatsapp_number_id === "string" && /^[0-9a-f-]{36}$/i.test(body.whatsapp_number_id) ? body.whatsapp_number_id : null;
    const plan = await planReceiptSend(supabase, refundId, numberId);
    if (!plan.ok) return json({ error: plan.error }, 400);
    const info = {
      ok: true, blocked: plan.blocked || null, phone_masked: plan.phoneMasked, instance: plan.instance,
      message: plan.message, file_name: plan.fileName, customer_name: plan.customerName,
      already_sent_at: plan.refund?.receipt_sent_at || null, already_sent_to: plan.refund?.receipt_sent_to || null,
    };
    if (action === "receipt_send_preview") return json(info);
    if (plan.blocked) return json({ error: plan.blocked }, 400);
    if (plan.refund?.receipt_sent_at && body?.confirm_resend !== true) {
      return json({ error: "Este comprovante já foi enviado. Confirme o reenvio." }, 409);
    }
    const text = String(body?.message ?? plan.message ?? "").trim().slice(0, 1000);
    if (!text) return json({ error: "Escreva a mensagem." }, 400);
    const r = await executeReceiptSend(supabase, plan, text, userId, userEmail);
    if (!r.ok) return json({ error: r.error }, 502);
    return json({ ok: true, sent_at: r.sent_at });
  }

  // ── Estornos concluídos de vendas/pedidos (uma consulta, até 100 ids) ──
  if (action === "completed_for_sources") {
    const ids = (Array.isArray(body?.ids) ? body.ids : []).map(String).filter((s: string) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 100);
    if (ids.length === 0) return json({ ok: true, refunds: [] });
    const { data } = await supabase.from("gateway_refunds")
      .select("id, source, source_id, amount, completed_at, receipt_code, receipt_path, receipt_sent_at")
      .in("source_id", ids).eq("status", "concluido")
      .order("completed_at", { ascending: false }).limit(200);
    return json({ ok: true, refunds: data || [] });
  }

  // ── Lista de estornos (Expedição > ESTORNOS + aviso do Admin) ──
  // scope: pending | active | history. Não-admin vê SÓ as próprias solicitações (filtro no servidor).
  if (action === "list") {
    const scope = ["pending", "active", "history"].includes(body?.scope) ? body.scope : null;
    const STATUS_BY_SCOPE: Record<string, string[]> = {
      pending: ["aguardando_aprovacao"],
      active: ["processando", "verificar"],
      history: ["concluido", "recusado", "falhou"],
    };
    const mine = (q: any) => (isAdmin ? q : q.eq("requested_by", userId));
    const maskPhone = (p: string | null | undefined) => {
      const d = String(p || "").replace(/\D/g, "");
      return d.length >= 8 ? `${d.slice(0, 4)}*****${d.slice(-4)}` : (d ? "****" : "");
    };
    const enrich = async (rows: any[]) => {
      const saleIds = [...new Set(rows.filter((r) => r.source === "pos_sale").map((r) => r.source_id))];
      const orderIds = [...new Set(rows.filter((r) => r.source === "order").map((r) => r.source_id))];
      const userIds = [...new Set(rows.flatMap((r) => [r.requested_by, r.approved_by]).filter(Boolean))];
      const [salesR, ordersR, profR] = await Promise.all([
        saleIds.length ? supabase.from("pos_sales").select("id, customer_name, customer_phone, customer_cpf").in("id", saleIds) : Promise.resolve({ data: [] }),
        orderIds.length ? supabase.from("orders").select("id, customer:customers(full_name, whatsapp, instagram_handle)").in("id", orderIds) : Promise.resolve({ data: [] }),
        userIds.length ? supabase.from("profiles").select("user_id, display_name").in("user_id", userIds) : Promise.resolve({ data: [] }),
      ]);
      const src = new Map<string, { name: string | null; phone: string | null; cpf: string | null }>();
      for (const s of (salesR as any).data || []) src.set(s.id, { name: s.customer_name, phone: s.customer_phone, cpf: s.customer_cpf });
      for (const o of (ordersR as any).data || []) src.set(o.id, { name: o.customer?.full_name || (o.customer?.instagram_handle ? `@${o.customer.instagram_handle}` : null), phone: o.customer?.whatsapp || null, cpf: null });
      const names = new Map<string, string>();
      for (const p of (profR as any).data || []) if (p.display_name) names.set(p.user_id, p.display_name);
      return rows.map((r) => {
        const s = src.get(r.source_id);
        return {
          ...r,
          customer_name: s?.name || null,
          phone_masked: maskPhone(s?.phone),
          source_label: `${r.source === "order" ? "Pedido" : "Venda"} #${String(r.source_id).slice(0, 8).toUpperCase()}`,
          requested_by_name: names.get(r.requested_by) || null,
          approved_by_name: names.get(r.approved_by) || null,
          _search: `${(s?.name || "").toLowerCase()} ${String(s?.phone || "").replace(/\D/g, "")} ${String(s?.cpf || "").replace(/\D/g, "")}`,
        };
      });
    };

    if (scope) {
      const limit = Math.min(100, Math.max(1, Number(body?.limit) || 50));
      const page = Math.max(0, Number(body?.page) || 0);
      let statuses = STATUS_BY_SCOPE[scope];
      if (scope === "history" && typeof body?.status === "string" && statuses.includes(body.status)) statuses = [body.status];
      const cols = "id, gateway, source, source_id, payment_id, amount, refund_type, reason, reason_text, status, error_message, card_brand, card_last4, installments, requested_by, approved_by, approved_at, rejected_reason, created_at, completed_at, receipt_code, receipt_path, receipt_sent_at, receipt_sent_to";
      let q: any = mine(supabase.from("gateway_refunds").select(cols).in("status", statuses));
      if (body?.channel === "live") q = q.eq("source", "order");
      if (body?.channel === "pdv") q = q.eq("source", "pos_sale");
      if (typeof body?.from === "string" && !isNaN(Date.parse(body.from))) q = q.gte("created_at", body.from);
      if (typeof body?.to === "string" && !isNaN(Date.parse(body.to))) q = q.lte("created_at", body.to);
      q = q.order("created_at", { ascending: false });
      const search = String(body?.search || "").trim().toLowerCase().slice(0, 60);
      let rows: any[]; let hasMore: boolean;
      if (search) {
        // Tabela pequena: busca sobre no máx. 500 candidatos já filtrados, resolvidos em lote.
        const { data } = await q.limit(500);
        const digits = search.replace(/\D/g, "");
        const all = (await enrich(data || [])).filter((r) => r._search.includes(search) || (digits.length >= 3 && r._search.includes(digits)));
        rows = all.slice(page * limit, page * limit + limit);
        hasMore = all.length > (page + 1) * limit;
      } else {
        const { data } = await q.range(page * limit, page * limit + limit);
        const list = data || [];
        hasMore = list.length > limit;
        rows = await enrich(list.slice(0, limit));
      }
      return json({ ok: true, rows: rows.map(({ _search, ...r }) => r), hasMore, isAdmin: !!isAdmin });
    }

    // Admin > Pagamentos: só o aviso de Pix concluído pronto para enviar.
    const { data: readySrc } = await mine(supabase.from("gateway_refunds")
      .select("id, source, source_id, amount, requested_by, approved_by")
      .eq("status", "concluido").is("card_brand", null).not("receipt_path", "is", null).is("receipt_sent_at", null))
      .order("created_at", { ascending: false }).limit(20);
    const readyRows = await enrich(readySrc || []);
    const readyToSend = readyRows.map((r: any) => ({ id: r.id, amount: r.amount, customer_name: r.customer_name }));
    return json({ ok: true, pending: [], recent: [], readyToSend, isAdmin: !!isAdmin });
  }

  // ── Preview: dados do pagamento para a tela de confirmação ──
  // ── Elegibilidade em lote (Fase C: Novo estorno) ──
  // Entrada: items [{source:"order"|"pos_sale", id}] (máx. 60). Tudo decidido com
  // consultas em lote; MP consultado só p/ candidatos reais, no máximo 10 por chamada.
  if (action === "eligibility") {
    const raw = Array.isArray(body?.items) ? body.items : [];
    const items = raw
      .filter((i: any) => ["order", "pos_sale"].includes(String(i?.source)) && typeof i?.id === "string" && /^[0-9a-f-]{36}$/i.test(i.id))
      .slice(0, 60) as { source: "order" | "pos_sale"; id: string }[];
    if (!items.length) return json({ ok: true, results: [] });
    const saleIds = items.filter((i) => i.source === "pos_sale").map((i) => i.id);
    const orderIds = items.filter((i) => i.source === "order").map((i) => i.id);
    const GW_COLS = "id, mercadopago_payment_id, mp_account_id, appmax_order_id, pagarme_order_id, austpay_transaction_id, vindi_transaction_id";
    const none = Promise.resolve({ data: [] as any[] });
    const [salesR, ordersR, splitsS, splitsO, pointR]: any[] = await Promise.all([
      saleIds.length ? supabase.from("pos_sales").select(`${GW_COLS}, total, created_at`).in("id", saleIds) : none,
      orderIds.length ? supabase.from("orders").select(`${GW_COLS}, products, discount_type, discount_value, free_shipping, shipping_cost, created_at`).in("id", orderIds) : none,
      saleIds.length ? supabase.from("payment_splits").select("sale_id").in("sale_id", saleIds).limit(500) : none,
      orderIds.length ? supabase.from("payment_splits").select("order_id").in("order_id", orderIds).limit(500) : none,
      saleIds.length ? supabase.from("point_payment_intents").select("sale_id").in("sale_id", saleIds).limit(500) : none,
    ]);
    const sales = new Map<string, any>((salesR.data || []).map((s: any) => [s.id, s]));
    const orders = new Map<string, any>((ordersR.data || []).map((o: any) => [o.id, o]));
    const splitCount = new Map<string, number>();
    for (const r of [...(splitsS.data || []).map((x: any) => x.sale_id), ...(splitsO.data || []).map((x: any) => x.order_id)]) splitCount.set(r, (splitCount.get(r) || 0) + 1);
    const pointSales = new Set((pointR.data || []).map((x: any) => x.sale_id));
    const salePay = await loadMpSalePayments(supabase, [...sales.values()]);

    const orderTotal = (d: any) => {
      const pt = (Array.isArray(d.products) ? d.products : []).reduce((s: number, p: any) => s + (Number(p?.price) || 0) * (Number(p?.quantity) || 0), 0);
      const disc = d.discount_type && d.discount_value ? (d.discount_type === "percentage" ? pt * (Number(d.discount_value) / 100) : Number(d.discount_value)) : 0;
      return Math.max(0, pt - disc + (d.free_shipping ? 0 : Number(d.shipping_cost || 0)));
    };
    // Decide pelo código de transação existente, nunca pelo rótulo payment_gateway.
    const otherGateway = (r: any) => r.appmax_order_id ? "Appmax" : r.pagarme_order_id ? "Pagar.me" : r.austpay_transaction_id ? "Rinne" : r.vindi_transaction_id ? "Vindi" : null;

    type Res = { source: string; id: string; eligible: boolean; reason?: string; retry?: boolean; gateway?: string | null; remaining?: number; method?: string; cardLast4?: string | null; installments?: number | null; dateApproved?: string | null };
    const results: Res[] = [];
    const candidates: { res: Res; src: SourceRow }[] = [];
    const MULTI = "Venda tem mais de um pagamento — estorno pelo sistema indisponível";
    for (const it of items) {
      const res: Res = { source: it.source, id: it.id, eligible: false, gateway: null };
      results.push(res);
      const row = it.source === "pos_sale" ? sales.get(it.id) : orders.get(it.id);
      if (!row) { res.reason = "Venda/pedido não encontrado"; continue; }
      if ((splitCount.get(it.id) || 0) > 1) { res.reason = MULTI; continue; }
      if (it.source === "pos_sale" && pointSales.has(it.id)) { res.gateway = "Point"; res.reason = "Maquininha Point — ainda não suportado"; continue; }
      let paymentId: string | null; let accountId: string | null; let paymentOrderId: string | null = null;
      if (it.source === "pos_sale") {
        const p: any = salePay.get(it.id);
        if (p?.error) { res.reason = p.error === MP_SALE_AMBIGUOUS ? MULTI : "Não foi possível consultar o gateway agora"; res.retry = p.error !== MP_SALE_AMBIGUOUS; continue; }
        paymentId = p?.paymentId ?? null; accountId = p?.accountId ?? null; paymentOrderId = p?.orderId ?? null;
      } else { paymentId = row.mercadopago_payment_id; accountId = row.mp_account_id; }
      if (!paymentId) {
        const g = otherGateway(row);
        res.gateway = g;
        res.reason = g ? `${g} — em breve` : "Pago fora do sistema / sem transação de gateway";
        continue;
      }
      res.gateway = "Mercado Pago";
      candidates.push({ res, src: {
        id: row.id, paymentId: String(paymentId), mpAccountId: accountId, paymentOrderId,
        total: it.source === "order" ? orderTotal(row) : Number(row.total || 0),
        label: "", channel: it.source === "order" ? "live" : "pdv", customerName: null,
        isPaid: true, stageOrStatus: null, shipped: false, createdAt: row.created_at,
      } });
    }

    // Estornos em andamento por payment_id (cobre pedido↔venda da mesma compra) e Point por payment_id.
    const payIds = [...new Set(candidates.map((c) => c.src.paymentId!))];
    const [activeR, pointPayR]: any[] = payIds.length ? await Promise.all([
      supabase.from("gateway_refunds").select("payment_id, status").in("payment_id", payIds).in("status", ["aguardando_aprovacao", "processando", "verificar"]).limit(200),
      supabase.from("point_payment_intents").select("mp_payment_id").in("mp_payment_id", payIds).limit(200),
    ]) : [{ data: [] }, { data: [] }];
    const activeBy = new Map<string, string>((activeR.data || []).map((r: any) => [String(r.payment_id), r.status]));
    const pointPays = new Set((pointPayR.data || []).map((r: any) => String(r.mp_payment_id)));
    const ACTIVE_LABEL: Record<string, string> = { aguardando_aprovacao: "aguardando aprovação", processando: "processando", verificar: "verificação" };
    const RETRY = "Não foi possível consultar o gateway agora";

    let checked = 0;
    for (const { res, src } of candidates) {
      if (pointPays.has(src.paymentId!)) { res.gateway = "Point"; res.reason = "Maquininha Point — ainda não suportado"; continue; }
      const act = activeBy.get(src.paymentId!);
      if (act) { res.reason = `Estorno em andamento (${ACTIVE_LABEL[act] || act})`; continue; }
      if (checked >= 10) { res.retry = true; res.reason = RETRY; continue; }
      checked++;
      let check: MpCheck;
      try { check = await checkPayment(supabase, src, null); }
      catch { res.retry = true; res.reason = RETRY; continue; }
      const p = check.payment;
      if (p) {
        res.method = p.payment_method_id === "pix" || p.payment_type_id === "bank_transfer" ? "pix" : p.payment_type_id === "debit_card" ? "debito" : "cartao";
        res.cardLast4 = p.card?.last_four_digits || null; res.installments = p.installments || null; res.dateApproved = p.date_approved || null;
      }
      if (check.ok) { res.eligible = true; res.remaining = check.remaining; continue; }
      const err = check.error || "";
      if (!p && /consultar o pagamento/.test(err)) { res.retry = true; res.reason = RETRY; }
      else if (p && !["approved", "partially_refunded"].includes(p.status)) res.reason = `Pagamento não aprovado no gateway (status ${p.status})`;
      else if (/mais de \d+ dias/.test(err)) res.reason = `Mais de ${MAX_REFUND_AGE_DAYS} dias da aprovação`;
      else if (/totalmente estornado/.test(err)) { res.reason = "Já totalmente estornado"; res.remaining = 0; }
      else res.reason = err.replace(/\.$/, "");
    }
    return json({ ok: true, results });
  }

  if (action === "preview") {
    const source = String(body?.source || "");
    const id = String(body?.id || "");
    if (!["order", "pos_sale"].includes(source) || !id) return json({ error: "Origem ou identificador inválido." }, 400);

    const src = await loadSource(supabase, source, id);
    if (!src) return json({ error: "Venda/pedido não encontrado." }, 404);

    if (await isPointSale(supabase, source, id, src.paymentId)) {
      return json({ ok: false, point: true, error: "Estorno de maquininha ainda não suportado." });
    }

    const check = await checkPayment(supabase, src, null);
    const { data: existing } = await supabase
      .from("gateway_refunds")
      .select("id, amount, status, refund_type, created_at")
      .eq("payment_id", src.paymentId || "")
      .order("created_at", { ascending: false })
      .limit(20);

    const p = check.payment;
    return json({
      ok: check.ok,
      error: check.error,
      source: {
        id: src.id, label: src.label, channel: src.channel, total: src.total,
        customerName: src.customerName, isPaid: src.isPaid, shipped: src.shipped,
        stageOrStatus: src.stageOrStatus, createdAt: src.createdAt,
      },
      payment: p ? {
        id: p.id, status: p.status, method: p.payment_method_id, type: p.payment_type_id,
        amount: Number(p.transaction_amount || 0),
        dateApproved: p.date_approved || null,
        cardBrand: p.card?.cardholder?.name ? undefined : (p.payment_method_id !== "pix" ? p.payment_method_id : undefined),
        cardLast4: p.card?.last_four_digits || null,
        installments: p.installments || null,
        accountName: check.account?.account_name,
      } : null,
      remaining: check.remaining ?? null,
      refundedSoFar: check.refundedSoFar ?? null,
      existingRefunds: existing || [],
    });
  }

  // ── Executar estorno ──
  if (action === "execute") {
    const cfg = await getConfig(supabase);
    if (!cfg.enabled) return json({ error: "Os estornos estão desligados. Um administrador precisa ligar o interruptor em Admin > Pagamentos." }, 403);

    const source = String(body?.source || "");
    const id = String(body?.id || "");
    const amount = Number(body?.amount);
    const reason = String(body?.reason || "");
    const reasonText = body?.reason_text ? String(body.reason_text).slice(0, 500) : null;
    const cancelOrder = body?.cancel_order === true;

    if (!["order", "pos_sale"].includes(source) || !id) return json({ error: "Origem ou identificador inválido." }, 400);
    if (!REASONS.includes(reason as any)) return json({ error: "Motivo inválido." }, 400);
    if (reason === "outro" && !reasonText) return json({ error: "Descreva o motivo em \"outro\"." }, 400);
    if (!(amount > 0)) return json({ error: "Informe o valor do estorno." }, 400);

    const src = await loadSource(supabase, source, id);
    if (!src) return json({ error: "Venda/pedido não encontrado." }, 404);

    if (await isPointSale(supabase, source, id, src.paymentId)) {
      return json({ error: "Estorno de maquininha ainda não suportado." }, 400);
    }

    // Trava contra duplicidade: já existe estorno em andamento para este pagamento?
    // (O índice único parcial gateway_refunds_one_in_flight_per_payment garante
    // a mesma regra no banco — duas abas ao mesmo tempo não passam as duas.)
    const { data: inFlight } = await supabase
      .from("gateway_refunds")
      .select("id, status")
      .eq("payment_id", src.paymentId || "")
      .in("status", ["aguardando_aprovacao", "processando", "verificar"])
      .limit(1);
    if (inFlight && inFlight.length > 0) {
      const checking = inFlight[0].status === "verificar";
      return json({ error: checking
        ? "Existe um estorno em verificação com o Mercado Pago para este pagamento. NÃO refaça o estorno — aguarde a conferência automática."
        : "Já existe um estorno aguardando aprovação ou em processamento para este pagamento. Aguarde a conclusão antes de pedir outro." }, 409);
    }

    const check = await checkPayment(supabase, src, amount);
    if (!check.ok) return json({ error: check.error }, 400);

    const p = check.payment!;
    const remaining = check.remaining!;
    const isFull = Math.abs(amount - remaining) < 0.01;

    // Teto de aprovação: vazio => não-admin sempre aguarda aprovação.
    const needsApproval = !isAdmin && (cfg.approval_threshold == null || amount > cfg.approval_threshold);

    const row = {
      gateway: "mercadopago",
      source,
      source_id: id,
      mp_account_id: check.account!.account_id,
      payment_id: String(src.paymentId),
      amount,
      refund_type: isFull ? "integral" : "parcial",
      reason,
      reason_text: reasonText,
      status: needsApproval ? "aguardando_aprovacao" : "processando",
      idempotency_key: crypto.randomUUID(),
      card_brand: p.payment_method_id !== "pix" ? p.payment_method_id : null,
      card_last4: p.card?.last_four_digits || null,
      installments: p.installments || null,
      requested_by: userId,
      cancel_order: cancelOrder,
    };

    const { data: inserted, error: insErr } = await supabase.from("gateway_refunds").insert(row).select("id").single();
    if (insErr) {
      // Violação do índice único parcial (corrida entre duas solicitações
      // simultâneas): só um estorno em andamento por pagamento.
      if (insErr.code === "23505" || String(insErr.message).includes("gateway_refunds_one_in_flight_per_payment")) {
        return json({ error: "Já existe um estorno em andamento para este pagamento. Aguarde a conclusão antes de pedir outro." }, 409);
      }
      return json({ error: `Falha ao registrar o estorno: ${insErr.message}` }, 500);
    }

    if (needsApproval) {
      return json({ ok: true, pending_approval: true, refund_id: inserted.id, message: "Estorno registrado e aguardando aprovação de um administrador. Nenhum valor foi movido ainda." });
    }

    const result = await executeMpRefund(supabase, { ...row, id: inserted.id }, check.account, p, userEmail);
    return json({ ...result, refund_id: inserted.id });
  }

  // ── Aprovar / recusar (só admin) ──
  if (action === "approve" || action === "reject") {
    if (!isAdmin) return json({ error: "Só administradores podem aprovar ou recusar estornos." }, 403);
    const refundId = String(body?.id || "");
    if (!refundId) return json({ error: "Estorno não informado." }, 400);

    const { data: row } = await supabase.from("gateway_refunds").select("*").eq("id", refundId).maybeSingle();
    if (!row) return json({ error: "Estorno não encontrado." }, 404);
    if (row.status !== "aguardando_aprovacao") return json({ error: "Este estorno não está aguardando aprovação." }, 400);

    if (action === "reject") {
      const rejectedReason = String(body?.rejected_reason || "").trim();
      if (rejectedReason.length < 3 || rejectedReason.length > 300) {
        return json({ error: "Informe o motivo da recusa (de 3 a 300 caracteres)." }, 400);
      }
      await supabase.from("gateway_refunds").update({ status: "recusado", rejected_reason: rejectedReason, approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", refundId);
      return json({ ok: true, message: "Estorno recusado." });
    }

    const cfg = await getConfig(supabase);
    if (!cfg.enabled) return json({ error: "Os estornos estão desligados. Ligue o interruptor antes de aprovar." }, 403);

    const src = await loadSource(supabase, row.source, row.source_id);
    if (!src) return json({ error: "Venda/pedido não encontrado." }, 404);
    const check = await checkPayment(supabase, src, Number(row.amount));
    if (!check.ok) {
      await supabase.from("gateway_refunds").update({ status: "falhou", error_message: check.error, updated_at: new Date().toISOString() }).eq("id", refundId);
      return json({ error: check.error }, 400);
    }

    await supabase.from("gateway_refunds").update({ status: "processando", approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", refundId);
    const result = await executeMpRefund(supabase, row, check.account, check.payment, userEmail);
    return json(result);
  }

  return json({ error: "Ação inválida." }, 400);
});
