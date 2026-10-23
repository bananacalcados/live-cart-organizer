// Página pública de autoatendimento da live (modo "WhatsApp + Cadastro online").
// Rota /pedido/:slug. A cliente digita o WhatsApp, vê o pedido reservado,
// se cadastra e paga. Quem não tem pedido vira lead do evento (source 'autoatendimento').
// Regras:
// - Nunca pré-preenche dados de cliente já conhecida sem o código do WhatsApp (código permanente).
// - registered_at do pedido só é gravado aqui (envio do cadastro); o prêmio
//   (eligible_for_prize) é decidido no banco pelo gatilho do pedido — nunca por esta página.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendAccessCode, verifyAccessCode, normalizeBrPhone } from "../_shared/access-code.ts";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";

const PUBLIC_BASE = "https://checkout.bananacalcados.com.br";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(): string { const b = new Uint8Array(5); crypto.getRandomValues(b); let o = ""; for (const x of b) o += ALPHABET[x % ALPHABET.length]; return o; }
const firstName = (n?: string | null) => { const f = String(n || "").trim().split(/\s+/)[0] || ""; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ""; };
const greetName = (ig?: string | null, name?: string | null) => { const h = String(ig || "").trim().replace(/^@/, ""); return h ? `@${h}` : (firstName(name) || "você"); };
const cartUrl = (slug: string, orderId: string) => `${PUBLIC_BASE}/pedido/${slug}/carrinho/${orderId}`;
const fmtBRL = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
function extractMid(d: any): string | null { const c = d?.messageId ?? d?.data?.messageId ?? d?.data?.messageid ?? d?.data?.id ?? d?.data?.message?.messageid ?? d?.messages?.[0]?.id ?? d?.data?.messages?.[0]?.id ?? null; return c != null ? String(c) : null; }

const MODE = "whatsapp_autoatendimento";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const suffix8 = (p: string) => digits(p).slice(-8);
const phoneKey = (e164: string) => { const d = digits(e164).slice(2); return d.slice(0, 2) + d.slice(-8); };

