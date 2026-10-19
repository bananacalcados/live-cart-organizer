// Estorno Mercado Pago pelo sistema — Fase 1.
// Segurança: exige JWT de usuário logado + permissão "estornos" (user_module_permissions)
// ou papel admin. Interruptor geral em app_settings (refunds_enabled, padrão desligado).
// Teto de aprovação em app_settings (refund_approval_threshold; vazio = não-admin sempre
// aguarda aprovação). Estorno aguardando aprovação NUNCA chama o Mercado Pago.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getMpAccountForOrder, getMpAccountForSale } from "../_shared/mp-account.ts";
import { buildMpHeaders, mpGetPayment } from "../_shared/mp-http.ts";
import { runRefundPostActions } from "../_shared/refund-post-actions.ts";

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
  return {
    id: data.id,
    paymentId: data.mercadopago_payment_id,
    mpAccountId: data.mp_account_id,
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

async function getConfig(supabase: any): Promise<{ enabled: boolean; approval_threshold: number | null }> {
  const { data } = await supabase.rpc("refund_config");
  return {
    enabled: !!data?.enabled,
    approval_threshold: data?.approval_threshold == null ? null : Number(data.approval_threshold),
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
  if (!src.paymentId) return { ok: false, error: "Esta venda/pedido não tem pagamento do Mercado Pago vinculado." };

  const account = src.channel === "live"
    ? await getMpAccountForOrder(supabase, src.id)
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
    const { error: upErr } = await supabase.from("refund_settings").upsert({ id: true, ...updates }, { onConflict: "id" });
    if (upErr) return json({ error: `Falha ao salvar configuração: ${upErr.message}` }, 500);
    return json({ ok: true, config: await getConfig(supabase) });
  }

  // ── Lista de estornos (pendentes + recentes) ──
  if (action === "list") {
    const [pendingRes, recentRes] = await Promise.all([
      supabase.from("gateway_refunds").select("*").eq("status", "aguardando_aprovacao").order("created_at", { ascending: false }).limit(50),
      supabase.from("gateway_refunds").select("*").neq("status", "aguardando_aprovacao").order("created_at", { ascending: false }).limit(50),
    ]);
    return json({ ok: true, pending: pendingRes.data || [], recent: recentRes.data || [], isAdmin: !!isAdmin });
  }

  // ── Preview: dados do pagamento para a tela de confirmação ──
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
    const { data: inFlight } = await supabase
      .from("gateway_refunds")
      .select("id, status")
      .eq("payment_id", src.paymentId || "")
      .in("status", ["aguardando_aprovacao", "processando"])
      .limit(1);
    if (inFlight && inFlight.length > 0) {
      return json({ error: "Já existe um estorno aguardando aprovação ou em processamento para este pagamento. Aguarde a conclusão antes de pedir outro." }, 409);
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
      if (String(insErr.message).includes("duplicate")) {
        return json({ error: "Este estorno já foi registrado (proteção contra duplicidade)." }, 409);
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
      await supabase.from("gateway_refunds").update({ status: "recusado", approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", refundId);
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
