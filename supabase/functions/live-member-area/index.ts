// Área de Clientes pública da Live (link único fixado no Instagram).
// Identidade = telefone digitado (sem OTP na entrada, para captar leads).
// OTP funciona como "cofre": só libera leitura/edição dos dados pessoais.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendAccessCode, verifyAccessCode } from "../_shared/access-code.ts";


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


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const ip = clientIp(req);

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

    // Cota global por IP para qualquer ação (protege o endpoint público inteiro)
    if (!(await allow(`ip:${ip}`, 120, 60))) {
      return json({ ok: false, error: "Muitas requisições. Tente novamente em instantes." }, 429);
    }



    // ---------- helpers ----------
    /**
     * Link ÚNICO e global (bio do Instagram): não existe slug por live.
     * Vale para QUALQUER evento (manual ou área de clientes).
     * Prioriza a live no ar; senão, o evento ativo mais recente.
     */
    async function resolveCurrentEvent() {
      const base = () =>
        supabase
          .from("events")
          .select("id, name, operation_mode, is_active, is_live_broadcasting, instagram_live_url")
          .neq("is_active", false);

      const { data: live } = await base()
        .eq("is_live_broadcasting", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (live?.[0]) return live[0];

      const { data: latest } = await base().order("created_at", { ascending: false }).limit(1);
      return latest?.[0] || null;
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

    async function loadCustomers(phone: string) {
      const suf = suffix8(phone);
      const { data } = await supabase
        .from("customers")
        .select("id, instagram_handle, whatsapp")
        .not("whatsapp", "is", null)
        .ilike("whatsapp", `%${suf}`);
      return data || [];
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
      const subtotal = orderSubtotal(order);

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

    async function buildState(session: any) {
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


      const history = await loadHistory(session.phone, order?.id || null);
      const pixPct = order && !order.is_paid ? await pixDiscountPercent() : 0;




      let reg: any = null;
      if (order?.id) {
        const { data } = await supabase
          .from("customer_registrations")
          .select("*")
          .eq("order_id", order.id)
          .maybeSingle();
        reg = data;
      }

      const otpUnlocked =
        !!session.otp_verified_until && new Date(session.otp_verified_until) > new Date();
      const hasDetails = !!(reg && (reg.cpf || reg.cep || reg.email));
      const shippingMethod = (order?.shipping_info as any)?.method || null;
      /** Onboarding pós-confirmação: endereço + envio + CPF + e-mail. */
      const onboarding = {
        address: !!(reg?.cep && reg?.address && reg?.address_number),
        shipping: !!shippingMethod,
        cpf: !!reg?.cpf,
        email: !!reg?.email,
      };

      return {
        ok: true,
        token: session.token,
        event,
        onboarding,
        onboardingComplete:
          onboarding.address && onboarding.shipping && onboarding.cpf && onboarding.email,

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
                payment_window_expires_at: order.payment_window_expires_at,
                checkout_url: `/checkout/order/${order.id}`,
              };
            })()
          : null,


        history,
      };
    }

    // ---------- actions ----------
    if (action === "bootstrap") {
      const event = await resolveCurrentEvent();
      return json({
        ok: true,
        event: event
          ? {
              id: event.id,
              name: event.name,
              is_live: !!event.is_live_broadcasting,
              instagram_live_url: event.instagram_live_url,
            }
          : null,
      });
    }

    if (action === "enter") {
      // Anti-abuso: 10 entradas por IP a cada 10 min e 6 por telefone/hora.
      if (!(await allow(`enter-ip:${ip}`, 10, 600))) {
        return json({ ok: false, error: "Muitas tentativas de acesso. Aguarde alguns minutos." }, 429);
      }
      const phoneKey = normalizePhone(body.phone);
      if (phoneKey && !(await allow(`enter:${phoneKey}`, 6, 3600))) {
        return json({ ok: false, error: "Muitas tentativas com este número. Tente mais tarde." }, 429);
      }

      const event = await resolveCurrentEvent();


      const phone = normalizePhone(body.phone);
      if (!phone) return json({ ok: false, error: "Telefone inválido" }, 400);

      const providedName = String(body.name || "").trim();
      const { customer } = await loadOrder(event?.id || null, phone);
      let name = customer?.instagram_handle || null;

      if (!name && !providedName) return json({ ok: true, needsName: true });
      if (!name) name = providedName;

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
          await supabase.from("event_leads").insert({
            event_id: event.id,
            name,
            phone,
            phone_suffix: suffix8(phone),
            source: "member_area",
          });
        }
      }

      // Ponto 5 — lead entra no CRM unificado (RFM/disparos)
      await upsertUnified({ phone, name });

      const token = newToken();

      const { data: session } = await supabase
        .from("live_member_sessions")
        .insert({ token, event_id: event?.id || null, phone, name })

        .select()
        .single();

      return json(await buildState(session));
    }

    const session = await loadSession(String(body.token || ""));
    if (!session) return json({ ok: false, error: "session_expired" }, 401);

    if (action === "state") {
      await supabase
        .from("live_member_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", session.id);
      return json(await buildState(session));
    }

    if (action === "confirm_order") {
      const { order } = await loadOrder((await resolveCurrentEvent())?.id || null, session.phone);
      if (!order) return json({ ok: false, error: "Nenhum pedido encontrado" }, 404);
      if (order.is_paid) return json(await buildState(session));

      const expires = new Date(Date.now() + PAYMENT_WINDOW_MIN * 60_000).toISOString();
      await supabase
        .from("orders")
        .update({
          stage: "new",
          customer_confirmed_at: new Date().toISOString(),
          payment_window_expires_at: expires,
        })
        .eq("id", order.id);

      return json(await buildState(session));
    }

    if (action === "reject_item") {
      const { order } = await loadOrder((await resolveCurrentEvent())?.id || null, session.phone);
      if (!order) return json({ ok: false, error: "Nenhum pedido encontrado" }, 404);
      if (order.is_paid) return json({ ok: false, error: "Pedido já pago" }, 400);

      const idx = Number(body.index);
      const items = Array.isArray(order.products) ? [...order.products] : [];
      if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
        return json({ ok: false, error: "Item inválido" }, 400);
      }
      items.splice(idx, 1);

      await supabase
        .from("orders")
        .update(
          items.length
            ? { products: items }
            : { products: items, stage: "cancelled", payment_window_expires_at: null },
        )
        .eq("id", order.id);

      return json(await buildState(session));
    }

    if (action === "send_otp") {
      // Anti-spam de OTP: 3 envios por telefone a cada 10 min e 10 por IP/hora.
      if (!(await allow(`otp:${session.phone}`, 3, 600))) {
        return json({ ok: false, error: "Você já pediu vários códigos. Aguarde alguns minutos." }, 429);
      }
      if (!(await allow(`otp-ip:${ip}`, 10, 3600))) {
        return json({ ok: false, error: "Muitas solicitações de código. Tente mais tarde." }, 429);
      }
      const r = await sendAccessCode(supabase, session.phone);
      if (!r.ok) return json({ ok: false, error: r.error || "Falha ao enviar código" }, 500);
      return json({ ok: true });
    }

    if (action === "verify_otp") {
      // Anti-força bruta: 8 tentativas por telefone a cada 10 min.
      if (!(await allow(`otpv:${session.phone}`, 8, 600))) {
        return json({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
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
      if (!order) return json({ ok: false, error: "Nenhum pedido para vincular os dados" }, 400);

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

      // Sem OTP a cliente só PREENCHE campos vazios (onboarding). Alterar um dado
      // já existente continua exigindo o código do WhatsApp.
      if (!otpUnlocked && reg) {
        for (const [key, value] of Object.entries(changes)) {
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
      if (!reg?.full_name || (d.full_name && otpUnlocked)) {
        payload.full_name = String(d.full_name || session.name || "").slice(0, 120);
      }


      if (reg?.id) {
        await supabase.from("customer_registrations").update(payload).eq("id", reg.id);
      } else {
        await supabase.from("customer_registrations").insert(payload);
      }

      // Ponto 5 — enriquece o CRM unificado com CPF/e-mail/nome informados
      await upsertUnified({
        phone: session.phone,
        name: (payload.full_name as string) || session.name,
        cpf: (payload.cpf as string) ?? null,
        email: (payload.email as string) ?? null,
      });



      const { data: fresh } = await supabase
        .from("live_member_sessions")
        .select("*")
        .eq("id", session.id)
        .single();
      return json(await buildState(fresh));
    }

    /**
     * Opções de envio da área de membros. Retirada na loja e mototaxista
     * só aparecem para CEP de Governador Valadares/MG.
     */
    async function shippingChoices(rawCep: string) {
      const cep = String(rawCep || "").replace(/\D/g, "").slice(0, 8);
      let city: string | null = null;
      let uf: string | null = null;
      if (cep.length === 8) {
        try {
          const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
          const j = await r.json();
          if (!j?.erro) {
            city = j.localidade || null;
            uf = j.uf || null;
          }
        } catch {
          /* ignora — segue só com envio padrão */
        }
      }
      const isGV =
        uf === "MG" && String(city || "").toLowerCase().includes("governador valadares");

      const event = await resolveCurrentEvent();
      const { order } = await loadOrder(event?.id || null, session.phone);
      const subtotal = order ? orderSubtotal(order) : 0;

      let fixed = 0;
      let freeAbove = 0;
      if (order?.event_id) {
        const { data: ev } = await supabase
          .from("events")
          .select("default_shipping_cost, free_shipping_threshold")
          .eq("id", order.event_id)
          .maybeSingle();
        fixed = Number(ev?.default_shipping_cost || 0);
        freeAbove = Number(ev?.free_shipping_threshold || 0);
      }
      const deliveryCost = freeAbove > 0 && subtotal >= freeAbove ? 0 : fixed;

      let motoCost = 15;
      try {
        const { data } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "gv_mototaxi_cost")
          .maybeSingle();
        const v = Number(String(data?.value ?? "").replace(/"/g, ""));
        if (v > 0) motoCost = v;
      } catch {
        /* usa padrão */
      }

      const options: { id: string; label: string; description: string; cost: number }[] = [
        {
          id: "delivery",
          label: "Envio para o meu endereço",
          description: deliveryCost > 0 ? "Transportadora / Correios" : "Frete grátis nesta compra",
          cost: deliveryCost,
        },
      ];
      if (isGV) {
        options.push({
          id: "pickup",
          label: "Retirada na loja",
          description: "Você retira na loja em Governador Valadares",
          cost: 0,
        });
        options.push({
          id: "mototaxi",
          label: "Entrega por mototaxista",
          description: "Somente Governador Valadares — entrega no mesmo dia",
          cost: motoCost,
        });
      }
      return { city, uf, isGV, options };
    }

    if (action === "shipping_options") {
      const r = await shippingChoices(String(body.cep || ""));
      return json({ ok: true, ...r });
    }

    if (action === "set_shipping") {
      const event = await resolveCurrentEvent();
      const { order } = await loadOrder(event?.id || null, session.phone);
      if (!order) return json({ ok: false, error: "Nenhum pedido encontrado" }, 400);
      if (order.is_paid) return json({ ok: false, error: "Pedido já pago" }, 400);

      const { options } = await shippingChoices(String(body.cep || ""));
      const chosen = options.find((o) => o.id === String(body.method || ""));
      if (!chosen) return json({ ok: false, error: "Forma de envio indisponível" });

      await supabase
        .from("orders")
        .update({
          shipping_cost: chosen.cost,
          free_shipping: chosen.cost === 0,
          shipping_info: {
            source: "member_area",
            method: chosen.id,
            carrier: chosen.label,
            price: chosen.cost,
            applied_at: new Date().toISOString(),
          },
        })
        .eq("id", order.id);

      return json(await buildState(session));
    }

    return json({ ok: false, error: "unknown_action" }, 400);

  } catch (e) {
    console.error("[live-member-area]", e);
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