function isRealFullName(raw?: string | null) {
  const v = String(raw ?? "").trim();
  if (!v || v.includes("@") || /\d/.test(v) || /[._]/.test(v)) return false;
  const parts = v.split(/\s+/).filter(Boolean);
  if (!parts.every((p) => /^[a-zA-ZÀ-ÿ'’-]+$/.test(p))) return false;
  return parts.filter((p) => p.length >= 2).length >= 2;
}
const JUNK = new Set(["asd", "asdf", "teste", "test", "aaa", "abc", "123", "xxx", "nao", "email", "qwe", "qwerty", "sememail", "naotenho"]);
function isUsableEmail(raw?: string | null) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) return false;
  const local = v.split("@")[0];
  return !(local.length < 4 || JUNK.has(local) || /^(.)\1+$/.test(local));
}
function isValidCpf(value: string) {
  const c = digits(value);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => { let s = 0; for (let i = 0; i < len; i++) s += Number(c[i]) * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

function orderTotal(o: any) {
  const items = Array.isArray(o.products) ? o.products : [];
  const sub = items.reduce((s: number, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1), 0);
  const disc = o.discount_type && o.discount_value
    ? (o.discount_type === "percentage" ? sub * (Number(o.discount_value) / 100) : Number(o.discount_value)) : 0;
  const ship = o.free_shipping ? 0 : Number(o.shipping_cost || 0);
  return Math.round((Math.max(0, sub - disc) + ship) * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

  async function allow(key: string, limit: number, win: number) {
    const { data, error } = await sb.rpc("live_member_rate_limit", { _key: key, _limit: limit, _window_seconds: win });
    if (error) return true;
    return data !== false;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const slug = String(body.slug || "").trim().toLowerCase().slice(0, 80);
    if (!slug) return json({ ok: false, error: "Link inválido" }, 400);

    const { data: ev } = await sb
      .from("events")
      .select("id, name, operation_mode, whatsapp_number_id, installment_max, installment_min_value, self_service_prize_name, self_service_prize_image_url, self_service_registration_minutes, self_service_product_notice")
      .eq("self_service_slug", slug)
      .maybeSingle();
    if (!ev || ev.operation_mode !== MODE) return json({ ok: false, error: "not_found" }, 404);

    let officialPhone: string | null = null;
    if (ev.whatsapp_number_id) {
      const { data: wn } = await sb.from("whatsapp_numbers").select("phone_display").eq("id", ev.whatsapp_number_id).maybeSingle();
      const d = digits((wn as any)?.phone_display);
      officialPhone = d ? (d.startsWith("55") ? d : "55" + d) : null;
    }
    const { data: pixRow } = await sb.from("app_settings").select("value").eq("key", "pix_discount_percent").maybeSingle();
    const pixPct = Number((pixRow as any)?.value?.percent ?? (pixRow as any)?.value ?? 0) || 0;

    const eventInfo = {
      id: ev.id,
      name: ev.name,
      prize_name: ev.self_service_prize_name,
      prize_image_url: ev.self_service_prize_image_url,
      registration_minutes: ev.self_service_registration_minutes ?? 5,
      product_notice: ev.self_service_product_notice,
      official_phone: officialPhone,
      official_last4: officialPhone ? officialPhone.slice(-4) : null,
      installment_max: ev.installment_max,
      installment_min_value: ev.installment_min_value,
      pix_discount_percent: pixPct,
    };

    if (action === "event") return json({ ok: true, event: eventInfo });

    const phone = normalizeBrPhone(body.phone);
    if (!phone) return json({ ok: false, error: "Digite o WhatsApp completo com DDD." }, 400);

    async function openOrders() {
      const { data: custs } = await sb.from("customers").select("id, whatsapp").ilike("whatsapp", `%${suffix8(phone!)}`);
      const ids = (custs || []).filter((c: any) => normalizeBrPhone(c.whatsapp || "") === phone).map((c: any) => c.id);
      if (!ids.length) return [];
      const { data } = await sb
        .from("orders")
        .select("id, products, stage, is_paid, paid_externally, created_at, payment_window_expires_at, registered_at, discount_type, discount_value, free_shipping, shipping_cost, cashback_id, cashback_amount, merged_into_order_id")
        .eq("event_id", ev!.id)
        .in("customer_id", ids)
        .neq("stage", "cancelled")
        .eq("is_paid", false)
        .order("created_at", { ascending: true })
        .limit(10);
      return (data || []).filter((o: any) => !o.paid_externally && !o.merged_into_order_id && Array.isArray(o.products) && o.products.length > 0);
    }

    async function knownCustomer(): Promise<boolean> {
      const { count } = await sb.from("customer_registrations").select("id", { count: "exact", head: true })
        .ilike("whatsapp", `%${suffix8(phone!)}`).neq("cpf", "");
      if ((count || 0) > 0) return true;
      const { count: c2 } = await sb.from("customers_unified").select("id", { count: "exact", head: true })
        .eq("phone_suffix8", suffix8(phone!)).not("cpf", "is", null);
      return (c2 || 0) > 0;
    }

    const mapOrder = (o: any) => {
      const tot = orderTotal(o);
      const noPix = !!o.cashback_id || Number(o.cashback_amount || 0) > 0;
      return {
        id: o.id,
        products: (o.products || []).map((p: any) => ({ title: p.title, variant: p.variant, price: Number(p.price || 0), quantity: Number(p.quantity || 1), image: p.image || null })),
        total: tot,
        pix_total: noPix || !pixPct ? tot : Math.round(tot * (1 - pixPct / 100) * 100) / 100,
        created_at: o.created_at,
        payment_window_expires_at: o.payment_window_expires_at,
        registered_at: o.registered_at,
        free_shipping: !!o.free_shipping,
        shipping_cost: Number(o.shipping_cost || 0),
        discount_type: o.discount_type,
        discount_value: o.discount_value,
      };
    };

    async function savedDetails(): Promise<any> {
      const { data: reg } = await sb.from("customer_registrations")
        .select("full_name, cpf, email, cep, address, address_number, complement, neighborhood, city, state")
        .ilike("whatsapp", `%${suffix8(phone)}`).neq("cpf", "").order("created_at", { ascending: false }).limit(1).maybeSingle();
      let d: any = reg;
      if (!d) {
        const { data: cu } = await sb.from("customers_unified")
          .select("name, cpf, email, cep, address, address_number, complement, neighborhood, city, state")
          .eq("phone_suffix8", suffix8(phone)).limit(2);
        if ((cu || []).length === 1) d = { ...cu![0], full_name: (cu![0] as any).name };
      }
      return d || null;
    }

    if (action === "identify") {
      if (!(await allow(`ss-id-ip:${ip}`, 40, 600))) return json({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      const orders = await openOrders();
      const known = await knownCustomer();
      const instagram = String(body.instagram || "").trim().replace(/^@/, "").slice(0, 60) || null;
      const { data: acc } = await sb.from("live_selfservice_accesses").insert({
        event_id: ev.id,
        entered_phone: phone,
        phone_key: phoneKey(phone),
        instagram,
        order_ids: orders.map((o: any) => o.id),
        user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
      }).select("id").single();
      const details = known ? await savedDetails() : null;
      return json({ ok: true, event: eventInfo, access_id: acc?.id || null, known, details, orders: orders.map(mapOrder) });
    }

    if (action === "viewed") {
      if (body.access_id) {
        await sb.from("live_selfservice_accesses").update({ viewed_product_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", body.access_id).eq("event_id", ev.id).is("viewed_product_at", null);
      }
      return json({ ok: true });
    }

    if (action === "send_code") {
      if (!(await allow(`otp:${phone}`, 3, 600))) return json({ ok: false, error: "Você já pediu vários códigos. Aguarde alguns minutos." }, 429);
      if (!(await allow(`otp-ip:${ip}`, 10, 3600))) return json({ ok: false, error: "Muitas solicitações de código. Tente mais tarde." }, 429);
      const r = await sendAccessCode(sb, phone);
      if (!r.ok) return json({ ok: false, error: r.error || "Falha ao enviar o código" }, 500);
      return json({ ok: true });
    }

    async function checkCode(): Promise<boolean> {
      if (!(await allow(`otpv:${phone}`, 8, 600))) return false;
      return verifyAccessCode(sb, phone!, String(body.code || ""));
    }

    if (action === "verify_code") {
      const ok = await checkCode();
      if (!ok) return json({ ok: false, error: "Código incorreto." });
      const d = await savedDetails();
      return json({ ok: true, details: d || null });
    }

    if (action === "register") {

      const d = body.details || {};
      const fullName = String(d.full_name || "").trim().slice(0, 120);
      if (!isRealFullName(fullName)) return json({ ok: false, error: "Informe seu nome completo (nome e sobrenome)." }, 400);
      const cpf = digits(d.cpf).slice(0, 11);
      if (!isValidCpf(cpf)) return json({ ok: false, error: "CPF inválido." }, 400);
      const email = String(d.email || "").trim().toLowerCase().slice(0, 160);
      if (!isUsableEmail(email)) return json({ ok: false, error: "E-mail inválido. Use um e-mail real." }, 400);
      const cep = digits(d.cep).slice(0, 8);
      if (cep.length !== 8) return json({ ok: false, error: "CEP inválido." }, 400);
      const addr = {
        cep,
        address: String(d.address || "").trim().slice(0, 200),
        address_number: String(d.address_number || "").trim().slice(0, 20),
        complement: String(d.complement || "").trim().slice(0, 120),
        neighborhood: String(d.neighborhood || "").trim().slice(0, 120),
        city: String(d.city || "").trim().slice(0, 120),
        state: String(d.state || "").trim().slice(0, 2).toUpperCase(),
      };
      if (!addr.address || !addr.address_number || !addr.city || !addr.state) {
        return json({ ok: false, error: "Preencha o endereço completo (rua, número, cidade)." }, 400);
      }
      const now = new Date().toISOString();

      // CRM unificado
      const { error: uErr } = await sb.rpc("find_or_create_unified_customer", {
        p_phone: phone, p_name: fullName, p_instagram: null, p_cpf: cpf, p_email: email, p_source: "member_area",
      });
      if (uErr) console.error("[live-selfservice] unified", uErr.message);
      await sb.from("customers_unified").update(addr).eq("phone_suffix8", suffix8(phone));

      const orders = await openOrders();
      const reqIds: string[] = Array.isArray(body.order_ids) ? body.order_ids.map(String) : [];
      const target = orders.filter((o: any) => reqIds.includes(o.id));

      if (target.length) {
        for (const o of target) {
          const payload = { order_id: o.id, whatsapp: phone, full_name: fullName, cpf, email, ...addr };
          const { data: reg } = await sb.from("customer_registrations").select("id").eq("order_id", o.id).maybeSingle();
          if (reg?.id) await sb.from("customer_registrations").update(payload).eq("id", reg.id);
          else await sb.from("customer_registrations").insert(payload);
          if (!o.registered_at) await sb.from("orders").update({ registered_at: now }).eq("id", o.id).is("registered_at", null);
        }
      } else {
        // Caso B: lead do evento
        const { data: lead } = await sb.from("event_leads").select("id, source, metadata")
          .eq("event_id", ev.id).eq("phone_suffix", suffix8(phone)).order("created_at").limit(1).maybeSingle();
        const metaBase = (lead?.metadata as any) || {};
        const metadata = {
          ...metaBase,
          self_service_registered_at: metaBase.self_service_registered_at || now,
          ...(lead && lead.source !== "autoatendimento" && !metaBase.original_source ? { original_source: lead.source } : {}),
        };
        if (lead?.id) {
          await sb.from("event_leads").update({ name: fullName, source: "autoatendimento", metadata, instagram: body.instagram || undefined }).eq("id", lead.id);
        } else {
          await sb.from("event_leads").insert({ event_id: ev.id, name: fullName, phone, source: "autoatendimento", metadata, instagram: body.instagram || null });
        }
      }

      if (body.access_id) {
        await sb.from("live_selfservice_accesses").update({ registered_at: now, updated_at: now })
          .eq("id", body.access_id).eq("event_id", ev.id);
      }

      const fresh = target.length ? (await openOrders()).filter((o: any) => reqIds.includes(o.id)).map(mapOrder) : [];
      return json({ ok: true, orders: fresh, form: { fullName, email, cpf, whatsapp: phone, cep, address: addr.address, addressNumber: addr.address_number, complement: addr.complement, neighborhood: addr.neighborhood, city: addr.city, state: addr.state } });
    }

    if (action === "paid") {
      // Só marca o funil se o pedido estiver pago de verdade no banco.
      if (body.access_id) {
        const { data: acc } = await sb.from("live_selfservice_accesses").select("order_ids").eq("id", body.access_id).eq("event_id", ev.id).maybeSingle();
        const ids = (acc as any)?.order_ids || [];
        if (ids.length) {
          const { count } = await sb.from("orders").select("id", { count: "exact", head: true }).in("id", ids).eq("is_paid", true);
          if ((count || 0) > 0) {
            await sb.from("live_selfservice_accesses").update({ paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq("id", body.access_id).is("paid_at", null);
          }
        }
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: "Ação inválida" }, 400);
  } catch (e) {
    console.error("[live-selfservice]", e);
    return json({ ok: false, error: "Erro inesperado. Tente de novo." }, 500);
  }
});
