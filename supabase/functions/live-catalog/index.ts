// Catálogo cross-sell da live (modo "WhatsApp + Cadastro online").
// Página pública /pedido/:slug/catalogo/:token. Todas as leituras/escritas passam aqui (service role).
// Pedidos criados aqui têm origin='catalog' e pulam o gatilho de carrinho/DM do Instagram.
// O primeiro item de um carrinho novo enfileira UMA mensagem com o link de pagamento; itens seguintes não.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeCatalogCashback, yourPrice, type Coupon } from "./cashback.ts";

const PUBLIC_BASE = "https://checkout.bananacalcados.com.br";
const MODE = "whatsapp_autoatendimento";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;
const firstName = (n?: string | null) => { const f = String(n || "").trim().split(/\s+/)[0] || ""; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ""; };
const cartUrl = (slug: string, id: string) => `${PUBLIC_BASE}/pedido/${slug}/carrinho/${id.replace(/-/g, "")}`;
const ORDER_COLS = "id, customer_id, products, is_paid, paid_externally, stage, cashback_id, cashback_amount, discount_type, discount_value, free_shipping, shipping_cost, created_at";

const VARIATIONS = [
  "Oii {nome}, seu novo carrinho já tá pronto 😊\n\nPra finalizar o pagamento clica no link:\n{link}\n\nJá já eu volto pra ver se deu certo, ok? 😊",
  "Oi {nome}! Montei seu novo carrinho ✅\n\nÉ só pagar por aqui:\n{link}\n\nDaqui a pouco passo pra confirmar, combinado? 😉",
  "Oii {nome}, carrinho novo prontinho 😁\n\nLink pra pagar:\n{link}\n\nVolto daqui a pouquinho pra ver se deu tudo certo, pode ser?",
];

