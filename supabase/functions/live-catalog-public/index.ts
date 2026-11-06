import { withAccessLog } from "../_shared/withAccessLog.ts";
// Vitrine pública do catálogo da live (/pedido/:slug/vitrine) para Grupos VIP.
// Sem token de cliente: só abre com events.public_catalog_enabled e dentro de public_catalog_until.
// Preço, estoque, frete e cashback são decididos aqui (service role); o navegador só manda ids e a ficha.
// Cashback só é aplicado quando o CPF digitado bate com a ficha já salva daquele WhatsApp.
// O pedido reaproveita o carrinho aberto da cliente no evento (nunca dois não pagos) e segue para
// a página de pagamento existente do autoatendimento.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { normalizeBrPhone } from "../_shared/access-code.ts";
import { computeCatalogCashback, type Coupon } from "./cashback.ts";

const MODE = "whatsapp_autoatendimento";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_COLS = "id, customer_id, products, is_paid, paid_externally, stage, cashback_id, cashback_amount, discount_type, discount_value, origin, attribution";
const firstName = (n?: string | null) => { const f = String(n || "").trim().split(/\s+/)[0] || ""; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ""; };

function validCpf(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

function cleanAttribution(a: any) {
  const src = a && typeof a === "object" ? a : {};
  const g = str(src.g, 40);
  const d = str(src.d, 10).toLowerCase();
  return {
    utm_source: str(src.utm_source, 60) || null,
    utm_campaign: str(src.utm_campaign, 120) || null,
    group_id: UUID.test(g) ? g : null,
    dispatch_code: /^[a-z0-9]{6,8}$/.test(d) ? d : null,
  };
}

Deno.serve(withAccessLog("live-catalog-public", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const allow = async (key: string, limit: number, win: number) => {
    const { data, error } = await sb.rpc("live_member_rate_limit", { _key: key, _limit: limit, _window_seconds: win });
    return error ? true : data !== false;
  };

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const slug = str(body.slug, 80).toLowerCase();
    if (!["open", "view", "identify", "checkout"].includes(action) || !slug) return json({ ok: false, error: "invalid" }, 400);
    if (!(await allow(`vitrine:ip:${ip}`, 240, 600))) return json({ ok: false, error: "rate_limited" }, 429);

    const { data: evRow } = await sb.from("events")
      .select("id, name, operation_mode, public_catalog_enabled, public_catalog_until, installment_max, installment_min_value, self_service_product_notice, google_rating_text, google_profile_url, whatsapp_number_id")
      .eq("self_service_slug", slug).maybeSingle();
    const ev = evRow as any;
    if (!ev || ev.operation_mode !== MODE || !ev.public_catalog_enabled) return json({ ok: false, error: "invalid" }, 404);
    if (ev.public_catalog_until && Date.parse(ev.public_catalog_until) <= Date.now()) return json({ ok: false, error: "expired" });

    const attr = cleanAttribution(body.attribution);
    const logVisit = (kind: string, extra: Record<string, unknown> = {}) =>
      sb.from("public_catalog_visits").insert({ event_id: ev.id, kind, ...attr, ...extra }).then(({ error }) => { if (error) console.error("[vitrine] visita", error); });

    async function catalogRows(ids?: string[]) {
      let q = sb.from("event_catalog_products").select("id, shopify_product_id, title, image_url, images, original_price, offer_price, allow_cashback, variants, position")
        .eq("event_id", ev.id).eq("is_active", true);
      if (ids) q = q.in("id", ids);
      const { data } = await q.order("position").limit(200);
      return (data || []) as any[];
    }
    /** Estoque compartilhado: soma de todas as lojas ativas por SKU (consulta em lote, índice store_id+sku). */
    async function stockBySku(skus: string[]) {
      const out = new Map<string, number>();
      const list = Array.from(new Set(skus.filter(Boolean)));
      if (!list.length) return out;
      const { data: stores } = await sb.from("pos_stores").select("id").eq("is_active", true);
      const storeIds = (stores || []).map((s: any) => s.id);
      for (let i = 0; i < list.length; i += 300) {
        const { data } = await sb.from("pos_products").select("sku, stock").in("store_id", storeIds).in("sku", list.slice(i, i + 300));
        for (const r of (data || []) as any[]) out.set(r.sku, (out.get(r.sku) || 0) + Math.max(0, Number(r.stock || 0)));
      }
      return out;
    }
    const variantAvailable = (v: any, stock: Map<string, number>) => !v.sku || (stock.get(v.sku) || 0) > 0;

    // ───── Abrir vitrine
    if (action === "open") {
      const rows = await catalogRows();
      const stock = await stockBySku(rows.flatMap((p) => (Array.isArray(p.variants) ? p.variants : []).filter((v: any) => v.enabled).map((v: any) => v.sku)));
      const catalog = rows.map((p) => {
        const variants = (Array.isArray(p.variants) ? p.variants : []).filter((v: any) => v.enabled)
          .map((v: any) => ({ variant_id: v.variant_id, title: v.title, image: v.image || null, available: variantAvailable(v, stock) }));
        return {
          id: p.id, shopify_product_id: p.shopify_product_id, title: p.title, image_url: p.image_url, images: Array.isArray(p.images) ? p.images : [],
          original_price: Number(p.original_price), offer_price: p.offer_price != null ? Number(p.offer_price) : null, allow_cashback: !!p.allow_cashback,
          variants, sold_out: !variants.some((v: any) => v.available),
        };
      });
      let officialLast4: string | null = null;
      const { data: wl } = await sb.from("live_whatsapp_links").select("whatsapp_number_id, target_phone").eq("event_id", ev.id).order("is_active", { ascending: false }).limit(1).maybeSingle();
      const numId = (wl as any)?.whatsapp_number_id || ev.whatsapp_number_id;
      if (numId) { const { data: wn } = await sb.from("whatsapp_numbers").select("phone_display").eq("id", numId).maybeSingle(); officialLast4 = digits((wn as any)?.phone_display).slice(-4) || null; }
      if (!officialLast4) officialLast4 = digits((wl as any)?.target_phone).slice(-4) || null;
      if (await allow(`vitrine:open:${ip}:${ev.id}`, 20, 3600)) logVisit("open");
      if (attr.dispatch_code) sb.rpc("dispatch_link_click", { p_code: attr.dispatch_code, p_page: `vitrine:${slug}`, p_ua: str(req.headers.get("user-agent"), 300), p_ip: ip }).then(() => {}, () => {});
      return json({
        ok: true,
        event: {
          name: ev.name, product_notice: ev.self_service_product_notice, official_last4: officialLast4,
          google_rating: ev.google_rating_text || null, google_url: ev.google_profile_url || null,
          installment_max: ev.installment_max, installment_min_value: ev.installment_min_value, until: ev.public_catalog_until,
        },
        catalog,
      });
    }

    if (action === "view") {
      const id = str(body.catalog_product_id, 40);
      if (UUID.test(id) && (await allow(`vitrine:view:${ip}:${id}`, 5, 3600))) await logVisit("view", { catalog_product_id: id });
      return json({ ok: true });
    }

    const phone = normalizeBrPhone(str(body.phone, 30));
    if (!phone) return json({ ok: false, error: "Digite o WhatsApp completo com DDD." }, 400);
    const suffix8 = phone.slice(-8);

    async function latestRegistration() {
      const { data } = await sb.from("customer_registrations")
        .select("full_name, cpf, email, whatsapp, cep, address, address_number, complement, neighborhood, city, state, created_at")
        .ilike("whatsapp", `%${suffix8}`).order("created_at", { ascending: false }).limit(10);
      return ((data || []) as any[]).find((r) => normalizeBrPhone(r.whatsapp || "") === phone) || null;
    }

    // ───── Identificar pelo WhatsApp (só dica mínima, nunca dados completos)
    if (action === "identify") {
      if (!(await allow(`vitrine:identify:${ip}`, 20, 600))) return json({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      const reg = await latestRegistration();
      return json({ ok: true, known: !!reg, first_name: reg ? firstName(reg.full_name) : null, city_hint: reg ? `${reg.city || ""}${reg.state ? "/" + reg.state : ""}` : null });
    }

    // ───── Fechar pedido
    if (!(await allow(`vitrine:checkout:${ip}`, 20, 3600)) || !(await allow(`vitrine:checkout:${phone}`, 10, 3600))) {
      return json({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
    }
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
    const want = rawItems.map((i: any) => ({ cp: str(i?.catalog_product_id, 40), vid: str(i?.variant_id, 120), qty: Math.max(1, Math.min(10, Math.floor(Number(i?.quantity || 1)))) }))
      .filter((i: any) => UUID.test(i.cp) && i.vid);
    if (!want.length) return json({ ok: false, error: "Escolha pelo menos um produto." }, 400);

    const rows = await catalogRows(Array.from(new Set(want.map((w: any) => w.cp))));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const resolved: any[] = [];
    for (const w of want) {
      const P = byId.get(w.cp);
      const V = P ? (P.variants || []).find((v: any) => v.variant_id === w.vid && v.enabled) : null;
      if (!V) return json({ ok: false, error: "Um dos produtos não está mais disponível.", sold_out: [w.cp] }, 400);
      resolved.push({ P, V, qty: w.qty });
    }
    const stock = await stockBySku(resolved.map((r) => r.V.sku));
    const soldOut = resolved.filter((r) => !variantAvailable(r.V, stock));
    if (soldOut.length) return json({ ok: false, error: `Esgotou: ${soldOut.map((r) => `${r.P.title} (${r.V.title})`).join(", ")}`, sold_out: soldOut.map((r) => r.P.id) }, 409);

    // Ficha: reaproveita a salva só com CPF igual; senão, exige a ficha completa.
    const cpf = digits(body.cpf);
    if (!validCpf(cpf)) return json({ ok: false, field: "cpf", error: "CPF inválido." }, 400);
    const saved = await latestRegistration();
    const verified = !!saved && digits(saved.cpf) === cpf;
    let form: Record<string, string>;
    if (body.use_saved) {
      if (!verified) return json({ ok: false, field: "cpf", error: "Esse CPF não confere com o cadastro deste WhatsApp. Preencha seus dados." }, 400);
      form = { full_name: saved.full_name, email: saved.email, cep: digits(saved.cep), address: saved.address, address_number: saved.address_number, complement: saved.complement || "", neighborhood: saved.neighborhood, city: saved.city, state: saved.state };
    } else {
      const f = body.form || {};
      form = {
        full_name: str(f.full_name, 120).replace(/\s+/g, " "), email: str(f.email, 120).toLowerCase(), cep: digits(f.cep).slice(0, 8),
        address: str(f.address, 160), address_number: str(f.address_number, 20), complement: str(f.complement, 80),
        neighborhood: str(f.neighborhood, 80), city: str(f.city, 80), state: str(f.state, 2).toUpperCase(),
      };
      const errs: Record<string, string> = {};
      if (form.full_name.split(" ").filter((x) => x.length > 1).length < 2 || form.full_name.includes("@")) errs.full_name = "Digite nome e sobrenome.";
      if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(form.email)) errs.email = "E-mail inválido.";
      if (form.cep.length !== 8) errs.cep = "CEP inválido.";
      if (!form.address) errs.address = "Informe a rua.";
      if (!form.address_number) errs.address_number = "Informe o número.";
      if (!form.neighborhood) errs.neighborhood = "Informe o bairro.";
      if (!form.city) errs.city = "Informe a cidade.";
      if (!/^[A-Z]{2}$/.test(form.state)) errs.state = "UF inválida.";
      const first = Object.keys(errs)[0];
      if (first) return json({ ok: false, field: first, errors: errs, error: errs[first] }, 400);
    }

    // Cliente pelo WhatsApp (cria se não existir).
    const { data: custs } = await sb.from("customers").select("id, whatsapp, created_at").ilike("whatsapp", `%${suffix8}`).order("created_at", { ascending: false }).limit(50);
    let customerId: string | null = ((custs || []) as any[]).find((c) => normalizeBrPhone(c.whatsapp || "") === phone)?.id || null;
    if (!customerId) {
      for (const handle of [form.full_name, `${form.full_name} ${phone.slice(-4)}`, `${form.full_name} ${phone.slice(-8)}`]) {
        const ins = await sb.from("customers").insert({ instagram_handle: handle, whatsapp: phone, full_name: form.full_name }).select("id").single();
        if (!ins.error) { customerId = (ins.data as any).id; break; }
      }
      if (!customerId) throw new Error("customer_create_failed");
    }

    // Carrinho aberto da cliente no evento (qualquer origem) ou um novo da vitrine.
    const openCart = async () => {
      const { data } = await sb.from("orders").select(ORDER_COLS).eq("event_id", ev.id).eq("customer_id", customerId)
        .eq("is_paid", false).eq("paid_externally", false).neq("stage", "cancelled").is("merged_into_order_id", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data as any;
    };
    let o = await openCart();
    let created = false;
    if (!o) {
      const ins = await sb.from("orders").insert({
        event_id: ev.id, customer_id: customerId, origin: "catalog", stage: "awaiting_payment", registered_at: new Date().toISOString(), products: [],
        attribution: { source: "vitrine_grupo", ...attr },
      }).select(ORDER_COLS).single();
      if (ins.error) { o = await openCart(); if (!o) throw ins.error; }
      else { o = ins.data; created = true; }
    } else if (!o.attribution?.source) {
      await sb.from("orders").update({ attribution: { ...(o.attribution || {}), source: "vitrine_grupo", ...attr } }).eq("id", o.id).eq("is_paid", false);
    }

    const products = Array.isArray(o.products) ? [...o.products] : [];
    for (const { P, V, qty } of resolved) {
      const itemId = `${P.shopify_product_id}-${V.variant_id}`;
      const idx = products.findIndex((p: any) => p.id === itemId && p.catalog_product_id);
      const promo = P.offer_price != null || !P.allow_cashback;
      if (idx >= 0) products[idx] = { ...products[idx], quantity: Number(products[idx].quantity || 1) + qty };
      else products.push({ id: products.some((p: any) => p.id === itemId) ? `${itemId}-cat` : itemId, shopifyId: V.variant_id, sku: V.sku || null, title: P.title, variant: V.title, price: Number(P.offer_price ?? P.original_price), quantity: qty, image: V.image || P.image_url || null, catalog_product_id: P.id, promo });
    }
    const up = await sb.from("orders").update({ products }).eq("id", o.id).eq("is_paid", false).select(ORDER_COLS).single();
    if (up.error) throw up.error;
    o = up.data;

    // Ficha do pedido: nunca sobrescreve uma ficha que a equipe já preencheu.
    const { data: existingReg } = await sb.from("customer_registrations").select("id").eq("order_id", o.id).limit(1).maybeSingle();
    if (!existingReg) {
      const { error } = await sb.from("customer_registrations").insert({ order_id: o.id, customer_id: null, cpf, whatsapp: phone, ...form });
      if (error) throw error;
    }

    // Cashback: só com identidade confirmada pelo CPF e só em carrinho criado pelo catálogo.
    if (o.origin === "catalog") {
      let coupon: Coupon | null = null;
      if (verified) {
        const { data } = await sb.rpc("catalog_available_cashback", { p_phone: phone, p_order_id: o.id });
        const c = (data as any[])?.[0];
        coupon = c ? { id: c.id, cashback_amount: Number(c.cashback_amount), min_purchase: Number(c.min_purchase || 0), expires_at: c.expires_at } : null;
      }
      const r = computeCatalogCashback(o.products || [], coupon);
      const next = r.amount > 0
        ? { cashback_id: r.cashback_id, cashback_amount: r.amount, discount_type: "fixed", discount_value: r.amount }
        : { cashback_id: null, cashback_amount: 0, discount_type: null, discount_value: 0 };
      const same = (o.cashback_id ?? null) === next.cashback_id && Number(o.cashback_amount || 0) === next.cashback_amount
        && (o.discount_type ?? null) === next.discount_type && Number(o.discount_value || 0) === next.discount_value;
      if (!same) await sb.from("orders").update(next).eq("id", o.id).eq("is_paid", false);
    }

    await logVisit("order", { order_id: o.id });
    return json({ ok: true, order_id: o.id, created, cart_path: `/pedido/${slug}/carrinho/${String(o.id).replace(/-/g, "")}` });
  } catch (e) {
    console.error("[live-catalog-public]", e);
    return json({ ok: false, error: "Não deu pra concluir agora, tenta de novo." }, 500);
  }
}));
