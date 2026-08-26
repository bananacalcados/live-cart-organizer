// Área de Clientes pública da Live (link único fixado no Instagram).
// Identidade = telefone digitado (sem OTP na entrada, para captar leads).
// OTP funciona como "cofre": só libera leitura/edição dos dados pessoais.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendAccessCode, verifyAccessCode } from "../_shared/access-code.ts";
import { logCheckoutFailure } from "../_shared/checkout-failure-log.ts";
import { redeemMagicLink } from "../_shared/member-magic-link.ts";
import { saveMetaAttribution, buildFbc } from "../_shared/meta-attribution-memory.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAYMENT_WINDOW_MIN = 20;
const OTP_SESSION_MIN = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Normaliza para E.164 BR, injetando o 9º dígito quando necessário. */
function normalizePhone(input: string): string | null {
  let d = String(input || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55")) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);
  if (d.length !== 11) return null;
  return "55" + d;
}

const suffix8 = (p: string) => p.replace(/\D/g, "").slice(-8);

/**
 * ⚠️ Antifraude dos gateways: o `payer` precisa ser a pessoa real.
 * O @ do Instagram (ex.: "@amalia_ferraz10") NUNCA pode virar nome do cliente,
 * e e-mails de teste ("asd@gmail.com") derrubam a aprovação do cartão.
 */
function isRealFullName(raw?: string | null): boolean {
  const v = String(raw ?? "").trim();
  if (!v || v.includes("@") || /\d/.test(v) || /[._]/.test(v)) return false;
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((p) => /^[a-zA-ZÀ-ÿ'’-]{2,}$/.test(p));
}

const JUNK_EMAIL_LOCALS = new Set([
  "asd", "asdf", "teste", "test", "aaa", "abc", "123", "xxx", "nao", "email",
  "qwe", "qwerty", "sememail", "naotenho",
]);

function isUsableEmail(raw?: string | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) return false;
  const local = v.split("@")[0];
  if (local.length < 4 || JUNK_EMAIL_LOCALS.has(local) || /^(.)\1+$/.test(local)) return false;
  return true;
}

function maskCpf(v?: string | null) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length !== 11) return null;
  return `***.***.${d.slice(6, 9)}-**`;
}
function maskEmail(v?: string | null) {
  if (!v || !v.includes("@")) return null;
  const [u, dom] = v.split("@");
  return `${u.slice(0, 2)}${"*".repeat(Math.max(2, u.length - 2))}@${dom}`;
}
function maskText(v?: string | null) {
  if (!v) return null;
  const s = String(v);
  return s.length <= 4 ? "****" : `${s.slice(0, 3)}${"*".repeat(Math.min(10, s.length - 3))}`;
}

function newToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** IP do requisitante (proxy-aware), usado como chave de rate limit. */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown").trim();
}

/**
 * ⚡ Cache de instância (vive entre requisições da mesma edge function).
 * A live corrente e o desconto PIX são IGUAIS para todas as clientes; consultá-los
 * a cada requisição custava 3 idas ao banco por cliente a cada polling.
 */