function orderTotal(o: any) {
  const items = Array.isArray(o.products) ? o.products : [];
  const sub = items.reduce((s: number, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1), 0);
  const disc = o.discount_type && o.discount_value ? (o.discount_type === "percentage" ? sub * (Number(o.discount_value) / 100) : Number(o.discount_value)) : 0;
  const ship = o.free_shipping ? 0 : Number(o.shipping_cost || 0);
  return { sub: r2(sub), total: r2(Math.max(0, sub - disc) + ship) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SB_URL, SB_KEY);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const allow = async (key: string, limit: number, win: number) => {
    const { data, error } = await sb.rpc("live_member_rate_limit", { _key: key, _limit: limit, _window_seconds: win });
    return error ? true : data !== false;
  };

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const slug = String(body.slug || "").trim().toLowerCase().slice(0, 80);
    const token = String(body.token || "").trim().toLowerCase();
    if (!["open", "state", "add", "remove"].includes(action)) return json({ ok: false, error: "invalid_action" }, 400);
    if (!slug || !/^[0-9a-f]{32}$/.test(token)) return json({ ok: false, error: "invalid" }, 400);
    if (!(await allow(`catalog:ip:${ip}`, 120, 600)) || !(await allow(`catalog:tk:${token}`, 120, 600))) return json({ ok: false, error: "rate_limited" }, 429);

    const { data: ev } = await sb.from("events")
      .select("id, name, operation_mode, catalog_enabled, whatsapp_number_id, installment_max, installment_min_value, self_service_product_notice, google_rating_text, google_profile_url")
      .eq("self_service_slug", slug).maybeSingle();
    if (!ev || (ev as any).operation_mode !== MODE || !(ev as any).catalog_enabled) return json({ ok: false, error: "invalid" }, 404);
    const { data: link } = await sb.from("live_catalog_links").select("id, event_id, customer_id, phone_key, source_order_id, expires_at, opened_at, open_count")
      .eq("token", token).eq("event_id", (ev as any).id).maybeSingle();
    if (!link) return json({ ok: false, error: "invalid" }, 404);
    const L = link as any;
    if (Date.parse(L.expires_at) <= Date.now()) return json({ ok: false, error: "expired" });

    // ── Identidade: acesso do pedido de origem → cliente → cadastro.
    let access: any = null;
    if (L.source_order_id) {
      const { data: accId } = await sb.rpc("selfservice_access_for_order", { p_order_id: L.source_order_id });
      if (accId) access = (await sb.from("live_selfservice_accesses").select("confirmed_phone, confirmed_number_id").eq("id", accId).maybeSingle()).data;
    }
    let customerId: string | null = L.customer_id;
    if (!customerId && L.source_order_id) customerId = ((await sb.from("orders").select("customer_id").eq("id", L.source_order_id).maybeSingle()).data as any)?.customer_id ?? null;
    if (!customerId) {
      const { data } = await sb.from("customers").select("id").like("whatsapp", `%${L.phone_key}`).limit(2);
      if (data?.length === 1) customerId = (data[0] as any).id;
    }
    const cust = customerId ? (await sb.from("customers").select("whatsapp, instagram_handle").eq("id", customerId).maybeSingle()).data as any : null;
    const regSource = async () => {
      if (L.source_order_id) {
        const { data } = await sb.from("customer_registrations").select("*").eq("order_id", L.source_order_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (data) return data as any;
      }
      const { data } = await sb.from("customer_registrations").select("*").like("whatsapp", `%${L.phone_key}`).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data as any;
    };
    const phone = access?.confirmed_phone || cust?.whatsapp || null;
    const handle = String(cust?.instagram_handle || "").trim().replace(/^@/, "");

    // ── Cupom e carrinho
    const loadCoupon = async (orderId: string | null, ph: string | null): Promise<Coupon | null> => {
      if (!ph) return null;
      const { data } = await sb.rpc("catalog_available_cashback", { p_phone: ph, p_order_id: orderId });
      const c = (data as any[])?.[0];
      return c ? { id: c.id, cashback_amount: Number(c.cashback_amount), min_purchase: Number(c.min_purchase || 0), expires_at: c.expires_at } : null;
    };
    const latestCart = async () => {
      if (!customerId) return null;
      const { data } = await sb.from("orders").select(ORDER_COLS).eq("event_id", (ev as any).id).eq("customer_id", customerId)
        .eq("origin", "catalog").neq("stage", "cancelled").is("merged_into_order_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data as any;
    };
    /** Aplica a regra do cashback; só grava se algo mudou. */
    const syncCashback = async (o: any, coupon: Coupon | null) => {
      const r = computeCatalogCashback(o.products || [], coupon);
      const next = r.amount > 0
        ? { cashback_id: r.cashback_id, cashback_amount: r.amount, discount_type: "fixed", discount_value: r.amount }
        : { cashback_id: null, cashback_amount: 0, discount_type: null, discount_value: 0 };
      const same = (o.cashback_id ?? null) === next.cashback_id && Number(o.cashback_amount || 0) === next.cashback_amount
        && (o.discount_type ?? null) === next.discount_type && Number(o.discount_value || 0) === next.discount_value;
      if (same) return { o, r };
      const { data, error } = await sb.from("orders").update(next).eq("id", o.id).eq("is_paid", false).select(ORDER_COLS).single();
      if (error) throw error;
      return { o: data as any, r };
    };
    const { data: pixRow } = await sb.from("app_settings").select("value").eq("key", "pix_discount_percent").maybeSingle();
    const pixPct = Number((pixRow as any)?.value?.percent ?? (pixRow as any)?.value ?? 0) || 0;
    const cartOut = (o: any) => {
      const t = orderTotal(o);
      const noPix = !!o.cashback_id || Number(o.cashback_amount || 0) > 0;
      return {
        order_id: o.id,
        cart_url: cartUrl(slug, o.id),
        items: (o.products || []).map((p: any) => ({ id: p.id, title: p.title, variant: p.variant, price: Number(p.price || 0), quantity: Number(p.quantity || 1), image: p.image || null, promo: !!p.promo })),
        subtotal: t.sub,
        cashback_applied: Number(o.cashback_amount || 0),
        shipping: { free_shipping: !!o.free_shipping, shipping_cost: Number(o.shipping_cost || 0) },
        total: t.total,
        pix_total: noPix || !pixPct ? t.total : r2(t.total * (1 - pixPct / 100)),
        paid: false,
      };
    };
    const stateOf = async () => {
      let o = await latestCart();
      let coupon: Coupon | null = null; let hint: number | null = null;
      if (o && (o.is_paid || o.paid_externally)) {
        coupon = await loadCoupon(null, phone);
        return { coupon, hint, cart: null, last_paid_order_id: o.id, open: null };
      }
      coupon = await loadCoupon(o?.id ?? null, phone);
      if (o) { const s = await syncCashback(o, coupon); o = s.o; hint = s.r.min_purchase_hint; }
      else if (coupon && coupon.min_purchase > 0) hint = coupon.min_purchase;
      return { coupon, hint, cart: o ? cartOut(o) : null, last_paid_order_id: null, open: o };
    };
    let cashbackPending = false;
    if (L.source_order_id) {
      const { data: so } = await sb.from("orders").select("is_paid, paid_externally").eq("id", L.source_order_id).maybeSingle();
      if ((so as any)?.is_paid || (so as any)?.paid_externally) {
        const { count } = await sb.from("internal_cashback").select("id", { count: "exact", head: true }).eq("source_order_id", L.source_order_id);
        cashbackPending = !count;
      }
    }
    const respond = async (st: Awaited<ReturnType<typeof stateOf>>, extra: Record<string, unknown> = {}) => {
      const out: Record<string, unknown> = {
        ok: true,
        cashback: st.coupon ? { amount: st.coupon.cashback_amount, min_purchase: st.coupon.min_purchase, expires_at: st.coupon.expires_at } : null,
        cashback_pending: cashbackPending && !st.coupon,
        min_purchase_hint: st.hint,
        cart: st.cart,
        last_paid_order_id: st.last_paid_order_id,
        ...extra,
      };
      if (action === "open" || action === "add" || action === "remove") out.prices = await priceList(st.coupon, Number(st.cart?.cashback_applied || 0));
      return json(out);
    };
    async function catalogRows() {
      const { data } = await sb.from("event_catalog_products").select("id, shopify_product_id, title, image_url, images, original_price, offer_price, allow_cashback, variants, position")
        .eq("event_id", (ev as any).id).eq("is_active", true).order("position").limit(200);
      return (data || []) as any[];
    }
    async function priceList(coupon: Coupon | null, applied: number) {
      return (await catalogRows()).map((p) => {
        const promo = p.offer_price != null;
        const price = Number(promo ? p.offer_price : p.original_price);
        return { id: p.id, ...yourPrice(price, promo || !p.allow_cashback, coupon, applied) };
      });
    }

    if (action === "open") {
      await sb.from("live_catalog_links").update({ opened_at: L.opened_at || new Date().toISOString(), open_count: Number(L.open_count || 0) + 1 }).eq("id", L.id);
      const st = await stateOf();
      let officialLast4: string | null = null;
      const { data: wl } = await sb.from("live_whatsapp_links").select("whatsapp_number_id, target_phone").eq("event_id", (ev as any).id).order("is_active", { ascending: false }).limit(1).maybeSingle();
      const numId = (wl as any)?.whatsapp_number_id || (ev as any).whatsapp_number_id;
      if (numId) { const { data: wn } = await sb.from("whatsapp_numbers").select("phone_display").eq("id", numId).maybeSingle(); officialLast4 = digits((wn as any)?.phone_display).slice(-4) || null; }
      if (!officialLast4) officialLast4 = digits((wl as any)?.target_phone).slice(-4) || null;
      const reg = handle ? null : await regSource();
      const catalog = (await catalogRows()).map((p) => ({
        id: p.id, title: p.title, image_url: p.image_url, images: Array.isArray(p.images) ? p.images : [],
        original_price: Number(p.original_price), offer_price: p.offer_price != null ? Number(p.offer_price) : null, allow_cashback: !!p.allow_cashback,
        variants: (Array.isArray(p.variants) ? p.variants : []).filter((v: any) => v.enabled).map((v: any) => ({ variant_id: v.variant_id, title: v.title, image: v.image || null })),
      }));
      return respond(st, {
        event: {
          name: (ev as any).name, product_notice: (ev as any).self_service_product_notice, official_last4: officialLast4,
          google_rating: (ev as any).google_rating_text || null, google_url: (ev as any).google_profile_url || null,
          installment_max: (ev as any).installment_max, installment_min_value: (ev as any).installment_min_value,
        },
        customer: { greet: handle ? `@${handle}` : (firstName(reg?.full_name) || null) },
        catalog,
      });
    }

    if (action === "state") return respond(await stateOf());

    if (action === "add") {
      const qty = Math.max(1, Math.min(10, Math.floor(Number(body.quantity || 1))));
      const { data: cp } = await sb.from("event_catalog_products").select("id, shopify_product_id, title, image_url, original_price, offer_price, allow_cashback, variants, is_active")
        .eq("id", String(body.catalog_product_id || "")).eq("event_id", (ev as any).id).maybeSingle();
      const P = cp as any;
      const V = P?.is_active ? (P.variants || []).find((v: any) => v.variant_id === String(body.variant_id || "") && v.enabled) : null;
      if (!V) return json({ ok: false, error: "unavailable" }, 400);
      if (!customerId) return json({ ok: false, error: "customer_not_found" }, 400);
      const st0 = await stateOf();
      let o = st0.open;
      let created = false;
      if (!o) {
        const reg = await regSource();
        const ins = await sb.from("orders").insert({ event_id: (ev as any).id, customer_id: customerId, origin: "catalog", stage: "awaiting_payment", registered_at: new Date().toISOString(), products: [] }).select(ORDER_COLS).single();
        if (ins.error) {
          // Outro toque criou o carrinho ao mesmo tempo (índice único): usa o existente.
          o = (await stateOf()).open;
          if (!o) throw ins.error;
        } else {
          o = ins.data; created = true;
          if (reg) {
            const { id: _i, order_id: _o, created_at: _c, updated_at: _u, ...fields } = reg;
            const { error } = await sb.from("customer_registrations").insert({ ...fields, order_id: o.id });
            if (error) console.error("[live-catalog] cadastro não copiado", error);
          } else console.error("[live-catalog] sem cadastro para copiar", o.id);
        }
      }
      const itemId = `${P.shopify_product_id}-${V.variant_id}`;
      const products = Array.isArray(o.products) ? [...o.products] : [];
      const idx = products.findIndex((p: any) => p.id === itemId);
      const promo = P.offer_price != null || !P.allow_cashback;
      if (idx >= 0) products[idx] = { ...products[idx], quantity: Number(products[idx].quantity || 1) + qty };
      else products.push({ id: itemId, shopifyId: V.variant_id, sku: V.sku || null, title: P.title, variant: V.title, price: Number(P.offer_price ?? P.original_price), quantity: qty, image: V.image || P.image_url || null, catalog_product_id: P.id, promo });
      const up = await sb.from("orders").update({ products }).eq("id", o.id).eq("is_paid", false).select(ORDER_COLS).single();
      if (up.error) throw up.error;
      const coupon = await loadCoupon(o.id, phone);
      const s = await syncCashback(up.data, coupon);
      if (created) await notifyNewCart(s.o.id);
      return respond({ coupon, hint: s.r.min_purchase_hint, cart: cartOut(s.o), last_paid_order_id: null, open: s.o });
    }

    // remove
    const st0 = await stateOf();
    const o = st0.open;
    if (!o) return respond(st0);
    const itemId = String(body.item_id || "");
    const products = (o.products || []).flatMap((p: any) => p.id !== itemId ? [p] : Number(p.quantity || 1) > 1 ? [{ ...p, quantity: Number(p.quantity) - 1 }] : []);
    if (!products.length) {
      await sb.from("orders").update({ products, stage: "cancelled", cashback_id: null, cashback_amount: 0, discount_type: null, discount_value: 0 }).eq("id", o.id).eq("is_paid", false);
      return respond({ coupon: st0.coupon, hint: st0.coupon?.min_purchase || null, cart: null, last_paid_order_id: null, open: null });
    }
    const up = await sb.from("orders").update({ products }).eq("id", o.id).eq("is_paid", false).select(ORDER_COLS).single();
    if (up.error) throw up.error;
    const coupon = await loadCoupon(o.id, phone);
    const s = await syncCashback(up.data, coupon);
    return respond({ coupon, hint: s.r.min_purchase_hint, cart: cartOut(s.o), last_paid_order_id: null, open: s.o });

    // ── Mensagem do carrinho novo (fila anti-spam; envio direto se a fila falhar).
    async function notifyNewCart(orderId: string) {
      let to = phone;
      if (!to) to = (await regSource())?.whatsapp || null;
      let numberId: string | null = access?.confirmed_number_id || null;
      if (!numberId) {
        const { data: wl } = await sb.from("live_whatsapp_links").select("whatsapp_number_id").eq("event_id", (ev as any).id).order("is_active", { ascending: false }).limit(1).maybeSingle();
        numberId = (wl as any)?.whatsapp_number_id || (ev as any).whatsapp_number_id || null;
      }
      if (!to || !numberId) { console.error("[live-catalog] sem telefone/instância para avisar o carrinho", orderId); return; }
      const nome = handle || firstName((await regSource())?.full_name) || "";
      const text = VARIATIONS[Math.floor(Math.random() * VARIATIONS.length)].replace("{nome}", nome).replace(" ,", ",").replace(" !", "!").replace("{link}", cartUrl(slug, orderId));
      const { error } = await sb.rpc("selfservice_queue_enqueue", {
        p_message_key: `catalog-cart:${orderId}`, p_event_id: (ev as any).id, p_order_id: orderId, p_kind: "cart_link",
        p_phone: to, p_whatsapp_number_id: numberId, p_payload: { text, order_ids: [orderId] },
      });
      if (!error) {
        fetch(`${SB_URL}/functions/v1/selfservice-message-worker`, { method: "POST", headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
        return;
      }
      console.error("[live-catalog] fila falhou, envio direto", error);
      try { await sendDirect(numberId, to, text, orderId); } catch (e) { console.error("[live-catalog] envio direto falhou", e); }
    }
    async function sendDirect(numberId: string, ph: string, text: string, orderId: string) {
      const { data: num } = await sb.from("whatsapp_numbers").select("provider, is_active").eq("id", numberId).maybeSingle();
      if (!num || !(num as any).is_active) throw new Error("Instância inativa");
      const provider = String((num as any).provider || "");
      const dest = digits(ph).startsWith("55") ? digits(ph) : "55" + digits(ph);
      const fn = provider === "meta" ? "meta-whatsapp-send" : provider === "wasender" ? "wasender-send-message" : provider === "uazapi" ? "uazapi-send-message" : "zapi-send-message";
      const payload = provider === "meta" ? { phone: dest, message: text, type: "text", whatsapp_number_id: numberId } : { phone: dest, message: text, whatsapp_number_id: numberId, linkPreview: false };
      const r = await fetch(`${SB_URL}/functions/v1/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", "x-force-instance": "true" }, body: JSON.stringify(payload) });
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok || d?.error || d?.success === false) throw new Error(`[${r.status}] ${JSON.stringify(d).slice(0, 300)}`);
      const mid = d?.messageId ?? d?.data?.messageId ?? d?.data?.id ?? d?.messages?.[0]?.id ?? null;
      await sb.from("whatsapp_messages").insert({ phone: dest, message: text.slice(0, 4000), direction: "outgoing", status: "sent", media_type: "text", whatsapp_number_id: numberId, message_id: mid ? String(mid) : null });
      if (mid) await sb.rpc("selfservice_mark_cart_sent", { p_order_ids: [orderId], p_message_id: String(mid) });
    }
  } catch (e) {
    console.error("[live-catalog]", e);
    return json({ ok: false, error: "internal" }, 500);
  }
});
