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
import { checkPayment, executeMpRefund, MAX_REFUND_AGE_DAYS, type MpCheck, type SourceRow } from "../_shared/refund-gateways/mercadopago.ts";
import { appmaxCheckPayment, appmaxExecuteRefund, APPMAX_PARTIAL_ONLY_FULL } from "../_shared/refund-gateways/appmax.ts";
import { austpayCheckPayment, AUSTPAY_FULL_ONLY } from "../_shared/refund-gateways/austpay.ts";
import { executeAustpay } from "../_shared/refund-gateways/austpay-close.ts";
import { runRefundPostActions } from "../_shared/refund-post-actions.ts";
import { loadMpSalePayments, MP_SALE_AMBIGUOUS } from "../_shared/mp-sale-payment.ts";
import { ensureRefundReceipt, signedReceiptUrl } from "../_shared/refund-receipt.ts";
import { planReceiptSend, executeReceiptSend } from "../_shared/refund-receipt-send.ts";
import { applyRefundListFilters } from "../_shared/refund-list.ts";
import { validateManualRefund } from "../_shared/refund-manual.ts";


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

async function loadSource(supabase: any, source: string, id: string): Promise<SourceRow | null> {
  if (source === "order") {
    const { data } = await supabase
      .from("orders")
      .select("id, mercadopago_payment_id, mp_account_id, appmax_order_id, austpay_transaction_id, products, discount_type, discount_value, free_shipping, shipping_cost, stage, is_paid, paid_externally, created_at, customer:customers(full_name)")
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
      appmaxOrderId: data.appmax_order_id ? String(data.appmax_order_id) : null,
      austpayTransactionId: data.austpay_transaction_id, austpayReferenceIds: [data.id],
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
    .select("id, mercadopago_payment_id, mp_account_id, appmax_order_id, austpay_transaction_id, total, status, payment_method, created_at, paid_at, shipped_at, customer_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const payments = await loadMpSalePayments(supabase, [data]);
  const resolved = payments.get(data.id);
  const ax = (await loadAppmaxIds(supabase, [data])).get(data.id);
  const au = (await loadAustpayIds(supabase, [data])).get(data.id);
  return {
    id: data.id,
    paymentId: resolved?.paymentId ?? null,
    mpAccountId: resolved?.accountId ?? null,
    paymentOrderId: resolved?.orderId,
    paymentError: resolved?.error || (au?.ambiguous ? "Cobrança AustPay ambígua" : !resolved?.paymentId && ax?.ambiguous ? APPMAX_AMBIGUOUS : undefined),
    appmaxOrderId: ax?.id ?? null,
    austpayTransactionId: au?.id, austpayReferenceIds: au?.refs,
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

const APPMAX_AMBIGUOUS = "Venda tem mais de um pedido Appmax — estorno pelo sistema indisponível";

/** appmax_order_id da venda ou do pedido da live convertido nela (mesma compra), em lote. */
async function loadAppmaxIds(supabase: any, sales: { id: string; appmax_order_id?: any }[]): Promise<Map<string, { id: string | null; ambiguous: boolean }>> {
  const ids = new Map<string, Set<string>>();
  for (const s of sales) { const set = new Set<string>(); if (s.appmax_order_id) set.add(String(s.appmax_order_id)); ids.set(s.id, set); }
  if (sales.length) {
    const { data } = await supabase.from("orders").select("pos_sale_id, appmax_order_id")
      .in("pos_sale_id", sales.map((s) => s.id)).not("appmax_order_id", "is", null).limit(500);
    for (const o of data || []) ids.get(o.pos_sale_id)?.add(String(o.appmax_order_id));
  }
  const out = new Map<string, { id: string | null; ambiguous: boolean }>();
  for (const [k, set] of ids) out.set(k, { id: set.size === 1 ? [...set][0] : null, ambiguous: set.size > 1 });
  return out;
}

async function loadAustpayIds(sb: any, sales: any[]) {
  const out = new Map<string, { id: string | null; refs: string[]; ambiguous: boolean }>();
  if (!sales.length) return out;
  const { data, error } = await sb.from("orders").select("id,pos_sale_id,austpay_transaction_id").in("pos_sale_id", sales.map(s => s.id)).not("austpay_transaction_id", "is", null).limit(200);
  for (const sale of sales) {
    const linked = (data || []).filter((o: any) => o.pos_sale_id === sale.id);
    const ids = [...new Set([sale.austpay_transaction_id, ...linked.map((o: any) => o.austpay_transaction_id)].filter(Boolean))] as string[];
    out.set(sale.id, { id: ids.length === 1 ? ids[0] : null, refs: [sale.id, ...linked.map((o: any) => o.id)], ambiguous: !!error || ids.length > 1 || (data || []).length >= 200 });
  }
  return out;
}

type GwCheck = { gateway: "mercadopago" | "appmax" | "austpay"; payId: string | null; check: any };

/** Gateway REAL: MP aprovado manda; Appmax só sem MP válido/aprovado e com pedido pago lá. */
async function checkAny(supabase: any, src: SourceRow, amount: number | null): Promise<GwCheck> {
  if (src.paymentId && !src.paymentError) {
    const c = await checkPayment(supabase, src, amount);
    const mpNotApproved = c.payment && !["approved", "partially_refunded", "refunded"].includes(c.payment.status);
    if (!(mpNotApproved && (src.appmaxOrderId || src.austpayTransactionId))) return { gateway: "mercadopago", payId: src.paymentId, check: c };
  }
  if (src.austpayTransactionId && !src.paymentError) {
    return { gateway: "austpay", payId: src.austpayTransactionId, check: await austpayCheckPayment(supabase, src, amount) };
  }
  if (src.appmaxOrderId && !src.paymentError) {
    return { gateway: "appmax", payId: src.appmaxOrderId, check: await appmaxCheckPayment(supabase, src.appmaxOrderId, src.total, amount) };
  }
  return { gateway: "mercadopago", payId: src.paymentId, check: await checkPayment(supabase, src, amount) };
}

async function executeAppmax(supabase: any, row: any, userEmail: string | null) {
  const now = () => new Date().toISOString();
  const r = await appmaxExecuteRefund(supabase, String(row.payment_id), Number(row.amount));
  if (r.kind === "verificar") {
    await supabase.from("gateway_refunds").update({ status: "verificar", error_message: r.error, mp_response: r.raw ?? null, updated_at: now() }).eq("id", row.id);
    return { ok: false, verificar: true, error: "Falha de comunicação com a Appmax. O estorno ficou em verificação — NÃO refaça o estorno; o sistema confere sozinho se ele foi processado." };
  }
  if (r.kind === "failed") {
    await supabase.from("gateway_refunds").update({ status: "falhou", error_message: r.error, mp_response: r.raw ?? null, updated_at: now() }).eq("id", row.id);
    return { ok: false, error: r.error };
  }
  const done = r.kind === "done";
  await supabase.from("gateway_refunds").update({
    status: done ? "concluido" : "processando", refund_id: r.refundId, mp_response: r.raw ?? null,
    error_message: null, completed_at: done ? now() : null, updated_at: now(),
  }).eq("id", row.id);
  if (done) await runRefundPostActions(supabase, row, userEmail);
  return {
    ok: true, status: done ? "concluido" : "processando",
    message: done ? "Estorno concluído na Appmax." : "Estorno solicitado na Appmax. O sistema acompanha e marca como concluído quando a Appmax confirmar.",
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

  // This action records evidence only. No provider refund endpoint is called.
  if (action === "register_manual") {
    if (!isAdmin) return json({ error: "Só administradores podem registrar estornos manuais." }, 403);
    const validation=validateManualRefund(body);
    if (validation) return json({error:validation},400);
    if (!userEmail) return json({error:"Sessão inválida."},401);
    const passwordClient=createClient(supabaseUrl,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data: login,error: loginError}=await passwordClient.auth.signInWithPassword({email:userEmail,password:body.password});
    if (loginError || login.user?.id!==userId) return json({error:"Senha incorreta."},403);
    const src=await loadSource(supabase,body.source,body.source_id);
    if (!src || src.paymentError) return json({error:"Compra não verificável."},400);
    const linkedIds=[src.id,...(src.austpayReferenceIds||[])];
    const {data:splits,error:splitError}=await supabase.from('payment_splits').select('id').or(`sale_id.in.(${linkedIds.join(',')}),order_id.in.(${linkedIds.join(',')})`).limit(1);
    if(splitError||splits?.length) return json({error:'Compra com pagamento dividido ou não verificável; registro manual bloqueado.'},400);
    // Check the real captured gateway, ignoring window/refund-history eligibility for manual evidence.
    const gw=await checkAny(supabase,src,null);
    let gateway:string=gw.gateway, paymentId=gw.payId, p=gw.check.payment;
    let captured:number|null=null;
    if (gateway==='austpay' && p?.id===src.austpayTransactionId && ['APPROVED','REFUNDED','PARTIALLY_REFUNDED'].includes(p.status) && Number.isSafeInteger(p.approved_amount)) captured=p.approved_amount/100;
    if (gateway==='mercadopago' && p && ['approved','partially_refunded','refunded'].includes(p.status)) captured=Number(p.transaction_amount);
    if (gateway==='appmax' && p && (gw.check.ok || /estornado/.test(gw.check.error||''))) captured=Number(p.amount);
    // Other gateways: exact provider IDs persisted on the source, never gateway labels.
    if (captured===null) {
      const lookup=body.source==='order'
        ? await supabase.from('orders').select('pagarme_order_id,vindi_transaction_id').eq('id',src.id).maybeSingle()
        : await supabase.from('pos_sales').select('pagarme_order_id,vindi_transaction_id,source_order_id').eq('id',src.id).maybeSingle();
      let ids:any=lookup.data;
      if (body.source==='pos_sale' && ids?.source_order_id) {
        const linked=await supabase.from('orders').select('pagarme_order_id,vindi_transaction_id').eq('id',ids.source_order_id).maybeSingle();
        ids={...linked.data,...Object.fromEntries(Object.entries(ids).filter(([,v])=>v!=null))};
      }
      const options=[['pagarme',ids?.pagarme_order_id],['vindi',ids?.vindi_transaction_id]].filter(([,id])=>id);
      if (options.length===1 && src.isPaid) { gateway=String(options[0][0]);paymentId=String(options[0][1]);captured=src.total; }
    }
    if (!paymentId || !captured || gateway!==body.gateway || body.amount>captured || !src.isPaid) return json({error:"Gateway ou valor não confere com a compra paga."},400);
    const payload={gateway,source:body.source,source_id:src.id,payment_id:paymentId,mp_account_id:gateway==='mercadopago'?gw.check.account?.account_id:null,amount:body.amount,refund_type:Math.abs(body.amount-captured)<0.005?'integral':'parcial',reason:body.reason,reason_text:body.note?.trim()||null,manual_reference:body.manual_reference.trim(),manual_done_at:body.manual_done_at,manual_registered_by:userId,card_brand:gateway==='austpay'?p.card_data?.brand:gateway==='mercadopago'?(p.payment_method_id==='pix'?null:p.payment_method_id):p?.cardBrand||null,card_last4:p?.card_data?.last_digits||p?.card?.last_four_digits||p?.cardLast4||null,installments:p?.installments||null};
    const {data:id,error}=await supabase.rpc('register_manual_refund',{p_row:payload});
    if (error || !id) return json({error:error?.message||"Não foi possível registrar; confira se já existe estorno."},409);
    await runRefundPostActions(supabase,{...payload,id,status:'concluido_manual'},userEmail);
    return json({ok:true,refund_id:id,status:'concluido_manual',message:'Estorno feito no painel registrado; nenhum dinheiro movimentado pelo sistema.'});
  }

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
      .in("source_id", ids).in("status", ["concluido","concluido_manual"])
      .order("completed_at", { ascending: false }).limit(200);
    return json({ ok: true, refunds: data || [] });
  }

  // ── Lista de estornos (Expedição > ESTORNOS + aviso do Admin) ──
  // scope: pending | active | history. Todos com permissão leem todos; decisões só admin.
  if (action === "list") {
    const scope = ["pending", "active", "history"].includes(body?.scope) ? body.scope : null;
    const maskPhone = (p: string | null | undefined) => {
      const d = String(p || "").replace(/\D/g, "");
      return d.length >= 8 ? `${d.slice(0, 4)}*****${d.slice(-4)}` : (d ? "****" : "");
    };
    const enrich = async (rows: any[]) => {
      const saleIds = [...new Set(rows.filter((r) => r.source === "pos_sale").map((r) => r.source_id))];
      const orderIds = [...new Set(rows.filter((r) => r.source === "order").map((r) => r.source_id))];
      const userIds = [...new Set(rows.flatMap((r) => [r.requested_by, r.approved_by]).filter(Boolean))];
      const accountIds = [...new Set(rows.map((r) => r.mp_account_id).filter(Boolean))];
      const [salesR, ordersR, profR, accountsR] = await Promise.all([
        saleIds.length ? supabase.from("pos_sales").select("id, customer_name, customer_phone, customer_cpf, paid_at, created_at").in("id", saleIds) : Promise.resolve({ data: [] }),
        orderIds.length ? supabase.from("orders").select("id, paid_at, created_at, customer:customers(full_name, whatsapp, instagram_handle)").in("id", orderIds) : Promise.resolve({ data: [] }),
        userIds.length ? supabase.from("profiles").select("user_id, display_name").in("user_id", userIds) : Promise.resolve({ data: [] }),
        accountIds.length ? supabase.from("mercadopago_accounts").select("id, name").in("id", accountIds) : Promise.resolve({ data: [] }),
      ]);
      const src = new Map<string, { name: string | null; phone: string | null; cpf: string | null; paidAt: string | null }>();
      for (const s of (salesR as any).data || []) src.set(s.id, { name: s.customer_name, phone: s.customer_phone, cpf: s.customer_cpf, paidAt: s.paid_at || s.created_at });
      for (const o of (ordersR as any).data || []) src.set(o.id, { name: o.customer?.full_name || (o.customer?.instagram_handle ? `@${o.customer.instagram_handle}` : null), phone: o.customer?.whatsapp || null, cpf: null, paidAt: o.paid_at || o.created_at });
      const accounts = new Map<string, string>((accountsR.data || []).map((a: any) => [a.id, a.name]));
      const names = new Map<string, string>();
      for (const p of (profR as any).data || []) if (p.display_name) names.set(p.user_id, p.display_name);
      return rows.map((r) => {
        const s = src.get(r.source_id);
        return {
          ...r,
          customer_name: s?.name || null,
          paid_at: s?.paidAt || null,
          mp_account_name: r.gateway === "mercadopago" ? accounts.get(r.mp_account_id) || null : null,
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
      const cols = "id, gateway, mp_account_id, source, source_id, payment_id, amount, refund_type, reason, reason_text, status, error_message, card_brand, card_last4, installments, requested_by, approved_by, approved_at, rejected_reason, created_at, completed_at, receipt_code, receipt_path, receipt_sent_at, receipt_sent_to, manual_reference, manual_done_at, manual_registered_by";
      const q: any = applyRefundListFilters(supabase.from("gateway_refunds").select(cols), { ...body, scope });
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
    const { data: readySrc } = await supabase.from("gateway_refunds")
      .select("id, source, source_id, amount, requested_by, approved_by")
      .in("status", ["concluido","concluido_manual"]).is("card_brand", null).not("receipt_path", "is", null).is("receipt_sent_at", null)
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
      saleIds.length ? supabase.from("pos_sales").select(`${GW_COLS}, source_order_id, total, created_at`).in("id", saleIds) : none,
      orderIds.length ? supabase.from("orders").select(`${GW_COLS}, products, discount_type, discount_value, free_shipping, shipping_cost, created_at`).in("id", orderIds) : none,
      saleIds.length ? supabase.from("payment_splits").select("sale_id").in("sale_id", saleIds).limit(500) : none,
      orderIds.length ? supabase.from("payment_splits").select("order_id").in("order_id", orderIds).limit(500) : none,
      saleIds.length ? supabase.from("point_payment_intents").select("sale_id").in("sale_id", saleIds).limit(500) : none,
    ]);
    const sales = new Map<string, any>((salesR.data || []).map((s: any) => [s.id, s]));
    const orders = new Map<string, any>((ordersR.data || []).map((o: any) => [o.id, o]));
    // Venda da live: o código do gateway (Pagar.me/AustPay/Vindi) fica no pedido de origem.
    const srcIds = [...new Set((salesR.data || []).map((s: any) => s.source_order_id).filter(Boolean))] as string[];
    const srcR: any = srcIds.length ? await supabase.from("orders").select("id, appmax_order_id, pagarme_order_id, austpay_transaction_id, vindi_transaction_id").in("id", srcIds) : { data: [] };
    const srcOrders = new Map<string, any>((srcR.data || []).map((o: any) => [o.id, o]));
    const splitCount = new Map<string, number>();
    for (const r of [...(splitsS.data || []).map((x: any) => x.sale_id), ...(splitsO.data || []).map((x: any) => x.order_id)]) splitCount.set(r, (splitCount.get(r) || 0) + 1);
    const pointSales = new Set((pointR.data || []).map((x: any) => x.sale_id));
    const salePay = await loadMpSalePayments(supabase, [...sales.values()]);
    const saleAx = await loadAppmaxIds(supabase, [...sales.values()]);
    const saleAu = await loadAustpayIds(supabase, [...sales.values()]);

    const orderTotal = (d: any) => {
      const pt = (Array.isArray(d.products) ? d.products : []).reduce((s: number, p: any) => s + (Number(p?.price) || 0) * (Number(p?.quantity) || 0), 0);
      const disc = d.discount_type && d.discount_value ? (d.discount_type === "percentage" ? pt * (Number(d.discount_value) / 100) : Number(d.discount_value)) : 0;
      return Math.max(0, pt - disc + (d.free_shipping ? 0 : Number(d.shipping_cost || 0)));
    };
    // Decide pelo código de transação existente, nunca pelo rótulo payment_gateway.
    const otherGateway = (r: any) => r.appmax_order_id ? "Appmax" : r.pagarme_order_id ? "Pagar.me" : r.austpay_transaction_id ? "AustPay" : r.vindi_transaction_id ? "Vindi" : null;

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
      let axId: string | null = it.source === "order" ? (row.appmax_order_id ? String(row.appmax_order_id) : null) : (saleAx.get(it.id)?.id ?? null);
      if (it.source === "pos_sale") {
        const p: any = salePay.get(it.id);
        if (p?.error) { res.reason = p.error === MP_SALE_AMBIGUOUS ? MULTI : "Não foi possível consultar o gateway agora"; res.retry = p.error !== MP_SALE_AMBIGUOUS; continue; }
        paymentId = p?.paymentId ?? null; accountId = p?.accountId ?? null; paymentOrderId = p?.orderId ?? null;
      } else { paymentId = row.mercadopago_payment_id; accountId = row.mp_account_id; }
      if (!paymentId && it.source === "pos_sale" && saleAx.get(it.id)?.ambiguous) { res.gateway = "Appmax"; res.reason = MULTI; continue; }
      const au = it.source === "pos_sale" ? saleAu.get(it.id) : { id: row.austpay_transaction_id, refs: [row.id], ambiguous: false };
      if (au?.ambiguous) { res.reason = "Cobrança AustPay ambígua"; continue; }
      if (!paymentId && !axId && !au?.id) {
        const g = otherGateway(row) || (it.source === "pos_sale" && row.source_order_id ? otherGateway(srcOrders.get(row.source_order_id) || {}) : null);
        res.gateway = g;
        res.reason = g ? `${g} — em breve` : "Pago fora do sistema / sem transação de gateway";
        continue;
      }
      res.gateway = paymentId ? "Mercado Pago" : "Appmax";
      candidates.push({ res, src: {
        id: row.id, paymentId: paymentId ? String(paymentId) : null, mpAccountId: accountId, paymentOrderId, appmaxOrderId: axId, austpayTransactionId: au?.id, austpayReferenceIds: au?.refs,
        total: it.source === "order" ? orderTotal(row) : Number(row.total || 0),
        label: "", channel: it.source === "order" ? "live" : "pdv", customerName: null,
        isPaid: true, stageOrStatus: null, shipped: false, createdAt: row.created_at,
      } });
    }

    // Estornos em andamento por payment_id (cobre pedido↔venda da mesma compra) e Point por payment_id.
    const payIds = [...new Set(candidates.flatMap((c) => [c.src.paymentId, c.src.appmaxOrderId, c.src.austpayTransactionId]).filter(Boolean) as string[])];
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
      if (src.paymentId && pointPays.has(src.paymentId)) { res.gateway = "Point"; res.reason = "Maquininha Point — ainda não suportado"; continue; }
      const act = (src.paymentId && activeBy.get(src.paymentId)) || (src.appmaxOrderId && activeBy.get(src.appmaxOrderId)) || (src.austpayTransactionId && activeBy.get(src.austpayTransactionId));
      if (act && act!=='aguardando_aprovacao') { res.reason = `Estorno em andamento (${ACTIVE_LABEL[act] || act})`; continue; }
      if (checked >= 10) { res.retry = true; res.reason = RETRY; continue; }
      checked++;
      let gw: GwCheck;
      try { gw = await checkAny(supabase, src, null); }
      catch { res.retry = true; res.reason = RETRY; continue; }
      if (gw.gateway === "austpay") {
        const c = gw.check; const p = c.payment;
        res.gateway = "AustPay";
        Object.assign(res,{gateway_window_closes_at:c.gateway_window_closes_at,gateway_window_open:c.gateway_window_open,gateway_window_note:c.gateway_window_note,window_source:c.window_source});
        if (p) { res.method = "cartao"; res.cardLast4 = p.card_data?.last_digits; res.installments = p.installments; res.dateApproved = p.approved_at; }
        res.eligible = !!c.ok; res.remaining = c.remaining; res.reason = c.ok ? undefined : c.error; res.retry = c.retry; (res as any).fullOnly = true;
        if(act){res.eligible=false;res.reason=`Estorno em andamento (${ACTIVE_LABEL[act]||act})`;}
        continue;
      }
      if (gw.gateway === "appmax") {
        const c = gw.check; const ap = c.payment;
        res.gateway = "Appmax";
        if (ap) { res.method = ap.method || undefined; res.cardLast4 = ap.cardLast4; res.installments = ap.installments; res.dateApproved = ap.dateApproved; }
        if (c.ok) { res.eligible = true; res.remaining = c.remaining; (res as any).fullOnly = true; continue; }
        if (c.retry) { res.retry = true; res.reason = RETRY; continue; }
        if (/totalmente estornado/.test(c.error || "")) { res.reason = "Já totalmente estornado"; res.remaining = 0; continue; }
        res.reason = String(c.error || "").replace(/\.$/, "");
        continue;
      }
      const check: MpCheck = gw.check;
      const p = check.payment;
      if (p) {
        res.method = p.payment_method_id === "pix" || p.payment_type_id === "bank_transfer" ? "pix" : p.payment_type_id === "debit_card" ? "debito" : "cartao";
        res.cardLast4 = p.card?.last_four_digits || null; res.installments = p.installments || null; res.dateApproved = p.date_approved || null;
      }
      if (check.ok) { res.eligible = true; res.remaining = check.remaining; continue; }
      const err = check.error || "";
      if (!p && /consultar o pagamento/.test(err)) { res.retry = true; res.reason = RETRY; }
      else if (p && p.status === "refunded") { res.reason = "Já totalmente estornado"; res.remaining = 0; }
      else if (p && !["approved", "partially_refunded"].includes(p.status)) {
        // Cartão recusado no MP e aprovado no próximo gateway da cascata: o código do MP
        // recusado fica guardado, mas o pagamento real está no outro gateway.
        let rowGw = otherGateway(res.source === "pos_sale" ? sales.get(res.id) : orders.get(res.id));
        if (!rowGw && res.source === "pos_sale" && ["rejected", "cancelled"].includes(p.status)) {
          const { data: so } = await supabase.from("pos_sales").select("source_order_id").eq("id", res.id).maybeSingle();
          if (so?.source_order_id) {
            const { data: o } = await supabase.from("orders").select("appmax_order_id, pagarme_order_id, austpay_transaction_id, vindi_transaction_id").eq("id", so.source_order_id).maybeSingle();
            if (o) rowGw = otherGateway(o);
          }
        }
        if (rowGw && ["rejected", "cancelled"].includes(p.status)) { res.gateway = rowGw; res.reason = `Pago e aprovado na ${rowGw} (Mercado Pago recusou antes) — estorno direto na ${rowGw}`; }
        else res.reason = `Pagamento não aprovado no gateway (status ${p.status})`;
      }
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

    const gw = await checkAny(supabase, src, null);
    const check = gw.check;
    const { data: existing } = await supabase
      .from("gateway_refunds")
      .select("id, amount, status, refund_type, created_at")
      .eq("payment_id", gw.payId || "")
      .order("created_at", { ascending: false })
      .limit(20);

    if (gw.gateway === "austpay") {
      const p = check.payment;
      return json({ ok: check.ok, error: check.error, gateway: "AustPay", fullOnly: true, fullOnlyNotice: AUSTPAY_FULL_ONLY, gateway_window_closes_at:check.gateway_window_closes_at,gateway_window_open:check.gateway_window_open,gateway_window_note:check.gateway_window_note,window_source:check.window_source,
        source: { id: src.id, label: src.label, channel: src.channel, total: src.total, customerName: src.customerName, isPaid: src.isPaid, shipped: src.shipped, stageOrStatus: src.stageOrStatus, createdAt: src.createdAt },
        payment: p ? { id: p.id, status: p.status, method: p.card_data?.brand || "cartao", type: "credit_card", amount: p.approved_amount / 100, dateApproved: p.approved_at, cardLast4: p.card_data?.last_digits, installments: p.installments, accountName: "AustPay" } : null,
        remaining: check.remaining, refundedSoFar: check.refundedSoFar, existingRefunds: existing || [] });
    }
    if (gw.gateway === "appmax") {
      const ap = check.payment;
      return json({
        ok: check.ok, error: check.error, gateway: "Appmax", fullOnly: true, fullOnlyNotice: APPMAX_PARTIAL_ONLY_FULL,
        source: {
          id: src.id, label: src.label, channel: src.channel, total: src.total,
          customerName: src.customerName, isPaid: src.isPaid, shipped: src.shipped,
          stageOrStatus: src.stageOrStatus, createdAt: src.createdAt,
        },
        payment: ap ? {
          id: ap.orderId, status: ap.status, method: ap.method === "pix" ? "pix" : ap.cardBrand || ap.method, type: ap.method === "pix" ? "bank_transfer" : "credit_card",
          amount: ap.amount ?? src.total, dateApproved: ap.dateApproved, cardLast4: ap.cardLast4, installments: ap.installments, accountName: "Appmax",
        } : null,
        remaining: check.remaining ?? null,
        refundedSoFar: check.refundedSoFar ?? null,
        existingRefunds: existing || [],
      });
    }
    const p = check.payment;
    return json({
      ok: check.ok,
      error: check.error,
      gateway: "Mercado Pago",
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
    if (!Number.isFinite(amount) || !(amount > 0)) return json({ error: "Informe o valor do estorno." }, 400);

    const src = await loadSource(supabase, source, id);
    if (!src) return json({ error: "Venda/pedido não encontrado." }, 404);

    if (await isPointSale(supabase, source, id, src.paymentId)) {
      return json({ error: "Estorno de maquininha ainda não suportado." }, 400);
    }

    // Trava contra duplicidade: já existe estorno em andamento para este pagamento?
    // (O índice único parcial gateway_refunds_one_in_flight_per_payment garante
    // a mesma regra no banco — duas abas ao mesmo tempo não passam as duas.)
    const gw = await checkAny(supabase, src, amount);
    const { data: inFlight } = await supabase
      .from("gateway_refunds")
      .select("id, status")
      .eq("payment_id", gw.payId || "")
      .in("status", ["aguardando_aprovacao", "processando", "verificar"])
      .limit(1);
    if (inFlight && inFlight.length > 0) {
      const checking = inFlight[0].status === "verificar";
      return json({ error: checking
        ? "Existe um estorno em verificação com o gateway para este pagamento. NÃO refaça o estorno — aguarde a conferência automática."
        : "Já existe um estorno aguardando aprovação ou em processamento para este pagamento. Aguarde a conclusão antes de pedir outro." }, 409);
    }

    const check = gw.check;
    if (!check.ok) return json({ error: check.error }, 400);
    if (gw.gateway === "austpay") {
      const p = check.payment;
      const needsApproval = !isAdmin && (cfg.approval_threshold == null || amount > cfg.approval_threshold);
      const row = { gateway: "austpay", source, source_id: id, payment_id: gw.payId, mp_account_id: null, amount, refund_type: "integral", reason, reason_text: reasonText,
        status: needsApproval ? "aguardando_aprovacao" : "processando", idempotency_key: crypto.randomUUID(), card_brand: p.card_data?.brand || "cartao", card_last4: p.card_data?.last_digits || null, installments: p.installments, requested_by: userId, cancel_order: cancelOrder };
      const { data: ins, error } = await supabase.from("gateway_refunds").insert(row).select("id").single();
      if (error) return json({ error: error.code === "23505" ? "Já existe estorno em andamento." : "Falha ao registrar estorno." }, error.code === "23505" ? 409 : 500);
      if (needsApproval) return json({ ok: true, pending_approval: true, refund_id: ins.id, message: "Aguardando aprovação; nenhum valor foi movido." });
      return json({ ...await executeAustpay(supabase, { ...row, id: ins.id }, src), refund_id: ins.id });
    }
    const needsApprovalAx = !isAdmin && (cfg.approval_threshold == null || amount > cfg.approval_threshold);
    if (gw.gateway === "appmax") {
      const ap = check.payment;
      const axRow = {
        gateway: "appmax", source, source_id: id, mp_account_id: null, payment_id: String(gw.payId),
        amount, refund_type: "integral", reason, reason_text: reasonText,
        status: needsApprovalAx ? "aguardando_aprovacao" : "processando", idempotency_key: crypto.randomUUID(),
        card_brand: ap.method === "pix" ? null : (ap.cardBrand || "cartao"), card_last4: ap.cardLast4, installments: ap.installments,
        requested_by: userId, cancel_order: cancelOrder,
      };
      const { data: ins, error: e2 } = await supabase.from("gateway_refunds").insert(axRow).select("id").single();
      if (e2) {
        if (e2.code === "23505" || String(e2.message).includes("gateway_refunds_one_in_flight_per_payment")) return json({ error: "Já existe um estorno em andamento para este pagamento. Aguarde a conclusão antes de pedir outro." }, 409);
        return json({ error: `Falha ao registrar o estorno: ${e2.message}` }, 500);
      }
      if (needsApprovalAx) return json({ ok: true, pending_approval: true, refund_id: ins.id, message: "Estorno registrado e aguardando aprovação de um administrador. Nenhum valor foi movido ainda." });
      const r = await executeAppmax(supabase, { ...axRow, id: ins.id }, userEmail);
      return json({ ...r, refund_id: ins.id });
    }

    const p = check.payment;
    if (!p || !check.account || check.remaining == null) return json({ error: "Pagamento não verificável." }, 400);
    const remaining = check.remaining;
    const isFull = Math.abs(amount - remaining) < 0.01;

    // Teto de aprovação: vazio => não-admin sempre aguarda aprovação.
    const needsApproval = !isAdmin && (cfg.approval_threshold == null || amount > cfg.approval_threshold);

    const row = {
      gateway: "mercadopago",
      source,
      source_id: id,
      mp_account_id: check.account.account_id,
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
    if (row.gateway === "austpay") {
      if (src.paymentError || src.austpayTransactionId !== row.payment_id) return json({ error: "Cobrança AustPay não confere com a solicitação." }, 400);
      const check = await austpayCheckPayment(supabase, src, Number(row.amount));
      if (!check.ok) return json({ error: check.error }, 400);
      const { data: claimed, error } = await supabase.from("gateway_refunds").update({ status: "processando", approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "aguardando_aprovacao").select("id").maybeSingle();
      if (error || !claimed) return json({ error: "Esta solicitação já foi processada por outro administrador." }, 409);
      return json(await executeAustpay(supabase, { ...row, status: "processando" }, src));
    }
    if (row.gateway === "appmax") {
      const c = await appmaxCheckPayment(supabase, String(row.payment_id), src.total, Number(row.amount));
      if (!c.ok) {
        if (c.retry) return json({ error: "Não foi possível consultar a Appmax agora. Tente aprovar de novo em instantes." }, 503);
        await supabase.from("gateway_refunds").update({ status: "falhou", error_message: c.error, updated_at: new Date().toISOString() }).eq("id", refundId);
        return json({ error: c.error }, 400);
      }
      await supabase.from("gateway_refunds").update({ status: "processando", approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", refundId);
      return json(await executeAppmax(supabase, row, userEmail));
    }
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