type Cached<T> = { at: number; value: T };
let EVENT_CACHE: Cached<any> | null = null;
let PIX_CACHE: Cached<number> | null = null;
const EVENT_TTL_MS = 15_000;
const PIX_TTL_MS = 300_000;




Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Contexto fora do try: qualquer atrito da Área de Membros (cliente sem
  // pedido localizado, bloqueio por cota, erro inesperado) precisa deixar
  // rastro no Monitor de Checkout — antes esses casos sumiam sem registro.
  const flow: { action: string; phone: string | null; name: string | null; orderId: string | null } = {
    action: "",
    phone: null,
    name: null,
    orderId: null,
  };

  /** Registra atrito da área de membros. Best-effort, nunca lança. */
  async function logFriction(kind: string, message: string, extra?: Record<string, unknown>) {
    await logCheckoutFailure(supabase, {
      sale_id: flow.orderId || `member-area:${flow.phone || "anon"}`,
      payment_method: "member_area",
      gateway: "member_area",
      status: "error",
      error_message: `[${kind}] ${message}`,
      customer_name: flow.name,
      customer_phone: flow.phone,
      metadata: { source: "live-member-area", action: flow.action, kind, ...(extra || {}) },
    });
  }

  try {
    const body = await req.json();
    let action = String(body?.action || "");
    const ip = clientIp(req);

    // Link mágico: ?ml=TOKEN na Área de Membros entra direto, sem telefone/OTP.
    if (action === "magic_enter") {
      const magicPhone = await redeemMagicLink(supabase, body?.ml || body?.magic);
      // 200 de propósito: link expirado/inválido não pode derrubar a página,
      // a cliente cai no fluxo normal de telefone.
      if (!magicPhone) return json({ ok: false, error: "magic_invalid" }, 200);
      body.phone = magicPhone;
      body.magicVerified = true;
      action = "enter";
    }

    flow.action = action;
    flow.phone = normalizePhone(body?.phone || "") || null;
    flow.name = String(body?.name || "").trim() || null;

    /**
     * Ponto 7 — anti-abuso. Retorna true quando ainda está dentro da cota.
     * Falha "aberta" (permite) se o banco não responder, para não travar clientes reais.
     */
    async function allow(key: string, limit: number, windowSeconds: number) {
      const { data, error } = await supabase.rpc("live_member_rate_limit", {
        _key: key,
        _limit: limit,
        _window_seconds: windowSeconds,
      });
      if (error) {
        console.error("[rate-limit]", key, error.message);
        return true;
      }
      return data !== false;
    }

    /** Bloqueio por cota: responde 429 e deixa rastro do motivo. */
    async function blocked(kind: string, message: string) {
      await logFriction(kind, message, { ip_hash: suffix8(ip) });
      return json({ ok: false, error: message }, 429);
    }

    // Cota global por IP para qualquer ação (protege o endpoint público inteiro)
    if (!(await allow(`ip:${ip}`, 120, 60))) {
      return await blocked("rate_limit_ip", "Muitas requisições. Tente novamente em instantes.");
    }




    // ---------- helpers ----------
    /**
     * Link ÚNICO e global (bio do Instagram): não existe slug por live.
     * Vale para QUALQUER evento (manual ou área de clientes).
     * Prioriza a live no ar; senão, o evento ativo mais recente.
     */
    async function resolveCurrentEvent() {
      if (EVENT_CACHE && Date.now() - EVENT_CACHE.at < EVENT_TTL_MS) return EVENT_CACHE.value;

      const base = () =>
        supabase
          .from("events")
          .select("id, name, operation_mode, is_active, is_live_broadcasting, instagram_live_url, whatsapp_number_id")
          .neq("is_active", false);

      const [liveRes, latestRes] = await Promise.all([
        base().eq("is_live_broadcasting", true).order("created_at", { ascending: false }).limit(1),
        base().order("created_at", { ascending: false }).limit(1),
      ]);
      const value = liveRes.data?.[0] || latestRes.data?.[0] || null;
      EVENT_CACHE = { at: Date.now(), value };
      return value;
    }



    async function loadSession(token: string) {
      if (!token) return null;
      const { data } = await supabase
        .from("live_member_sessions")
        .select("*")
        .eq("token", token)
        .maybeSingle();
      if (!data) return null;
      if (new Date(data.expires_at) < new Date()) return null;
      return data;
    }

    /**
     * Ponto 5 — Lead → CRM: garante o contato em customers_unified (telefone E.164,
     * dedupe por CPF/telefone/e-mail/IG). Nunca quebra o fluxo em caso de erro.
     */
    async function upsertUnified(args: {
      phone: string;
      name?: string | null;
      cpf?: string | null;
      email?: string | null;
    }) {
      try {
        const rawName = String(args.name || "").trim();
        const isHandle = rawName.startsWith("@");
        const { error } = await supabase.rpc("find_or_create_unified_customer", {
          p_phone: args.phone,
          p_name: rawName ? rawName.replace(/^@/, "") : null,
          p_instagram: isHandle ? rawName.replace(/^@/, "") : null,
          p_cpf: args.cpf ? String(args.cpf).replace(/\D/g, "").slice(0, 11) || null : null,
          p_email: args.email ? String(args.email).trim().toLowerCase() : null,
          p_source: "member_area",
        });
        if (error) console.error("[live-member-area] unified upsert", error.message);
      } catch (e) {
        console.error("[live-member-area] unified upsert", e);
      }
    }

    /** Memo por requisição: `loadCustomers` era chamado 3x por request com o mesmo telefone. */
    const customersMemo = new Map<string, Promise<any[]>>();
    function loadCustomers(phone: string): Promise<any[]> {
      const suf = suffix8(phone);
      const hit = customersMemo.get(suf);
      if (hit) return hit;
      const p = supabase
        .from("customers")
        .select("id, instagram_handle, whatsapp")
        .not("whatsapp", "is", null)
        .ilike("whatsapp", `%${suf}`)
        .then((r: any) => r.data || []);
      customersMemo.set(suf, p);
      return p;
    }



    /** Pedido "ativo" da cliente: no evento corrente ou, se não houver, o mais recente em qualquer evento. */
    async function loadOrder(eventId: string | null, phone: string) {
      const customers = await loadCustomers(phone);
      const ids = customers.map((c: any) => c.id);
      if (!ids.length) return { order: null, customer: null };

      let order: any = null;

      if (eventId) {
        const { data: orders } = await supabase
          .from("orders")
          .select("*")
          .eq("event_id", eventId)
          .in("customer_id", ids)
          .not("stage", "in", "(cancelled)")
          .order("created_at", { ascending: false })
          .limit(1);
        order = orders?.[0] || null;
      }

      if (!order) {
        // Fallback: pedido em aberto mais recente em QUALQUER evento (inclusive modo manual)
        const { data: any_orders } = await supabase
          .from("orders")
          .select("*")
          .in("customer_id", ids)
          .not("stage", "in", "(cancelled,delivered)")
          .order("created_at", { ascending: false })
          .limit(1);
        order = any_orders?.[0] || null;
      }

      const customer = order
        ? customers.find((c: any) => c.id === order.customer_id) || customers[0]
        : customers[0];
      return { order, customer };
    }


    /** Histórico: pedidos da cliente em TODAS as lives (exceto o pedido atual). */
    async function loadHistory(phone: string, currentOrderId: string | null) {
      const customers = await loadCustomers(phone);
      const ids = customers.map((c: any) => c.id);
      if (!ids.length) return [];

      const { data: orders } = await supabase
        .from("orders")
        .select(
          "id, event_id, products, shipping_cost, free_shipping, discount_type, discount_value, is_paid, paid_at, stage, created_at",
        )

        .in("customer_id", ids)
        .neq("stage", "cancelled")
        .order("created_at", { ascending: false })
        .limit(30);
      const list = (orders || []).filter((o: any) => o.id !== currentOrderId);
      if (!list.length) return [];

      const eventIds = [...new Set(list.map((o: any) => o.event_id).filter(Boolean))];
      const { data: evs } = await supabase.from("events").select("id, name").in("id", eventIds);
      const nameById = new Map((evs || []).map((e: any) => [e.id, e.name]));

      return list.map((o: any) => ({
        id: o.id,
        event_name: nameById.get(o.event_id) || null,
        created_at: o.created_at,
        is_paid: !!o.is_paid,
        paid_at: o.paid_at,
        stage: o.stage,
        items: (Array.isArray(o.products) ? o.products : []).map((p: any) => ({
          title: p.title,
          variant: p.variant,
          quantity: Number(p.quantity || 1),
          price: Number(p.price || 0),
          image: p.image || null,
        })),
        total:
          Math.round(
            (Math.max(0, orderSubtotal(o) - orderDiscount(o)) +
              (o.free_shipping ? 0 : Number(o.shipping_cost || 0))) * 100,
          ) / 100,

      }));
    }


    /** Assinatura dos itens do pedido — muda quando produtos/quantidades mudam. */
    function itemsSignature(order: any) {
      const items = Array.isArray(order?.products) ? order.products : [];
      return `${order?.id}:${items
        .map((p: any) => `${p.id ?? p.shopifyId ?? p.title}x${p.quantity ?? 1}`)
        .join("|")}`;
    }


    function orderSubtotal(order: any) {
      const items = Array.isArray(order?.products) ? order.products : [];
      return items.reduce(
        (s: number, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1),
        0,
      );
    }

    /** Desconto do pedido (fixo ou percentual) aplicado sobre os produtos. */
    function orderDiscount(order: any) {
      const st = orderSubtotal(order);
      if (!order?.discount_type || !order?.discount_value) return 0;
      const raw =
        order.discount_type === "percentage"
          ? st * (Number(order.discount_value) / 100)
          : Number(order.discount_value);
      return Math.min(st, Math.max(0, Math.round(raw * 100) / 100));
    }

    /** A cliente escolheu o frete na área de membros? */
    function shippingChosen(order: any) {
      return (order?.shipping_info as any)?.source === "member_area";
    }

    /** Frete considerado no total: só depois que a cliente escolhe a forma de envio. */
    function orderShipping(order: any) {
      if (!shippingChosen(order)) return 0;
      return order?.free_shipping ? 0 : Number(order?.shipping_cost || 0);
    }

    function orderTotal(order: any) {
      return (
        Math.max(0, orderSubtotal(order) - orderDiscount(order)) + orderShipping(order)
      );
    }


    /**
     * Ponto 6 — frete fixo da Live: se o pedido ainda não tem frete definido,
     * aplica a regra do evento (fixo / grátis acima de X) antes de mandar
     * a cliente para o checkout. Nunca sobrescreve frete já escolhido.
     */
    async function applyEventShipping(order: any) {
      if (!order || order.is_paid) return order;
      // Frete escolhido pela própria cliente na área de membros manda sempre.
      if ((order.shipping_info as any)?.source === "member_area") return order;
      if (order.free_shipping) return order;
      if (Number(order.shipping_cost || 0) > 0) return order;
      if (!order.event_id) return order;


      const { data: ev } = await supabase
        .from("events")
        .select("default_shipping_cost, free_shipping_threshold")
        .eq("id", order.event_id)
        .maybeSingle();
      if (!ev) return order;

      const fixed = Number(ev.default_shipping_cost || 0);
      const freeAbove = Number(ev.free_shipping_threshold || 0);
      // Regra do frete grátis usa o valor REAL do pedido (com desconto aplicado),
      // nunca o subtotal cheio dos produtos.
      const subtotal = Math.max(0, orderSubtotal(order) - orderDiscount(order));

      let shippingCost: number | null = null;
      let freeShipping = false;
      if (freeAbove > 0 && subtotal >= freeAbove) {
        shippingCost = 0;
        freeShipping = true;
      } else if (fixed > 0) {
        shippingCost = fixed;
      }
      if (shippingCost === null) return order;

      await supabase
        .from("orders")
        .update({
          shipping_cost: shippingCost,
          free_shipping: freeShipping,
          shipping_info: {
            source: "event_rule",
            carrier: freeShipping ? "Frete Grátis (regra do evento)" : "Frete fixo do evento",
            price: shippingCost,
            applied_at: new Date().toISOString(),
          },
        })
        .eq("id", order.id);

      return { ...order, shipping_cost: shippingCost, free_shipping: freeShipping };
    }

    /** Desconto PIX global (app_settings.pix_discount_percent), ex.: 5%. */
    async function pixDiscountPercent(): Promise<number> {
      try {
        const { data } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "pix_discount_percent")
          .maybeSingle();
        const pct = Number(String(data?.value ?? "").replace(/"/g, "")) || 0;
        return pct > 0 && pct < 100 ? pct : 0;
      } catch {
        return 0;
      }
    }

    /**
     * Dados que a cliente JÁ informou antes (mesmo WhatsApp, outro pedido).
     * É o que faz o cadastro "ficar salvo" entre lives: cada pedido novo
     * herda endereço/CPF/e-mail do último cadastro dela.
     */
    async function previousRegistration(phone: string, excludeOrderId: string | null) {
      const suf = suffix8(phone);
      const { data } = await supabase
        .from("customer_registrations")
        .select("*")
        .ilike("whatsapp", `%${suf}`)
        .order("created_at", { ascending: false })
        .limit(10);
      const found = (data || []).find(
        (r: any) => r.order_id !== excludeOrderId && (r.cep || r.cpf || r.email),
      );
      if (found) return found;
      // Fallback: cliente já cadastrada no PDV (pos_customers), mas que nunca
      // passou pela área de membros. Reaproveita a ficha para não pedir
      // endereço/CPF/e-mail de novo.
      try {
        const { data: pc } = await supabase
          .from("pos_customers")
          .select(
            "name, email, cpf, whatsapp, cep, address, address_number, complement, neighborhood, city, state, updated_at",
          )
          .like("whatsapp", `%${suf}`)
          .order("updated_at", { ascending: false })
          .limit(5);
        const master = (pc || []).find((r: any) => r.cep || r.cpf || r.email);
        if (!master) return null;
        return {
          full_name: master.name || null,
          cpf: master.cpf || null,
          email: master.email || null,
          cep: master.cep || null,
          address: master.address || null,
          address_number: master.address_number || null,
          complement: master.complement || null,
          neighborhood: master.neighborhood || null,
          city: master.city || null,
          state: master.state || null,
        };
      } catch {
        return null;
      }
    }


    /** Última forma de envio escolhida pela cliente na área de membros. */
    async function previousShipping(phone: string, excludeOrderId: string | null) {
      const customers = await loadCustomers(phone);
      const ids = customers.map((c: any) => c.id);
      if (!ids.length) return null;
      const { data } = await supabase
        .from("orders")
        .select("id, shipping_info, created_at")
        .in("customer_id", ids)
        .order("created_at", { ascending: false })
        .limit(10);
      const prev = (data || []).find(
        (o: any) => o.id !== excludeOrderId && (o.shipping_info as any)?.source === "member_area",
      );
      return (prev?.shipping_info as any) || null;
    }

    /**
     * `customer_registrations` tem várias colunas NOT NULL. Como a área de
     * membros salva os dados por etapas (endereço → CPF → e-mail), qualquer
     * INSERT parcial quebrava e NADA era salvo. Estes helpers garantem que
     * nunca enviamos NULL para colunas obrigatórias.
     */
    const REG_REQUIRED = [
      "full_name", "cpf", "email", "whatsapp", "cep",
      "address", "address_number", "neighborhood", "city", "state",
    ];
    function nonNullReg(payload: Record<string, unknown>) {
      const out: Record<string, unknown> = { ...payload };
      for (const k of REG_REQUIRED) if (k in out && out[k] == null) out[k] = "";
      return out;
    }
    function withRegDefaults(payload: Record<string, unknown>) {
      const out = nonNullReg(payload);
      for (const k of REG_REQUIRED) if (out[k] == null) out[k] = "";
      return out;
    }

    /** Executa em segundo plano (não segura a resposta da etapa). */
    function background(p: Promise<unknown>) {
      try {
        // @ts-ignore — disponível no runtime das edge functions
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
        else p.catch(() => {});
      } catch {
        p.catch(() => {});
      }
    }


    async function buildState(session: any, opts: { skipHistory?: boolean } = {}) {
      // Sempre resolve a live corrente (link único global), não a live da sessão.
      const event = await resolveCurrentEvent();
      const loaded = await loadOrder(event?.id || null, session.phone);
      const customer = loaded.customer;
      // O frete NÃO é aplicado automaticamente: a cliente escolhe a forma de envio
      // na etapa de endereço. Aplicar antes cobraria frete duas vezes.
      const order = loaded.order;
      if (
        order &&
        !order.is_paid &&
        (order.shipping_info as any)?.source === "event_rule" &&
        Number(order.shipping_cost || 0) > 0
      ) {
        await supabase
          .from("orders")
          .update({ shipping_cost: 0, free_shipping: false, shipping_info: null })
          .eq("id", order.id);
        order.shipping_cost = 0;
        order.free_shipping = false;
        order.shipping_info = null;
      }


      // ⚡ Tudo o que não depende um do outro roda EM PARALELO.
      // Antes eram ~8 consultas em fila, cada uma somando latência à mesma resposta.
      const historyP: Promise<any> = opts.skipHistory
        ? Promise.resolve(null)
        : loadHistory(session.phone, order?.id || null);

      const prizesP = supabase
        .rpc("get_customer_active_prizes", {
          p_phone: String(session.phone || "").replace(/\D/g, ""),
          p_include_history: true,
        })
        .then((r: any) => r.data || [])
        .catch(() => []);

      const pixP = order && !order.is_paid ? pixDiscountPercent() : Promise.resolve(0);

      const raffleRowsP = event?.id
        ? supabase
            .from("event_raffles")
            .select("id, name, prize_label, prize_type, prize_value, audience, min_purchase_value, winners_count, status")
            .eq("event_id", event.id)
            .then((r: any) => r.data || [])
            .catch(() => [])
        : Promise.resolve([]);

      const regP = order?.id
        ? supabase
            .from("customer_registrations")
            .select("*")
            .eq("order_id", order.id)
            .maybeSingle()
            .then((r: any) => r.data || null)
            .catch(() => null)
        : Promise.resolve(null);

      const [history, prizeRows, pixPct, raffleRows, regLoaded] = await Promise.all([
        historyP,
        prizesP,
        pixP,
        raffleRowsP,
        regP,
      ]);

      // ── Prêmios ativos da roleta (não usados e dentro da validade).
      const prizes = (prizeRows || []).map((p: any) => ({
        id: p.id,
        label: p.prize_label,
        type: p.prize_type,
        value: Number(p.prize_value || 0),
        coupon_code: p.coupon_code,
        expires_at: p.expires_at,
        days_left: Number(p.days_left || 0),
        is_physical: p.prize_type === "product",
        // ciclo de vida do prêmio físico: available | reserved | shipped | forfeited | expired
        fulfillment_status: p.fulfillment_status || "available",
        reserved_order_id: p.applied_order_id,
        shipped_at: p.shipped_at,
        forfeited_at: p.forfeited_at,
        forfeit_reason: p.forfeit_reason,
      }));

      // ── Sorteios do evento: mostra à cliente se ela está concorrendo e o que
      // precisa fazer para entrar (confirmar pedido / pagar). Só leitura.
      const raffles: any[] = [];
      try {
        if (event?.id && raffleRows.length) {
          const rows = raffleRows;
          const last8 = suffix8(session.phone || "");
          const [leadRes, winRes] = await Promise.all([
            supabase
              .from("event_leads")
              .select("id")
              .eq("event_id", event.id)
              .eq("phone_suffix", last8)
              .limit(1),
            supabase
              .from("event_raffle_winners")
              .select("raffle_id, voided_at, phone")
              .in("raffle_id", rows.map((r: any) => r.id)),
          ]);
          const leadRow = leadRes.data;
          const winRows = winRes.data;

          const excluded = ["pre_sale", "incomplete_order", "awaiting_confirmation", "cancelled"];
          const stage = String(order?.stage || "");
          const hasConfirmedOrder = !!order && !excluded.includes(stage);
          const isPayer = !!order && Boolean(order.is_paid || order.paid_externally);
          const orderValue = order ? Math.max(0, orderSubtotal(order) - orderDiscount(order)) : 0;
          const isLiveLead = !!leadRow?.length && !order;

          for (const r of rows) {
            const min = Number(r.min_purchase_value || 0);
            let eligible = false;
            let hint = "";
            if (r.audience === "confirmed_orders") {
              eligible = hasConfirmedOrder && (min <= 0 || orderValue >= min);
              hint = hasConfirmedOrder
                ? min > 0 && orderValue < min
                  ? `Compre a partir de R$ ${min.toFixed(2)} para concorrer`
                  : ""
                : "Confirme seu pedido para concorrer";
            } else if (r.audience === "payers") {
              eligible = isPayer && (min <= 0 || orderValue >= min);
              hint = isPayer
                ? min > 0 && orderValue < min
                  ? `Pedidos a partir de R$ ${min.toFixed(2)} concorrem`
                  : ""
                : "Finalize o pagamento para concorrer";
            } else if (r.audience === "live_leads") {
              eligible = isLiveLead;
              hint = eligible ? "" : "Sorteio exclusivo para quem se cadastrou nesta live e ainda não fez pedido";
            }

            const won = (winRows || []).some(
              (w: any) => !w.voided_at && suffix8(String(w.phone || "")) === last8 && w.raffle_id === r.id,
            );

            raffles.push({
              id: r.id,
              name: r.name,
              prize_label: r.prize_label,
              prize_type: r.prize_type,
              winners_count: Number(r.winners_count || 1),
              audience: r.audience,
              status: r.status,
              eligible,
              won,
              hint,
            });
          }
        }
      } catch (e) {
        console.error("[member-area] falha ao montar sorteios:", e);
      }

      let reg: any = regLoaded;
      if (order?.id) {


        // ── Cadastro salvo: herda o que ela já informou em pedidos anteriores.
        const missing = !reg?.cep || !reg?.address || !reg?.address_number || !reg?.cpf || !reg?.email;
        if (missing) {
          const prev = await previousRegistration(session.phone, order.id);
          if (prev) {
            const fields = [
              "full_name", "cpf", "email", "cep", "address", "address_number",
              "complement", "neighborhood", "city", "state",
            ];
            const patch: Record<string, unknown> = {};
            for (const f of fields) {
              if (!reg?.[f] && prev[f]) patch[f] = prev[f];
            }
            if (Object.keys(patch).length) {
              if (reg?.id) {
                await supabase.from("customer_registrations").update(patch).eq("id", reg.id);
                reg = { ...reg, ...patch };
              } else {
                const { data: created } = await supabase
                  .from("customer_registrations")
                  .insert(withRegDefaults({ order_id: order.id, whatsapp: session.phone, ...patch }))
                  .select()
                  .maybeSingle();
                reg = created || { order_id: order.id, ...patch };

              }
            }
          }
        }

        // ── Envio salvo: reaplica a forma de envio escolhida antes (mesmo CEP).
        if (
          !order.is_paid &&
          (order.shipping_info as any)?.source !== "member_area" &&
          reg?.cep
        ) {
          const prevShip = await previousShipping(session.phone, order.id);
          if (prevShip?.method && String(prevShip.cep || "") === String(reg.cep)) {
            const cost = Number(prevShip.price || 0);
            const info = { ...prevShip, inherited: true, applied_at: new Date().toISOString() };
            await supabase
              .from("orders")
              .update({ shipping_cost: cost, free_shipping: cost === 0, shipping_info: info })
              .eq("id", order.id);
            order.shipping_cost = cost;
            order.free_shipping = cost === 0;
            order.shipping_info = info;
          }
        }
      }


      const otpUnlocked =
        !!session.otp_verified_until && new Date(session.otp_verified_until) > new Date();
      const hasDetails = !!(reg && (reg.cpf || reg.cep || reg.email));
      const shippingMethod = (order?.shipping_info as any)?.method || null;
      // Retirada na loja / mototaxista não exigem endereço completo.
      const noAddressNeeded = ["pickup", "local", "motoboy", "delivery_local"].includes(
        String(shippingMethod || ""),
      );
      /** Onboarding pós-confirmação: nome + endereço + envio + CPF + e-mail. */
      const onboarding = {
        // Nome real é pré-requisito do pagamento (antifraude do gateway).
        name: isRealFullName(reg?.full_name),
        address: noAddressNeeded
          ? !!reg?.cep
          : !!(reg?.cep && reg?.address && reg?.address_number),
        shipping: !!shippingMethod,
        cpf: !!reg?.cpf,
        email: isUsableEmail(reg?.email),
      };


      return {
        ok: true,
        token: session.token,
        event,
        onboarding,
        onboardingComplete:
          onboarding.name &&
          onboarding.address &&
          onboarding.shipping &&
          onboarding.cpf &&
          onboarding.email,


        name: session.name || customer?.instagram_handle || null,
        phone: session.phone,
        otpUnlocked,
        hasDetails,
        details: hasDetails && !otpUnlocked
          ? {
              masked: true,
              full_name: reg?.full_name || null,
              cpf: maskCpf(reg?.cpf),
              email: maskEmail(reg?.email),
              cep: maskText(reg?.cep),
              address: maskText(reg?.address),
              city: reg?.city || null,
              state: reg?.state || null,
            }
          : hasDetails
          ? {
              masked: false,
              full_name: reg?.full_name || null,
              cpf: reg?.cpf || null,
              email: reg?.email || null,
              cep: reg?.cep || null,
              address: reg?.address || null,
              address_number: reg?.address_number || null,
              complement: reg?.complement || null,
              neighborhood: reg?.neighborhood || null,
              city: reg?.city || null,
              state: reg?.state || null,
            }
          : { masked: false, empty: true },
        // Dados completos usados APENAS para preencher o pagamento (gateway).
        // Não são exibidos na tela — a visualização/edição continua exigindo OTP.
        payDetails: hasDetails
          ? {
              full_name: reg?.full_name || null,
              cpf: reg?.cpf || null,
              email: reg?.email || null,
              cep: reg?.cep || null,
              address: reg?.address || null,
              address_number: reg?.address_number || null,
              complement: reg?.complement || null,
              neighborhood: reg?.neighborhood || null,
              city: reg?.city || null,
              state: reg?.state || null,
            }
          : null,
        order: order
          ? (() => {
              const st = orderSubtotal(order);
              const disc = orderDiscount(order);
              const ratio = st > 0 ? Math.max(0, st - disc) / st : 1;
              const chosen = shippingChosen(order);
              const ship = orderShipping(order);
              const tot = Math.round(orderTotal(order) * 100) / 100;
              return {
                id: order.id,
                stage: order.stage,
                products: (order.products || []).map((p: any) => {
                  const full = Number(p.price || 0);
                  const eff = Math.round(full * ratio * 100) / 100;
                  return {
                    ...p,
                    price: full,
                    full_price: full,
                    effective_price: eff,
                    has_discount: disc > 0 && eff < full,
                  };
                }),
                subtotal: Math.round(st * 100) / 100,
                discount: disc,
                shipping_pending: !chosen,
                shipping_cost: ship,
                shipping_method: shippingMethod,
                shipping_label: chosen ? (order.shipping_info as any)?.carrier || null : null,
                free_shipping: chosen && !!order.free_shipping,

                total: tot,
                pix_discount_percent: pixPct,
                pix_discount: pixPct ? Math.round(tot * (pixPct / 100) * 100) / 100 : 0,
                pix_total: pixPct ? Math.round(tot * (1 - pixPct / 100) * 100) / 100 : tot,
                is_paid: !!order.is_paid,
                confirmed_at: order.customer_confirmed_at,
                items_signature: itemsSignature(order),
                // Só volta a pedir confirmação se os itens mudaram depois do "sim".
                needs_confirm:
                  !order.is_paid &&
                  (order.products || []).length > 0 &&
                  (!order.customer_confirmed_at ||
                    (!!order.confirmed_items_signature &&
                      order.confirmed_items_signature !== itemsSignature(order))),
                payment_window_expires_at: order.payment_window_expires_at,
                checkout_url: `/checkout/order/${order.id}`,
              };
            })()
          : null,


        prizes,
        raffles,
        history: history ?? undefined,
      };
    }

    // ---------- actions ----------
    if (action === "bootstrap") {
      const event = await resolveCurrentEvent();
      // Telefone público da instância de WhatsApp configurada no evento (botão "Falar com uma vendedora").
      let supportPhone: string | null = null;
      if (event?.whatsapp_number_id) {
        const { data: num } = await supabase
          .from("whatsapp_numbers")
          .select("phone_display")
          .eq("id", event.whatsapp_number_id)
          .maybeSingle();
        const digits = String((num as any)?.phone_display || "").replace(/\D/g, "");
        if (digits.length >= 10) supportPhone = digits.startsWith("55") ? digits : `55${digits}`;
      }
      return json({
        ok: true,
        event: event
          ? {
              id: event.id,
              name: event.name,
              is_live: !!event.is_live_broadcasting,
              instagram_live_url: event.instagram_live_url,
              support_phone: supportPhone,
            }
          : null,
      });
    }

    /**
     * OTP só é exigido de quem NUNCA se identificou: sem pedido no evento,
     * sem pedido antigo, sem cadastro e sem verificação anterior de WhatsApp.
     */
    async function isKnownCustomer(phone: string) {
      const suf = suffix8(phone);
      const customers = await loadCustomers(phone);
      const ids = customers.map((c: any) => c.id);
      if (ids.length) {
        const { count } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("customer_id", ids);
        if ((count || 0) > 0) return true;
      }
      const { data: reg } = await supabase
        .from("customer_registrations")
        .select("id")
        .ilike("whatsapp", `%${suf}`)
        .limit(1)
        .maybeSingle();
      if (reg) return true;
      const { data: ver } = await supabase
        .from("live_phone_verifications")
        .select("id")
        .eq("phone", phone)
        .eq("verified", true)
        .limit(1)
        .maybeSingle();
      return !!ver;
    }

    // Envio de código ANTES da sessão (cadastro novo sem pedidos).
    if (action === "send_otp" && !body.token) {
      const ph = normalizePhone(body.phone);
      if (!ph) return json({ ok: false, error: "Telefone inválido" }, 400);
      if (!(await allow(`otp:${ph}`, 3, 600))) {
        return await blocked("rate_limit_otp", "Você já pediu vários códigos. Aguarde alguns minutos.");
      }
      if (!(await allow(`otp-ip:${ip}`, 10, 3600))) {
        return await blocked("rate_limit_otp_ip", "Muitas solicitações de código. Tente mais tarde.");
      }
      const r = await sendAccessCode(supabase, ph);
      if (!r.ok) return json({ ok: false, error: r.error || "Falha ao enviar código" }, 500);
      return json({ ok: true });
    }

    if (action === "enter") {

      // Anti-abuso brando: operadoras móveis compartilham o mesmo IP (CGNAT) e a
      // cliente costuma recarregar a página várias vezes, então a cota precisa ser
      // alta o bastante para não bloquear gente real.
      if (!(await allow(`enter-ip:${ip}`, 120, 600))) {
        return await blocked("rate_limit_enter_ip", "Muitas tentativas de acesso. Aguarde alguns minutos.");
      }
      const phoneKey = normalizePhone(body.phone);
      if (phoneKey && !(await allow(`enter:${phoneKey}`, 60, 3600))) {
        return await blocked("rate_limit_enter_phone", "Muitas tentativas com este número. Tente mais tarde.");
      }


      const event = await resolveCurrentEvent();


      const phone = normalizePhone(body.phone);
      if (!phone) return json({ ok: false, error: "Telefone inválido" }, 400);

      const providedName = String(body.name || "").trim();
      let { customer } = await loadOrder(event?.id || null, phone);
      let name = customer?.instagram_handle || null;

      if (!name && !providedName && !body.magicVerified) return json({ ok: true, needsName: true });
      if (!name) name = providedName || "Cliente";

      // OTP apenas para cadastro NOVO sem nenhum pedido/histórico.
      // O link mágico já é fator de posse (chegou no WhatsApp dela): dispensa OTP.
      if (!body.magicVerified && !(await isKnownCustomer(phone))) {
        const code = String(body.otp || "").replace(/\D/g, "");
        if (!code) return json({ ok: false, error: "otp_required", needsOtp: true });
        if (!(await allow(`otpv:${phone}`, 8, 600))) {
          return await blocked("rate_limit_otp_verify", "Muitas tentativas. Aguarde alguns minutos.");
        }
        if (!(await verifyAccessCode(supabase, phone, code))) {
          return json({ ok: false, error: "Código incorreto.", needsOtp: true });
        }
        await supabase.from("live_phone_verifications").insert({ phone, code, verified: true });
      }

      // Telefone verificado: se ainda não achamos a cliente pelo número, casa
      // pelo @ do Instagram (pedido criado na live sem WhatsApp). Assim o número
      // digitado aqui entra automaticamente no cadastro dela dentro do evento.
      if (!customer && providedName) {
        const handle = providedName.replace(/^@/, "").trim().toLowerCase();
        if (handle) {
          const { data: byHandle } = await supabase
            .from("customers")
            .select("id, instagram_handle, whatsapp")
            .or(`instagram_handle.ilike.${handle},instagram_handle.ilike.@${handle}`)
            .limit(5);
          const target = (byHandle || []).find(
            (c: any) => !c.whatsapp || !String(c.whatsapp).trim(),
          );
          if (target) {
            await supabase.from("customers").update({ whatsapp: phone }).eq("id", target.id);
            customer = { ...target, whatsapp: phone } as any;
            // Pedido que estava incompleto por falta do WhatsApp já pode seguir
            await supabase
              .from("orders")
              .update({ stage: "awaiting_confirmation" })
              .eq("customer_id", target.id)
              .eq("stage", "incomplete_order");
          }

        }
      }




      // Garante cadastro do contato + lead da live
      if (!customer) {
        await supabase.from("customers").insert({ instagram_handle: name, whatsapp: phone });
      } else if (providedName && !customer.instagram_handle) {
        await supabase.from("customers").update({ instagram_handle: name }).eq("id", customer.id);
      }


      if (event?.id) {
        const { data: existingLead } = await supabase
          .from("event_leads")
          .select("id")
          .eq("event_id", event.id)
          .eq("phone", phone)
          .maybeSingle();
        if (!existingLead) {
          // O erro precisa aparecer: já perdemos cadastros do evento por falhas
          // silenciosas (constraint de `source` e coluna gerada `phone_suffix`).
          const { error: leadErr } = await supabase.from("event_leads").insert({
            event_id: event.id,
            name,
            phone,
            source: "member_area",
          });
          if (leadErr) console.error("[member-area] falha ao criar event_lead:", leadErr);
        }
      }

      // Lead da área de membros só é criado quando a pessoa é REALMENTE nova.
      // A área de membros é ponto de confirmação de pedido: se a cliente já era
      // lead de outro canal (typebot, LP, orgânico…) ou já era cliente com
      // compra anterior, criar um lead "area_membros" aqui canibalizava o canal
      // de aquisição real e inflava a conversão do painel Marketing > Leads.
      // O caso legítimo (sorteio anunciado na live para quem se cadastrar sem
      // pedido) continua sendo captado normalmente.
      background((async () => {
        try {
          const last8 = suffix8(phone);

          // (a) já existe lead em qualquer origem?
          const { data: anyLead } = await supabase
            .from("lp_leads")
            .select("id, source")
            .ilike("phone", `%${last8}`)
            .limit(1);
          if (anyLead?.length) {
            console.log(`[member-area] lead já existe (origem ${anyLead[0].source}) — não cria area_membros`);
            return;
          }

          // (b) já existe lead de evento por outra origem?
          const { data: evLead } = await supabase
            .from("event_leads")
            .select("id, source")
            .eq("phone_suffix", last8)
            .neq("source", "member_area")
            .limit(1);
          if (evLead?.length) {
            console.log(`[member-area] event_lead prévio (origem ${evLead[0].source}) — não cria area_membros`);
            return;
          }

          // (c) já é cliente com compra anterior?
          const { data: cust } = await supabase
            .from("customers_unified")
            .select("id, total_orders")
            .eq("phone_suffix8", last8)
            .gt("total_orders", 0)
            .limit(1);
          if (cust?.length) {
            console.log("[member-area] já é cliente com compra — não cria lead area_membros");
            return;
          }

          await supabase.from("lp_leads").insert({
            name,
            phone,
            source: "area_membros",
            campaign_tag: event?.name || "Área de Membros",
            metadata: { event_id: event?.id || null, origin: "minha-area" },
          });
        } catch (e) {
          console.error("[member-area] falha ao registrar lead no Marketing:", e);
        }
      })());

      // Ponto 5 — lead entra no CRM unificado (RFM/disparos)
      background(upsertUnified({ phone, name }));

      const token = newToken();

      const { data: session } = await supabase
        .from("live_member_sessions")
        .insert({ token, event_id: event?.id || null, phone, name })

        .select()
        .single();

      const state = await buildState(session);

      // Rastro do caso mais comum de "não consegui pagar": a cliente entra na
      // área de membros e nenhum pedido do evento casa com o telefone dela
      // (telefone anotado errado na live, número diferente do usado no login).
      if (!(state as any)?.order) {
        flow.phone = phone;
        flow.name = name;
        await logFriction(
          "entrou_sem_pedido",
          "Cliente entrou na área de membros e nenhum pedido do evento foi localizado pelo telefone",
          { event_id: event?.id || null, event_name: event?.name || null },
        );
      }

      return json(state);
    }

    const session = await loadSession(String(body.token || ""));
    if (!session) return json({ ok: false, error: "session_expired" }, 401);
    flow.phone = session.phone || flow.phone;
    flow.name = session.name || flow.name;


    if (action === "state") {
      await supabase
        .from("live_member_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", session.id);
      return json(await buildState(session));
    }

    // Auditoria dos passos de pagamento na Área de Membros.
    // Best-effort e sempre 200: nunca pode atrapalhar o pagamento da cliente.
    if (action === "track_payment_step") {
      try {
        const { order } = await loadOrder((await resolveCurrentEvent())?.id || null, session.phone);
        await supabase.from("order_payment_events").insert({
          order_id: String(body?.orderId || order?.id || `member-area:${session.phone}`),
          customer_phone: session.phone,
          event_type: String(body?.eventType || "unknown").slice(0, 60),
          method: body?.method ? String(body.method).slice(0, 30) : null,
          gateway: body?.gateway ? String(body.gateway).slice(0, 40) : null,
          amount: Number.isFinite(Number(body?.amount)) ? Number(body.amount) : null,
          detail: body?.detail ? String(body.detail).slice(0, 500) : null,
          source: "member_area",
          metadata: {
            name: session.name || null,
            ...(body?.metadata && typeof body.metadata === "object" ? body.metadata : {}),
          },
        });
      } catch (e) {
        console.error("[track_payment_step] ignorado:", e);
      }
      return json({ ok: true });
    }

    /**
     * Sinais de atribuição da Meta capturados no navegador da cliente
     * (_fbp, _fbc/fbclid, user-agent, IP, URL de origem).
     *
     * Grava em dois lugares:
     *  1) `customer_registrations` do pedido atual — é de onde a `meta-capi-event`
     *     reidrata os sinais quando o Purchase é disparado pelo servidor;
     *  2) memória de atribuição por telefone (90 dias) — serve para conversões
     *     futuras dela no PDV/loja física.
     *
     * Best-effort e sempre 200: nunca pode atrapalhar a área de membros.
     */
    if (action === "meta_signals") {
      try {
        const fbp = typeof body?.fbp === "string" && body.fbp ? body.fbp.slice(0, 200) : null;
        const fbc =
          (typeof body?.fbc === "string" && body.fbc ? body.fbc.slice(0, 300) : null) ||
          buildFbc(typeof body?.fbclid === "string" ? body.fbclid : null);
        const ua = typeof body?.user_agent === "string" ? body.user_agent.slice(0, 500) : null;
        const sourceUrl =
          typeof body?.event_source_url === "string" ? body.event_source_url.slice(0, 500) : null;
        const ip =
          req.headers.get("cf-connecting-ip") ||
          (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
          null;

        if (fbp || fbc || ua) {
          const { order } = await loadOrder((await resolveCurrentEvent())?.id || null, session.phone);
          if (order?.id) {
            const { data: reg } = await supabase
              .from("customer_registrations")
              .select("id, fbp, fbc")
              .eq("order_id", order.id)
              .maybeSingle();
            if (reg?.id) {
              const patch: Record<string, unknown> = {};
              if (fbp && !reg.fbp) patch.fbp = fbp;
              if (fbc && !reg.fbc) patch.fbc = fbc;
              if (ua) patch.client_user_agent = ua;
              if (ip) patch.client_ip = ip;
              if (sourceUrl) patch.event_source_url = sourceUrl;
              if (Object.keys(patch).length) {
                await supabase.from("customer_registrations").update(patch).eq("id", reg.id);
              }
            }
          }

          await saveMetaAttribution(supabase, {
            phone: session.phone,
            fbc,
            fbp,
            fbclid: typeof body?.fbclid === "string" ? body.fbclid : null,
            source_url: sourceUrl,
            origin: "member_area",
          });
        }
      } catch (e) {
        console.error("[meta_signals] ignorado:", e);
      }
      return json({ ok: true });
    }




    if (action === "confirm_order") {
      const { order } = await loadOrder((await resolveCurrentEvent())?.id || null, session.phone);
      if (!order) {
        await logFriction("pedido_nao_localizado", "Cliente na área de membros sem pedido vinculado ao telefone informado");
        return json({ ok: false, error: "Nenhum pedido encontrado" }, 404);
      }
      if (order.is_paid) return json(await buildState(session));

      const expires = new Date(Date.now() + PAYMENT_WINDOW_MIN * 60_000).toISOString();
      const { error: confErr } = await supabase
        .from("orders")
        .update({
          stage: "new",
          customer_confirmed_at: new Date().toISOString(),
          confirmed_items_signature: itemsSignature(order),
          payment_window_expires_at: expires,
        })
        .eq("id", order.id);
      if (confErr) return json({ ok: false, error: confErr.message }, 500);

      // Dispara o template Meta configurado na etapa MENSAGEM do evento (com link do carrinho).
      // Best-effort: falha no envio nunca bloqueia a confirmação.
      try {
        await supabase.functions.invoke("event-order-template-send", {
          body: { orderId: order.id },
        });
      } catch (e) {
        console.error("[confirm_order] falha ao enviar template:", e);
      }

      return json(await buildState(session));
    }


    if (action === "reject_item") {
      const { order } = await loadOrder((await resolveCurrentEvent())?.id || null, session.phone);
      if (!order) {
        await logFriction("pedido_nao_localizado", "Cliente na área de membros sem pedido vinculado ao telefone informado");
        return json({ ok: false, error: "Nenhum pedido encontrado" }, 404);
      }
      if (order.is_paid) return json({ ok: false, error: "Pedido já pago" }, 400);

      const idx = Number(body.index);
      const items = Array.isArray(order.products) ? [...order.products] : [];
      if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
        return json({ ok: false, error: "Item inválido" }, 400);
      }
      items.splice(idx, 1);

      // Ao remover o ÚLTIMO item o pedido é cancelado, mas os produtos originais
      // são preservados para que a equipe consiga ver o que a cliente recusou.
      await supabase
        .from("orders")
        .update(
          items.length
            ? { products: items }
            : { stage: "cancelled", payment_window_expires_at: null },
        )
        .eq("id", order.id);


      return json(await buildState(session));
    }

    if (action === "send_otp") {
      // Anti-spam de OTP: 3 envios por telefone a cada 10 min e 10 por IP/hora.
      if (!(await allow(`otp:${session.phone}`, 3, 600))) {
        return await blocked("rate_limit_otp", "Você já pediu vários códigos. Aguarde alguns minutos.");
      }
      if (!(await allow(`otp-ip:${ip}`, 10, 3600))) {
        return await blocked("rate_limit_otp_ip", "Muitas solicitações de código. Tente mais tarde.");
      }
      const r = await sendAccessCode(supabase, session.phone);
      if (!r.ok) return json({ ok: false, error: r.error || "Falha ao enviar código" }, 500);
      return json({ ok: true });
    }

    if (action === "verify_otp") {
      // Anti-força bruta: 8 tentativas por telefone a cada 10 min.
      if (!(await allow(`otpv:${session.phone}`, 8, 600))) {
        return await blocked("rate_limit_otp_verify", "Muitas tentativas. Aguarde alguns minutos.");
      }
      const code = String(body.code || "").replace(/\D/g, "");
      const ok = await verifyAccessCode(supabase, session.phone, code);
      if (!ok) return json({ ok: false, error: "Código incorreto." });

      const until = new Date(Date.now() + OTP_SESSION_MIN * 60_000).toISOString();
      const { data: updated } = await supabase
        .from("live_member_sessions")
        .update({ otp_verified_until: until })
        .eq("id", session.id)
        .select()
        .single();

      return json(await buildState(updated));
    }


    if (action === "save_details") {
      const { order } = await loadOrder((await resolveCurrentEvent())?.id || null, session.phone);
      if (!order) {
        // Cadastro SEM pedido (cliente que entrou só para se cadastrar/sorteio):
        // `customer_registrations` exige `order_id`, então os dados dela vão
        // direto para o CRM unificado. Antes isso devolvia erro 400 e a cliente
        // via "Nenhum pedido para vincular os dados" ao salvar.
        const d0 = body.details || {};
        const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max) || null;
        const fullName = clean(d0.full_name, 120);
        if ("full_name" in d0 && fullName && !isRealFullName(fullName)) {
          return json(
            { ok: false, error: "Informe seu nome completo (nome e sobrenome), sem @ e sem números." },
            400,
          );
        }
        const emailRaw = clean(d0.email, 160);
        if (emailRaw && !isUsableEmail(emailRaw)) {
          return json({ ok: false, error: "E-mail inválido. Use um e-mail real." }, 400);
        }

        await upsertUnified({
          phone: session.phone,
          name: fullName || session.name,
          cpf: String(d0.cpf ?? "").replace(/\D/g, "").slice(0, 11) || null,
          email: emailRaw,
        });

        const addr: Record<string, unknown> = {};
        const addrMap: [string, number][] = [
          ["cep", 8],
          ["address", 200],
          ["address_number", 20],
          ["complement", 120],
          ["neighborhood", 120],
          ["city", 120],
          ["state", 2],
        ];
        for (const [key, max] of addrMap) {
          if (!(key in d0)) continue;
          const v = key === "cep"
            ? String(d0[key] ?? "").replace(/\D/g, "").slice(0, 8) || null
            : clean(d0[key], max);
          if (v) addr[key] = key === "state" ? String(v).toUpperCase() : v;
        }
        if (Object.keys(addr).length) {
          const { error: addrErr } = await supabase
            .from("customers_unified")
            .update(addr)
            .eq("phone_suffix8", suffix8(session.phone));
          if (addrErr) console.error("[live-member-area] save_details CRM address", addrErr);
        }

        return json(await buildState(session, { skipHistory: true }));
      }


      const { data: reg } = await supabase
        .from("customer_registrations")
        .select("*")
        .eq("order_id", order.id)
        .maybeSingle();

      const otpUnlocked =
        !!session.otp_verified_until && new Date(session.otp_verified_until) > new Date();

      const d = body.details || {};
      const sanitize: Record<string, (v: unknown) => string | null> = {
        cpf: (v) => String(v || "").replace(/\D/g, "").slice(0, 11) || null,
        email: (v) => String(v || "").trim().slice(0, 160) || null,
        cep: (v) => String(v || "").replace(/\D/g, "").slice(0, 8) || null,
        address: (v) => String(v || "").slice(0, 200) || null,
        address_number: (v) => String(v || "").slice(0, 20) || null,
        complement: (v) => String(v || "").slice(0, 120) || null,
        neighborhood: (v) => String(v || "").slice(0, 120) || null,
        city: (v) => String(v || "").slice(0, 120) || null,
        state: (v) => String(v || "").slice(0, 2).toUpperCase() || null,
      };

      const changes: Record<string, unknown> = {};
      for (const [key, fn] of Object.entries(sanitize)) {
        if (!(key in d)) continue;
        changes[key] = fn((d as any)[key]);
      }

      // E-mail entra no `payer` do gateway: recusa lixo antes de gravar.
      if ("email" in changes && changes.email && !isUsableEmail(String(changes.email))) {
        return json({ ok: false, error: "E-mail inválido. Use um e-mail real para a cobrança." }, 400);
      }

      // Sem OTP a cliente só PREENCHE campos vazios (onboarding). Alterar um dado
      // SENSÍVEL já existente (CPF/e-mail) continua exigindo o código do WhatsApp.
      // Os campos de ENDEREÇO ficam livres: o rascunho automático já grava CEP/rua/
      // bairro/cidade enquanto ela digita, e bloquear a edição seguinte jogava a
      // cliente de volta para a etapa de endereço em loop.
      const OTP_PROTECTED = new Set(["cpf", "email"]);
      if (!otpUnlocked && reg) {
        for (const [key, value] of Object.entries(changes)) {
          if (!OTP_PROTECTED.has(key)) continue;
          const current = (reg as any)[key];
          if (current && String(current).trim() && String(current) !== String(value ?? "")) {
            return json({ ok: false, error: "otp_required" });
          }
        }
      }

      const payload: Record<string, unknown> = {
        order_id: order.id,
        whatsapp: session.phone,
        ...changes,
      };
      // Nome do pagador: só nome real (nome + sobrenome). NUNCA o @ do Instagram
      // da sessão — era o que subia o score de antifraude nos gateways.
      if ("full_name" in d) {
        const candidate = String(d.full_name || "").trim().slice(0, 120);
        if (!isRealFullName(candidate)) {
          return json(
            { ok: false, error: "Informe seu nome completo (nome e sobrenome), sem @ e sem números." },
            400,
          );
        }
        if (!isRealFullName(reg?.full_name) || otpUnlocked) payload.full_name = candidate;
      }


      if (reg?.id) {
        const { error: upErr } = await supabase
          .from("customer_registrations")
          .update(nonNullReg(payload))
          .eq("id", reg.id);
        if (upErr) {
          console.error("[live-member-area] save_details update", upErr);
          return json({ ok: false, error: `Erro ao salvar dados: ${upErr.message}` });
        }
      } else {
        const { error: insErr } = await supabase
          .from("customer_registrations")
          .insert(withRegDefaults(payload));
        if (insErr) {
          console.error("[live-member-area] save_details insert", insErr);
          return json({ ok: false, error: `Erro ao salvar dados: ${insErr.message}` });
        }
      }


      // Ponto 5 — enriquece o CRM unificado (em segundo plano, não trava a etapa)
      background(
        upsertUnified({
          phone: session.phone,
          name: (payload.full_name as string) || session.name,
          cpf: (payload.cpf as string) ?? null,
          email: (payload.email as string) ?? null,
        }),
      );

      return json(await buildState(session, { skipHistory: true }));
    }


    /**
     * Opções de envio da área de membros — as MESMAS do link de checkout:
     * usa a edge function `checkout-quote-freight` (regras de evento, frete fixo,
     * retirada e mototaxista só em Governador Valadares) e devolve o prazo.
     */
    async function shippingChoices(rawCep: string) {
      const cep = String(rawCep || "").replace(/\D/g, "").slice(0, 8);
      const event = await resolveCurrentEvent();
      const { order } = await loadOrder(event?.id || null, session.phone);
      const subtotal = order ? Math.max(0, orderSubtotal(order) - orderDiscount(order)) : 0;
      const itemsCount = (order?.products || []).reduce(
        (s: number, p: any) => s + Number(p.quantity || 1),
        0,
      );

      // A opção de entrega deve refletir exatamente o pedido/evento, e não o
      // menor preço bruto devolvido pela transportadora.
      let eventFixed = 0;
      let eventFreeAbove = 0;
      const shippingEventId = order?.event_id || event?.id || null;
      if (shippingEventId) {
        const { data: shippingEvent } = await supabase
          .from("events")
          .select("default_shipping_cost, free_shipping_threshold")
          .eq("id", shippingEventId)
          .maybeSingle();
        eventFixed = Number(shippingEvent?.default_shipping_cost || 0);
        eventFreeAbove = Number(shippingEvent?.free_shipping_threshold || 0);
      }
      const orderHasFreeShipping = order?.free_shipping === true;
      const eventThresholdReached = eventFreeAbove > 0 && subtotal >= eventFreeAbove;
      const forceFreeDelivery = orderHasFreeShipping || eventThresholdReached;

      let quotes: any[] = [];
      if (cep.length === 8) {
        try {
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/checkout-quote-freight`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              recipient_cep: cep,
              total_value: subtotal,
              items_count: itemsCount || 1,
              order_id: order?.id || null,
               event_id: shippingEventId,
               free_shipping: orderHasFreeShipping,
            }),
          });
          const j = await r.json().catch(() => null);
          if (r.ok && j?.success) quotes = j.quotes || [];
          else console.warn("[live-member-area] quote-freight falhou", r.status, JSON.stringify(j)?.slice(0, 300));
        } catch (e) {
          console.warn("[live-member-area] quote-freight erro", String((e as Error).message));
        }
      }

      const isGV = quotes.some((q) => q.type === "pickup" || q.type === "local");
      const eta = (days: number | null | undefined) =>
        days && days > 0 ? `Prazo de ${days} dia${days > 1 ? "s" : ""} úte${days > 1 ? "is" : "l"}` : null;

      const options: {
        id: string;
        label: string;
        description: string;
        cost: number;
        delivery_days: number | null;
      }[] = [];

      // 1) Envio para o endereço. Prioridade obrigatória:
      //    grátis no pedido > grátis por faixa do evento > fixo do evento > cotação.
      const deliveryQuotes = quotes.filter(
        (q) => !["pickup", "local"].includes(q.type),
      );
      if (deliveryQuotes.length) {
        const eventQuote = deliveryQuotes.find((q) => ["event_free", "event_fixed"].includes(q.type));
        const best = eventQuote || deliveryQuotes.reduce((a, c) => (Number(c.price) < Number(a.price) ? c : a));
        const days = best.delivery_days ?? null;
        const cost = forceFreeDelivery
          ? 0
          : eventFixed > 0
            ? eventFixed
            : Math.max(0, Number(best.price) || 0);
        options.push({
          id: "delivery",
          label: "Envio para o meu endereço",
          description:
            cost > 0
              ? [best.carrier, eta(days)].filter(Boolean).join(" · ")
              : ["Frete grátis nesta compra", eta(days)].filter(Boolean).join(" · "),
          cost: Math.round(cost * 100) / 100,
          delivery_days: days,
        });
      } else {
        // Fallback seguro quando a transportadora não responde.
        const cost = forceFreeDelivery ? 0 : eventFixed;
        options.push({
          id: "delivery",
          label: "Envio para o meu endereço",
          description: cost > 0 ? "Transportadora / Correios" : "Frete grátis nesta compra",
          cost,
          delivery_days: null,
        });
      }

      // 2) Retirada e mototaxista (somente Governador Valadares).
      const pickup = quotes.find((q) => q.type === "pickup");
      if (pickup) {
        options.push({
          id: "pickup",
          label: "Retirada na loja",
          description: "Você retira na loja em Governador Valadares",
          cost: 0,
          delivery_days: 0,
        });
      }
      const moto = quotes.find((q) => q.type === "local");
      if (moto) {
        options.push({
          id: "mototaxi",
          label: "Entrega por mototaxista",
          description: "Somente Governador Valadares — entrega no mesmo dia",
          cost: Math.round(Number(moto.price) * 100) / 100,
          delivery_days: 0,
        });
      }

      return { isGV, options };
    }

    if (action === "shipping_options") {
      const r = await shippingChoices(String(body.cep || ""));
      // Guarda a cotação na sessão: a escolha seguinte não precisa cotar de novo
      // (a cotação com transportadora é o que deixava a etapa lenta).
      background(
        supabase
          .from("live_member_sessions")
          .update({
            shipping_quote: {
              cep: String(body.cep || "").replace(/\D/g, "").slice(0, 8),
              options: r.options,
              at: new Date().toISOString(),
            },
          })
          .eq("id", session.id) as unknown as Promise<unknown>,
      );
      return json({ ok: true, ...r });
    }

    if (action === "set_shipping") {
      const event = await resolveCurrentEvent();
      const { order } = await loadOrder(event?.id || null, session.phone);
      if (!order) {
        await logFriction("pedido_nao_localizado", "Cliente tentou escolher o envio sem pedido vinculado ao telefone informado");
        return json({ ok: false, error: "Nenhum pedido encontrado" });
      }
      if (order.is_paid) return json({ ok: false, error: "Pedido já pago" });

      const cepDigits = String(body.cep || "").replace(/\D/g, "").slice(0, 8);
      const cached = (session as any).shipping_quote;
      const cacheFresh =
        cached?.cep === cepDigits &&
        Array.isArray(cached?.options) &&
        Date.now() - new Date(cached.at || 0).getTime() < 15 * 60_000;

      const options = cacheFresh
        ? (cached.options as any[])
        : (await shippingChoices(cepDigits)).options;
      const chosen = options.find((o: any) => o.id === String(body.method || ""));
      if (!chosen) return json({ ok: false, error: "Forma de envio indisponível" });

      const { error: upErr } = await supabase
        .from("orders")
        .update({
          shipping_cost: chosen.cost,
          free_shipping: chosen.cost === 0,
          shipping_info: {
            source: "member_area",
            method: chosen.id,
            carrier: chosen.label,
            description: chosen.description,
            price: chosen.cost,
            delivery_days: chosen.delivery_days,
            cep: cepDigits,
            applied_at: new Date().toISOString(),
          },
        })
        .eq("id", order.id);

      if (upErr) {
        console.error("[live-member-area] set_shipping update", upErr);
        return json({ ok: false, error: `Erro ao salvar envio: ${upErr.message}` });
      }

      return json(await buildState(session, { skipHistory: true }));
    }



    return json({ ok: false, error: "unknown_action" }, 400);

  } catch (e) {
    console.error("[live-member-area]", e);
    await logFriction("erro_inesperado", String((e as Error)?.message || e));
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
