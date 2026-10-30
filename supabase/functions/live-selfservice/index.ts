// Página pública de autoatendimento da live (modo "WhatsApp + Cadastro online").
// Rota /pedido/:slug. A cliente digita o WhatsApp, vê o pedido reservado,
// se cadastra e confirma no WhatsApp (#CODIGO); o link do carrinho chega pela resposta
// automática e o pagamento acontece na página do carrinho (/pedido/:slug/carrinho/:orderId). Quem não tem pedido vira lead do evento (source 'autoatendimento').
// Regras:
// - Nunca pré-preenche dados de cliente já conhecida sem o código do WhatsApp (código permanente).
// - registered_at do pedido só é gravado aqui (envio do cadastro); o prêmio
//   (eligible_for_prize) é decidido no banco pelo gatilho do pedido — nunca por esta página.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendAccessCode, verifyAccessCode, normalizeBrPhone } from "../_shared/access-code.ts";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";
import { loadSelfserviceAdvertising, cleanSelfserviceSignals, resolveSelfserviceAdvertising, ordinaryAllowed } from "../_shared/selfservice-advertising.ts";
import { orderInstagram, selfservicePhoneKey } from "../_shared/selfservice-identity.ts";

const PUBLIC_BASE = "https://checkout.bananacalcados.com.br";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(): string { const b = new Uint8Array(5); crypto.getRandomValues(b); let o = ""; for (const x of b) o += ALPHABET[x % ALPHABET.length]; return o; }
const firstName = (n?: string | null) => { const f = String(n || "").trim().split(/\s+/)[0] || ""; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ""; };
const greetName = (ig?: string | null, name?: string | null) => { const h = String(ig || "").trim().replace(/^@/, ""); return h ? `@${h}` : (firstName(name) || "você"); };
const cartUrl = (slug: string, orderId: string) => `${PUBLIC_BASE}/pedido/${slug}/carrinho/${orderId.replace(/-/g, "")}`;
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
// DDD do telefone normalizado (55 + DDD + número): unificar exige DDD + número iguais.
const dddOf = (p: string) => digits(p).replace(/^55/, "").slice(0, 2);
const samePhone = (a: string, b: string) => { const x = digits(a).replace(/^55/, ""), y = digits(b).replace(/^55/, ""); return x.length >= 10 && x.slice(0, 2) === y.slice(0, 2) && x.slice(-8) === y.slice(-8); };
const phoneKey = selfservicePhoneKey;

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

// Número oficial do evento: o da "Link da Live → WhatsApp" (etapa Mensagem) vale primeiro.
async function resolveEventNumber(sb: any, eventId: string, fallbackId: string | null) {
  const { data: link } = await sb.from("live_whatsapp_links").select("whatsapp_number_id, target_phone").eq("event_id", eventId).order("is_active", { ascending: false }).limit(1).maybeSingle();
  return { id: (link as any)?.whatsapp_number_id || fallbackId || null, targetPhone: (link as any)?.target_phone || null };
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

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  /** Envia pela instância indicada, ciente do provider, e grava no histórico do chat. */
  async function waSend(numberId: string, phone: string, text: string, copyCode?: string): Promise<string | null> {
    const { data: num } = await sb.from("whatsapp_numbers").select("id, provider, is_active").eq("id", numberId).maybeSingle();
    if (!num || !(num as any).is_active) throw new Error("Instância oficial inativa");
    const provider = String((num as any).provider || "");
    const to = digits(phone).startsWith("55") ? digits(phone) : "55" + digits(phone);
    const headers = { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", "x-force-instance": "true" };
    let fn: string; let payload: Record<string, unknown>; let stored = text;
    if (copyCode && provider === "uazapi") {
      fn = "uazapi-send-buttons";
      payload = { phone: to, message: text, buttons: [{ id: "copy_pix", title: "Copiar código PIX", copyCode }], whatsapp_number_id: numberId };
      stored = `${text}\n\n[Botão: Copiar código PIX]\n[PIX_CODE:${copyCode}]`;
    } else if (provider === "meta") {
      fn = "meta-whatsapp-send"; payload = { phone: to, message: text, type: "text", whatsapp_number_id: numberId };
    } else {
      fn = provider === "wasender" ? "wasender-send-message" : provider === "uazapi" ? "uazapi-send-message" : "zapi-send-message";
      payload = { phone: to, message: text, whatsapp_number_id: numberId, linkPreview: false };
    }
    const r = await fetch(`${SB_URL}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || (d as any)?.error || (d as any)?.success === false) throw new Error(`[${r.status}] ${JSON.stringify(d).slice(0, 300)}`);
    const mid = extractMid(d);
    await sb.from("whatsapp_messages").insert({ phone: to, message: stored.slice(0, 4000), direction: "outgoing", status: "sent", media_type: "text", whatsapp_number_id: numberId, message_id: mid });
    return mid;
  }

  /** Pix no WhatsApp: botão "Copiar código PIX" (uazapi) ou instrução + código sozinho. */
  async function waSendPix(numberId: string, phone: string, code: string, amount: number) {
    const valor = fmtBRL(amount);
    const { data: num } = await sb.from("whatsapp_numbers").select("provider").eq("id", numberId).maybeSingle();
    if ((num as any)?.provider === "uazapi") {
      try {
        await waSend(numberId, phone, `💰 *PIX de ${valor}*\n\nToque em *Copiar código PIX* aqui embaixo, abra o app do seu banco em *Pix → Pix Copia e Cola* e cole o código. 👇`, code);
        return;
      } catch (e) { console.warn("[live-selfservice] botão copiar falhou, caindo para texto", e); }
    }
    await waSend(numberId, phone, `💰 *PIX de ${valor}*\n\n👇 O código *copia e cola* vem na *próxima mensagem*. Toque e segure nela, escolha *Copiar* e cole no app do seu banco em *Pix → Pix Copia e Cola*.`);
    await waSend(numberId, phone, code);
  }

  async function regName(orderIds: string[], fallbackPhone: string) {
    if (orderIds.length) {
      const { data } = await sb.from("customer_registrations").select("full_name").in("order_id", orderIds).limit(1).maybeSingle();
      if ((data as any)?.full_name) return (data as any).full_name as string;
    }
    const { data: l } = await sb.from("event_leads").select("name").eq("phone_suffix", suffix8(fallbackPhone)).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return ((l as any)?.name as string) || null;
  }

  async function openOrderRowsFor(eventId: string, ids: string[]) {
    if (!ids.length) return [] as any[];
    const { data } = await sb.from("orders").select("id, products, is_paid, paid_externally, merged_into_order_id, stage, registered_at, discount_type, discount_value, free_shipping, shipping_cost, customer:customers(instagram_handle)")
      .in("id", ids).eq("event_id", eventId).eq("is_paid", false).neq("stage", "cancelled");
    return ((data || []) as any[]).filter((o) => !o.paid_externally && !o.merged_into_order_id && Array.isArray(o.products) && o.products.length);
  }

  async function cashbackHint(total: number) {
    return Math.round(total * 10) / 100;
  }

  /** Texto do link do carrinho (3 variações, quebras de linha reais). */
  function cartText(greet: string, slug: string, orderIds: string[], cashback: number | null) {
    const links = orderIds.map((id) => cartUrl(slug, id)).join("\n");
    const cb = cashback ? `\n\n💰 *Pagando em até 20 minutos* do primeiro envio do carrinho você ganha *${fmtBRL(cashback)}* de cashback pra usar no próximo produto!` : "";
    const variants = [
      `Oii ${greet}, cadastro confirmado 😁\n\nSegue o link do seu carrinho:\n${links}${cb}\n\nDaqui a pouco volto pra ver se deu tudo certinho, tá bom? 😉`,
      `Oi ${greet}! Seu cadastro já está confirmado ✅\n\nAqui está o link do seu carrinho:\n${links}${cb}\n\nJá já passo aqui pra confirmar se você conseguiu, combinado?`,
      `Oii ${greet}, tudo certo com seu cadastro 😁\n\nLink do seu carrinho:\n${links}${cb}\n\nVou voltar daqui a pouquinho pra ver se deu certo, pode ser?`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  async function sendCartMessage(numberId: string, phone: string, greet: string, slug: string, orderIds: string[], cashback: number | null) {
    const mid = await waSend(numberId, phone, cartText(greet, slug, orderIds, cashback));
    if (!mid) throw new Error("Provedor não confirmou o identificador do envio");
    const { error } = await sb.rpc("selfservice_mark_cart_sent", { p_order_ids: orderIds, p_message_id: mid });
    if (error) throw error;
  }

  /**
   * Fila anti-spam (Bloco 2): toda mensagem automática entra na fila persistida
   * e o worker envia com intervalo de 4 s por instância, retry e idempotência.
   * Se a fila falhar por qualquer motivo, o chamador cai no envio direto atual.
   */
  async function queueAuto(opts: { key: string; eventId: string | null; orderId: string | null; kind: string; phone: string; numberId: string | null; payload: Record<string, unknown> }): Promise<boolean> {
    try {
      const { error } = await sb.rpc("selfservice_queue_enqueue", {
        p_message_key: opts.key,
        p_event_id: opts.eventId,
        p_order_id: opts.orderId,
        p_kind: opts.kind,
        p_phone: opts.phone,
        p_whatsapp_number_id: opts.numberId,
        p_payload: opts.payload,
      });
      if (error) { console.error("[live-selfservice] enqueue falhou", error); return false; }
      // Acorda o worker (melhor esforço; ele também se auto-chama enquanto houver fila).
      fetch(`${SB_URL}/functions/v1/selfservice-message-worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      return true;
    } catch (e) {
      console.error("[live-selfservice] enqueue erro", e);
      return false;
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // Despertador público do worker (reenvio manual pela Central da Live).
    // Não expõe dado nenhum — só manda o worker verificar a fila.
    if (action === "kick") {
      fetch(`${SB_URL}/functions/v1/selfservice-message-worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      return json({ ok: true });
    }

    // ───── Ações internas (gatilho do banco / livete-start-order) ─────
    if (action === "confirmed" || action === "send_cart") {
      if (!(await isAuthorizedCron(req))) return json({ error: "Unauthorized" }, 401);
      if (action === "confirmed") {
        const { data: acc } = await sb.from("live_selfservice_accesses")
          .select("id, event_id, entered_phone, instagram, order_ids, confirmed_phone, confirmed_number_id, whatsapp_confirmed_at, metadata").eq("id", String(body.access_id || "")).maybeSingle();
        if (!acc) return json({ ok: false, error: "not_found" }, 404);
        const a = acc as any;
        if (!a.whatsapp_confirmed_at) return json({ ok: false, error: "not_confirmed" }, 409);
        if (a.metadata?.auto_reply_sent_at) return json({ ok: true, already: true });
        // Revalidate last-four candidates against the real WhatsApp sender even
        // when the order was assembled after the form had already been submitted.
        const { data: initialMatches } = await sb.rpc("selfservice_match_initial_order", { p_event_id: a.event_id, p_phone: a.confirmed_phone || a.entered_phone });
        if (initialMatches?.length === 1 && !(a.order_ids || []).includes(initialMatches[0])) {
          const { data: linked } = await sb.rpc("live_link_order_verified", { p_event_id: a.event_id, p_phone: a.confirmed_phone || a.entered_phone });
          if (linked?.ok && linked.order_id === initialMatches[0]) {
            a.order_ids = [...(a.order_ids || []), linked.order_id];
            await sb.from("live_selfservice_accesses").update({ order_ids: a.order_ids }).eq("id", a.id);
          }
        }
        const { data: e2 } = await sb.from("events").select("self_service_slug, whatsapp_number_id").eq("id", a.event_id).maybeSingle();
        const numberId = a.confirmed_number_id || (await resolveEventNumber(sb, a.event_id, (e2 as any)?.whatsapp_number_id)).id;
        const to = a.confirmed_phone || a.entered_phone;
        if (!numberId || !e2) return json({ ok: false, error: "sem instância" }, 400);
        const openRows = await openOrderRowsFor(a.event_id, a.order_ids || []);
        // Cadastro feito antes do pedido existir: copia a ficha salva para o pedido
        // vinculado, senão o carrinho abre sem os botões de pagamento.
        const saved = a.metadata?.registration_details;
        if (saved && isValidCpf(String(saved.cpf || "")) && isRealFullName(saved.full_name) && saved.address && saved.cep) {
          const { data: accR } = await sb.from("live_selfservice_accesses").select("registered_at").eq("id", a.id).maybeSingle();
          const regAt = (accR as any)?.registered_at || a.whatsapp_confirmed_at;
          for (const o of openRows) {
            const { data: has } = await sb.from("customer_registrations").select("id").eq("order_id", o.id).maybeSingle();
            if (!has) {
              const { error } = await sb.from("customer_registrations").insert({ ...saved, order_id: o.id, whatsapp: digits(to) });
              if (error) console.error("[live-selfservice] copiar cadastro", error.message);
            }
            if (!o.registered_at) await sb.from("orders").update({ registered_at: regAt }).eq("id", o.id).is("registered_at", null);
          }
        }
        const open = openRows.map((o) => o.id as string);
        const greet = greetName(orderInstagram(openRows, a.instagram), await regName(a.order_ids || [], a.entered_phone));
        const cb = openRows.length ? await cashbackHint(openRows.reduce((s, o) => s + orderTotal(o), 0)) : null;
        const confirmText = `Oii ${greet}, seu cadastro está confirmado! ✅\n\nQuando você pedir um produto na live, seu link já vai sair prontinho por aqui 😉`;
        const queued = await queueAuto({
          key: `confirm:${a.id}`,
          eventId: a.event_id,
          orderId: open[0] || null,
          kind: open.length ? "cart_link" : "register_confirm",
          phone: to,
          numberId,
          payload: open.length
            ? { text: cartText(greet, (e2 as any).self_service_slug, open, cb), order_ids: open }
            : { text: confirmText },
        });
        if (!queued) {
          // Fallback: fila indisponível → envio direto atual (nunca "não enviar").
          try {
            if (open.length) await sendCartMessage(numberId, to, greet, (e2 as any).self_service_slug, open, cb);
            else await waSend(numberId, to, confirmText);
          } catch (err) {
            console.error("[live-selfservice] resposta automática falhou", err);
            return json({ ok: false, error: String(err) }, 502);
          }
        }
        await sb.from("live_selfservice_accesses").update({ metadata: { ...(a.metadata || {}), auto_reply_sent_at: new Date().toISOString(), auto_reply_case: open.length ? "A" : "B" } }).eq("id", a.id);
        return json({ ok: true, case: open.length ? "A" : "B" });
      }
      // send_cart: pedido novo de cliente que já confirmou no WhatsApp (Caso B → link sai sozinho).
      const orderId = String(body.orderId || "");
      const { data: o } = await sb.from("orders").select("id, event_id, customer_id, products, discount_type, discount_value, free_shipping, shipping_cost, registered_at, is_paid, paid_externally, stage, selfservice_cart_sent_at").eq("id", orderId).maybeSingle();
      if (!o) return json({ ok: false, sent: false });
      if (o.is_paid || o.paid_externally || o.stage === "cancelled" || !Array.isArray(o.products) || !o.products.length) return json({ ok: true, sent: false });
      const { data: e3 } = await sb.from("events").select("operation_mode, self_service_slug, whatsapp_number_id").eq("id", (o as any).event_id).maybeSingle();
      if ((e3 as any)?.operation_mode !== MODE || !(e3 as any)?.self_service_slug) return json({ ok: true, sent: false });
      const { data: c } = await sb.from("customers").select("whatsapp, instagram_handle").eq("id", (o as any).customer_id).maybeSingle();
      const { data: resolvedAccess, error: accessError } = await sb.rpc("selfservice_access_for_order", { p_order_id: orderId });
      if (accessError || !resolvedAccess) return json({ ok: true, sent: false });
      const { data: acc } = await sb.from("live_selfservice_accesses").select("id, instagram, order_ids, entered_phone, confirmed_phone, confirmed_number_id, registered_at, metadata, advertising_consent_id, advertising_snapshot, advertising_signals")
        .eq("id", resolvedAccess).maybeSingle();
      if (!acc) return json({ ok: true, sent: false });
      const a = acc as any;
      const cp = normalizeBrPhone(a.confirmed_phone || "");
      if (!cp) return json({ ok: true, sent: false });
      const numberId = a.confirmed_number_id || (await resolveEventNumber(sb, (o as any).event_id, (e3 as any).whatsapp_number_id)).id;
      const greet = greetName((c as any)?.instagram_handle, await regName([orderId], a.entered_phone));
      // Cadastro feito na página vale para o pedido novo também.
      let prev = a.metadata?.registration_details || null;
      if (!prev && a.order_ids?.length) {
        const { data } = await sb.from("customer_registrations").select("full_name, cpf, email, cep, address, address_number, complement, neighborhood, city, state")
          .in("order_id", a.order_ids).neq("cpf", "").order("created_at", { ascending: false }).limit(1).maybeSingle();
        prev = data;
      }
      // Older no-order registrations have no order_ids; only a unique exact verified
      // phone record may supply their saved fields (never a loose suffix match).
      if (!prev) {
        const { data } = await sb.from("customers_unified").select("name, cpf, email, cep, address, address_number, complement, neighborhood, city, state")
          .eq("phone_e164", cp).limit(2);
        if (data?.length === 1) { const { name, ...fields } = data[0]; prev = { ...fields, full_name: name }; }
      }
      if (!prev || !isValidCpf(String(prev.cpf || "")) || !isRealFullName(prev.full_name) || !prev.address || !prev.cep) return json({ ok: true, sent: false, reason: "registration_unavailable" });
      const nextConsent = await loadSelfserviceAdvertising(sb, a.advertising_consent_id);
      const nextSignals = nextConsent && a.advertising_snapshot?.advertising ? { ...(a.advertising_signals || {}), selfservice_advertising_consent_id: nextConsent.id, selfservice_advertising_snapshot: a.advertising_snapshot }
        : ordinaryAllowed(a.advertising_snapshot) ? { ...(a.advertising_signals || {}), selfservice_advertising_consent_id: null, selfservice_advertising_snapshot: a.advertising_snapshot } : {};
      if (prev) {
        const { data: has } = await sb.from("customer_registrations").select("id").eq("order_id", orderId).maybeSingle();
        if (!has) {
          const { error } = await sb.from("customer_registrations").insert({ ...(prev as any), ...nextSignals, order_id: orderId, whatsapp: digits(cp) });
          if (error) throw error;
        }
      }
      if (!o.registered_at) await sb.from("orders").update({ registered_at: a.registered_at }).eq("id", orderId).is("registered_at", null);
      // O card abre o WhatsApp que mandou o código; o número digitado só é trocado quando é ele que está no card.
      const cardPhone = normalizeBrPhone(String((c as any)?.whatsapp || ""));
      if (!c?.whatsapp) await sb.from("customers").update({ whatsapp: cp, updated_at: new Date().toISOString() }).eq("id", o.customer_id).or("whatsapp.is.null,whatsapp.eq.");
      else if (cardPhone && cardPhone !== cp && cardPhone === normalizeBrPhone(a.metadata?.entered_phone_original || a.entered_phone || "")) {
        await sb.from("customers").update({ whatsapp: cp, updated_at: new Date().toISOString() }).eq("id", o.customer_id);
      }
      await sb.from("live_selfservice_accesses").update({ order_ids: Array.from(new Set([...(a.order_ids || []), orderId])), updated_at: new Date().toISOString() }).eq("id", a.id);
      if (o.selfservice_cart_sent_at) return json({ ok: true, sent: false, already: true });
      const cbOne = await cashbackHint(orderTotal(o));
      const toPhone = a.confirmed_phone || cp;
      const queuedCart = await queueAuto({
        key: `cart:${orderId}`,
        eventId: (o as any).event_id,
        orderId,
        kind: "cart_link",
        phone: toPhone,
        numberId,
        payload: { text: cartText(greet, (e3 as any).self_service_slug, [orderId], cbOne), order_ids: [orderId] },
      });
      if (!queuedCart) {
        try { await sendCartMessage(numberId, toPhone, greet, (e3 as any).self_service_slug, [orderId], cbOne); }
        catch (err) { console.error("[live-selfservice] send_cart falhou", err); return json({ ok: false, sent: false, error: String(err) }, 502); }
      }
      return json({ ok: true, sent: true });
    }
    const slug = String(body.slug || "").trim().toLowerCase().slice(0, 80);
    if (!slug) return json({ ok: false, error: "Link inválido" }, 400);

    const { data: ev } = await sb
      .from("events")
      .select("id, name, operation_mode, whatsapp_number_id, installment_max, installment_min_value, self_service_prize_name, self_service_prize_image_url, self_service_registration_minutes, self_service_product_notice, capi_advanced_matching, google_rating_text, google_profile_url")
      .eq("self_service_slug", slug)
      .maybeSingle();
    if (!ev || ev.operation_mode !== MODE) return json({ ok: false, error: "not_found" }, 404);

    let officialPhone: string | null = null;
    const evNum = await resolveEventNumber(sb, ev.id, ev.whatsapp_number_id);
    (ev as any).whatsapp_number_id = evNum.id;
    if (evNum.id) {
      const { data: wn } = await sb.from("whatsapp_numbers").select("phone_display").eq("id", evNum.id).maybeSingle();
      const d = digits((wn as any)?.phone_display) || digits(evNum.targetPhone);
      officialPhone = d ? (d.startsWith("55") ? d : "55" + d) : null;
    } else if (evNum.targetPhone) {
      const d = digits(evNum.targetPhone);
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
      google_rating: ev.google_rating_text || null,
      google_url: ev.google_profile_url || null,
    };

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
        cashback_deadline: o.selfservice_cart_sent_at ? new Date(Date.parse(o.selfservice_cart_sent_at) + 20 * 60 * 1000).toISOString() : null,
        free_shipping: !!o.free_shipping,
        shipping_cost: Number(o.shipping_cost || 0),
        registration_confirmed: o.registration_confirmed === true,
        discount_type: o.discount_type,
        discount_value: o.discount_value,
      };
    };

    if (action === "event") return json({ ok: true, event: eventInfo });
    // Link único enviado no direct: só revela o @ do pedido (nenhum dado pessoal).
    if (action === "invite") {
      const t = String(body.invite || "");
      if (!/^[0-9a-f]{32}$/.test(t)) return json({ ok: false });
      const { data: n } = await sb.from("ig_live_cart_notifications").select("instagram_handle")
        .eq("link_token", t).eq("event_id", ev.id).maybeSingle();
      return json({ ok: !!n, instagram: n?.instagram_handle || null });
    }
    if (action === "advertising_choice") {
      if (typeof body.accepted !== "boolean") return json({ ok: false }, 400);
      const { data, error } = await sb.rpc("selfservice_save_advertising_choice", { p_id: /^[0-9a-f-]{36}$/i.test(String(body.consent_id || "")) ? body.consent_id : null, p_accept: body.accepted, p_region: /^[A-Z]{2}$/.test(String(body.region || "")) ? body.region : null });
      return error ? json({ ok: false }, 400) : json({ ok: true, consent_id: data });
    }
    if (action === "meta_signals") {
      const adv = await resolveSelfserviceAdvertising(sb, body.signals);
      const { data: order } = await sb.from("orders").select("id,is_paid").eq("id", String(body.order_id || "")).eq("event_id", ev.id).maybeSingle();
      if (!order) return json({ ok: true, blocked: true });
      // Recusa vale na hora, inclusive para pedido já pago (bloqueia envio pendente).
      if (adv?.mode === "refused") {
        await sb.from("customer_registrations").update({ selfservice_advertising_consent_id: adv.consentId, selfservice_advertising_snapshot: adv.snapshot }).eq("order_id", order.id);
        return json({ ok: true, blocked: true });
      }
      if (!adv || order.is_paid) return json({ ok: true, blocked: true });
      const signals = cleanSelfserviceSignals(body.signals, req);
      const { error } = await sb.from("customer_registrations").update({ ...signals, selfservice_advertising_consent_id: adv.consentId, selfservice_advertising_snapshot: adv.snapshot }).eq("order_id", order.id);
      return json({ ok: !error });
    }


    // ───── Página do link do carrinho (pedido deste modo) ─────
    if (action === "cart" || action === "pix" || action === "status") {
      const orderId = String(body.order_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ ok: false, error: "not_found" }, 404);
      const { data: o } = await sb.from("orders")
        .select("id, event_id, customer_id, products, stage, is_paid, paid_externally, created_at, payment_window_expires_at, registered_at, discount_type, discount_value, free_shipping, shipping_cost, cashback_id, cashback_amount, merged_into_order_id, selfservice_cart_sent_at, selfservice_cashback_receipt")
        .eq("id", orderId).eq("event_id", ev.id).maybeSingle();
      if (!o || (o as any).stage === "cancelled") return json({ ok: false, error: "not_found" }, 404);
      const paid = !!(o as any).is_paid || !!(o as any).paid_externally;
      if (paid) {
        await sb.from("live_selfservice_accesses").update({ paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("event_id", ev.id).contains("order_ids", [orderId]).is("paid_at", null);
      }
      if (action === "status") return json({ ok: true, paid, amount_paid: (o as any).selfservice_cashback_receipt?.amount_paid || null });
      const { data: reg } = await sb.from("customer_registrations")
        .select("full_name, cpf, email, whatsapp, cep, address, address_number, complement, neighborhood, city, state").eq("order_id", orderId).maybeSingle();
      const r = reg as any;
      if (action === "cart") {
        const form = r ? { fullName: r.full_name, email: r.email, cpf: r.cpf, whatsapp: r.whatsapp, cep: r.cep, address: r.address, addressNumber: r.address_number, complement: r.complement || "", neighborhood: r.neighborhood || "", city: r.city, state: r.state } : null;
        return json({ ok: true, event: eventInfo, order: mapOrder(o), paid, amount_paid: (o as any).selfservice_cashback_receipt?.amount_paid || null, form });
      }
      // pix
      if (paid) return json({ ok: true, paid: true });
      if (!r) return json({ ok: false, error: "Cadastro não encontrado para este pedido." }, 400);
      // Pagamento dividido em aberto: nunca cobrar o total cheio no Pix avulso.
      const { data: splits, error: splitError } = await sb.from("payment_splits").select("id, status").eq("order_id", orderId);
      if (splitError) return json({ ok: false, error: "Não foi possível conferir os pagamentos deste pedido. Tente novamente." }, 503);
      if (((splits || []) as any[]).some((x) => !["refunded", "canceled", "cancelled"].includes(String(x.status)))) {
        return json({ ok: false, split: true, error: "Este pedido tem pagamento dividido — use a opção de pagamento abaixo." });
      }
      if (!(await allow(`ss-pix:${orderId}`, 4, 600))) return json({ ok: false, error: "Você já gerou o Pix várias vezes. Aguarde alguns minutos." }, 429);
      const nameParts = String(r.full_name || "").trim().split(/\s+/);
      const pr = await fetch(`${SB_URL}/functions/v1/mercadopago-create-pix`, {
        method: "POST", headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, payer: { firstName: nameParts[0], lastName: nameParts.slice(1).join(" "), email: r.email, cpf: r.cpf, phone: r.whatsapp } }),
      });
      const pd = await pr.json().catch(() => ({}));
      if (!pr.ok || !(pd as any)?.qrCode) {
        console.error("[live-selfservice] pix falhou", pr.status, pd);
        return json({ ok: false, error: (pd as any)?.error || "Não foi possível gerar o Pix agora." }, 502);
      }
      const amount = Number((pd as any).amount ?? mapOrder(o).pix_total);
      // Envia o mesmo Pix no WhatsApp da cliente (melhor esforço: a página já mostra o código).
      let sentWa = false;
      try {
        const { data: acc } = await sb.from("live_selfservice_accesses").select("confirmed_phone, confirmed_number_id")
          .eq("event_id", ev.id).contains("order_ids", [orderId]).not("whatsapp_confirmed_at", "is", null)
          .order("whatsapp_confirmed_at", { ascending: false }).limit(1).maybeSingle();
        const { data: c } = await sb.from("customers").select("whatsapp").eq("id", (o as any).customer_id).maybeSingle();
        const to = (acc as any)?.confirmed_phone || (c as any)?.whatsapp || r.whatsapp;
        const numberId = (acc as any)?.confirmed_number_id || ev.whatsapp_number_id;
        if (to && numberId) {
          const code = String((pd as any).qrCode).trim();
          const { data: numP } = await sb.from("whatsapp_numbers").select("provider").eq("id", numberId).maybeSingle();
          const isUaz = (numP as any)?.provider === "uazapi";
          let ok = false;
          if (isUaz) {
            ok = await queueAuto({
              key: `pix:${orderId}`, eventId: ev.id, orderId, kind: "pix_code", phone: to, numberId,
              payload: { text: `💰 *PIX de ${fmtBRL(amount)}*\n\nToque em *Copiar código PIX* aqui embaixo, abra o app do seu banco em *Pix → Pix Copia e Cola* e cole o código. 👇`, copy_code: code },
            });
          } else {
            const q1 = await queueAuto({
              key: `pix:${orderId}:1`, eventId: ev.id, orderId, kind: "pix_code", phone: to, numberId,
              payload: { text: `💰 *PIX de ${fmtBRL(amount)}*\n\n👇 O código *copia e cola* vem na *próxima mensagem*. Toque e segure nela, escolha *Copiar* e cole no app do seu banco em *Pix → Pix Copia e Cola*.` },
            });
            const q2 = await queueAuto({
              key: `pix:${orderId}:2`, eventId: ev.id, orderId, kind: "pix_code", phone: to, numberId,
              payload: { text: code },
            });
            ok = q1 && q2;
          }
          if (ok) sentWa = true;
          else { await waSendPix(numberId, to, code, amount); sentWa = true; } // fallback: envio direto
        }
      } catch (err) { console.error("[live-selfservice] pix no WhatsApp falhou", err); }
      return json({ ok: true, qr_code: (pd as any).qrCode, qr_base64: (pd as any).qrCodeBase64 || null, amount, sent_whatsapp: sentWa });
    }

    const phone = normalizeBrPhone(body.phone);
    if (!phone) return json({ ok: false, error: "Digite o WhatsApp completo com DDD." }, 400);

    // Disparo em massa (?d=): liga o acesso ao destinatário e carimba os pedidos. Best-effort.
    async function linkDispatch(accessId: string | null | undefined) {
      if (!accessId) return;
      const dc = String(body.dispatch_code || "").toLowerCase();
      try {
        await sb.rpc("dispatch_link_access", { p_access_id: accessId, p_code: /^[a-z0-9]{6,8}$/.test(dc) ? dc : null });
      } catch (e) { console.error("[dispatch link]", e); }
    }

    if (action === "capture") {
      if (!(await allow(`ss-id-ip:${ip}`, 40, 600))) return json({ ok: false, error: "Aguarde alguns minutos." }, 429);
      const { data, error } = await sb.rpc("selfservice_capture_initial", {
        p_event_id: ev.id, p_phone: phone, p_instagram: String(body.instagram || "").slice(0, 60) || null,
        p_access_id: /^[0-9a-f-]{36}$/i.test(String(body.access_id || "")) ? body.access_id : null,
      });
      if (error) return json({ ok: false, error: "Não foi possível guardar o contato agora." }, 400);
      await linkDispatch((data as any)?.access_id);
      return json({ ok: true, ...data });
    }

    // Pedidos do @ que recebeu o link único (mesmo sem os 4 últimos dígitos).
    async function inviteOrders(): Promise<any[]> {
      const t = String(body.invite || "");
      if (!/^[0-9a-f]{32}$/.test(t)) return [];
      const { data: n } = await sb.from("ig_live_cart_notifications").select("order_id")
        .eq("link_token", t).eq("event_id", ev.id).maybeSingle();
      if (!n?.order_id) return [];
      const { data: base } = await sb.from("orders").select("customer_id").eq("id", n.order_id).eq("event_id", ev.id).maybeSingle();
      if (!base?.customer_id) return [];
      const { data } = await sb.from("orders")
        .select("id, products, stage, is_paid, paid_externally, created_at, payment_window_expires_at, registered_at, discount_type, discount_value, free_shipping, shipping_cost, cashback_id, cashback_amount, merged_into_order_id, customer:customers(instagram_handle)")
        .eq("event_id", ev.id).eq("customer_id", base.customer_id).neq("stage", "cancelled").eq("is_paid", false)
        .order("created_at", { ascending: true }).limit(10);
      return (data || []).filter((o: any) => !o.paid_externally && !o.merged_into_order_id && Array.isArray(o.products) && o.products.length > 0);
    }

    async function openOrders() {
      const byPhone = await openOrdersByPhone();
      const extra = await inviteOrders();
      const seen = new Set(byPhone.map((o: any) => o.id));
      return [...byPhone, ...extra.filter((o: any) => !seen.has(o.id))];
    }

    async function openOrdersByPhone(): Promise<any[]> {
      const { data: custs } = await sb.from("customers").select("id, whatsapp").ilike("whatsapp", `%${suffix8(phone)}`).limit(100);
      const ids = (custs || []).filter((c: any) => normalizeBrPhone(c.whatsapp || "") === phone).map((c: any) => c.id);
      if (!ids.length) {
        const { data: matches } = await sb.rpc("selfservice_match_initial_order", { p_event_id: ev.id, p_phone: phone });
        if (!matches?.length) return [];
        const { data: matched } = await sb.from("orders")
          .select("id, products, stage, is_paid, paid_externally, created_at, payment_window_expires_at, registered_at, discount_type, discount_value, free_shipping, shipping_cost, cashback_id, cashback_amount, merged_into_order_id, customer:customers(instagram_handle)")
          .eq("event_id", ev.id).in("id", matches);
        return matched || [];
      }
      const { data } = await sb
        .from("orders")
        .select("id, products, stage, is_paid, paid_externally, created_at, payment_window_expires_at, registered_at, discount_type, discount_value, free_shipping, shipping_cost, cashback_id, cashback_amount, merged_into_order_id, customer:customers(instagram_handle)")
        .eq("event_id", ev.id)
        .in("customer_id", ids)
        .neq("stage", "cancelled")
        .eq("is_paid", false)
        .order("created_at", { ascending: true })
        .limit(10);
      const existingOrders = (data || []).filter((o: any) => !o.paid_externally && !o.merged_into_order_id && Array.isArray(o.products) && o.products.length > 0);
      if (existingOrders.length) return existingOrders;
      const { data: matches } = await sb.rpc("selfservice_match_initial_order", { p_event_id: ev.id, p_phone: phone });
      if (!matches?.length) return [];
      const { data: matched } = await sb.from("orders")
        .select("id, products, stage, is_paid, paid_externally, created_at, payment_window_expires_at, registered_at, discount_type, discount_value, free_shipping, shipping_cost, cashback_id, cashback_amount, merged_into_order_id, customer:customers(instagram_handle)")
        .eq("event_id", ev.id).in("id", matches);
      return matched || [];
    }

    async function knownCustomer(): Promise<boolean> {
      const { data: regs } = await sb.from("customer_registrations").select("whatsapp")
        .ilike("whatsapp", `%${suffix8(phone)}`).neq("cpf", "").limit(50);
      if ((regs || []).some((r: any) => samePhone(r.whatsapp || "", phone))) return true;
      const { count: c2 } = await sb.from("customers_unified").select("id", { count: "exact", head: true })
        .eq("phone_suffix8", suffix8(phone)).eq("ddd", dddOf(phone)).not("cpf", "is", null);
      return (c2 || 0) > 0;
    }

    async function savedDetails(): Promise<any> {
      const { data: regs } = await sb.from("customer_registrations")
        .select("whatsapp, full_name, cpf, email, cep, address, address_number, complement, neighborhood, city, state")
        .ilike("whatsapp", `%${suffix8(phone)}`).neq("cpf", "").order("created_at", { ascending: false }).limit(50);
      let d: any = (regs || []).find((r: any) => samePhone(r.whatsapp || "", phone)) || null;
      if (!d) {
        const { data: cu } = await sb.from("customers_unified")
          .select("name, cpf, email, cep, address, address_number, complement, neighborhood, city, state")
          .eq("phone_suffix8", suffix8(phone)).eq("ddd", dddOf(phone)).limit(2);
        if ((cu || []).length === 1) d = { ...cu[0], full_name: (cu[0] as any).name };
      }
      return d || null;
    }

    if (action === "identify") {
      if (!(await allow(`ss-id-ip:${ip}`, 40, 600))) return json({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      const { data: capture, error: captureError } = await sb.rpc("selfservice_capture_initial", {
        p_event_id: ev.id, p_phone: phone, p_instagram: String(body.instagram || "").slice(0, 60) || null,
        p_access_id: /^[0-9a-f-]{36}$/i.test(String(body.access_id || "")) ? body.access_id : null,
      });
      if (captureError || !capture?.access_id) return json({ ok: false, error: "Não foi possível identificar agora." }, 400);
      const orders = await openOrders();
      const known = await knownCustomer();
      const instagram = String(body.instagram || "").trim().replace(/^@/, "").slice(0, 60) || null;
      const igHint = orderInstagram(orders as any[], instagram);
      const acc = { id: capture.access_id };
      await sb.from("live_selfservice_accesses").update({
        instagram: igHint, order_ids: orders.map((o: any) => o.id),
      }).eq("id", acc.id).is("whatsapp_confirmed_at", null);
      await linkDispatch(acc.id);
      const details = known ? await savedDetails() : null;
      // Rascunho deixado numa visita anterior (mesmo WhatsApp neste evento):
      // a cliente continua o cadastro de onde parou.
      const { data: prevDraft } = await sb.from("live_selfservice_accesses")
        .select("form_draft")
        .eq("event_id", ev.id).eq("phone_key", phoneKey(phone))
        .not("form_draft", "is", null)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const { data: confirmedAccess } = await sb.from("live_selfservice_accesses").select("order_ids")
        .eq("event_id", ev.id).eq("confirmed_phone_key", phoneKey(phone)).not("whatsapp_confirmed_at", "is", null).limit(100);
      const confirmedIds = new Set((confirmedAccess || []).flatMap((a: any) => a.order_ids || []));
      return json({ ok: true, event: eventInfo, access_id: acc?.id || null, known, details, instagram_hint: igHint, draft: (prevDraft as any)?.form_draft || null, orders: orders.map((o: any) => mapOrder({ ...o, registration_confirmed: confirmedIds.has(o.id) })) });
    }

    // Rascunho do formulário: salvo enquanto a cliente digita (espelhado na ficha do chat).
    const DRAFT_FIELDS = ["full_name", "cep", "address", "address_number", "complement", "neighborhood", "city", "state", "cpf", "email", "use_alt", "alt_cep", "alt_address", "alt_address_number", "alt_complement", "alt_neighborhood", "alt_city", "alt_state"] as const;
    if (action === "draft") {
      if (!(await allow(`ss-draft:${phone}`, 120, 600))) return json({ ok: true }); // silencioso: rascunho é best-effort
      const accessId = String(body.access_id || "");
      if (!accessId) return json({ ok: false, error: "Sessão inválida." }, 400);
      const src = (body.details || {}) as Record<string, unknown>;
      const draft: Record<string, string> = {};
      for (const k of DRAFT_FIELDS) draft[k] = String(src[k] ?? "").slice(0, 200);
      await sb.from("live_selfservice_accesses")
        .update({ form_draft: draft, updated_at: new Date().toISOString() })
        .eq("id", accessId).eq("event_id", ev.id).is("whatsapp_confirmed_at", null);
      return json({ ok: true });
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
      return verifyAccessCode(sb, phone, String(body.code || ""));
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
      const adv = await resolveSelfserviceAdvertising(sb, body.signals);
      const allowed = adv && adv.mode !== "refused";
      const signals = allowed ? cleanSelfserviceSignals(body.signals, req) : {};
      const now = new Date().toISOString();
      const orders = await openOrders();
      const reqIds: string[] = Array.isArray(body.order_ids) ? body.order_ids.map(String) : [];
      const target = orders.filter((o: any) => reqIds.includes(o.id));
      if (reqIds.length && target.length !== reqIds.length) return json({ ok: false, error: "Seu pedido mudou. Volte e identifique novamente." }, 409);
      const igReg = orderInstagram(target as any[], String(body.instagram || ""));
      const { data: access } = await sb.from("live_selfservice_accesses").select("id, metadata, entered_phone")
        .eq("id", String(body.access_id || "")).eq("event_id", ev.id).maybeSingle();
      if (!access || normalizeBrPhone(access.entered_phone) !== phone) return json({ ok: false, error: "Identifique seu WhatsApp novamente." }, 400);

      // CRM unificado
      const { error: uErr } = await sb.rpc("find_or_create_unified_customer", {
        p_phone: phone, p_name: fullName, p_instagram: null, p_cpf: cpf, p_email: email, p_source: "member_area",
      });
      if (uErr) console.error("[live-selfservice] unified", uErr.message);
      await sb.from("customers_unified").update(addr).eq("phone_suffix8", suffix8(phone)).eq("ddd", dddOf(phone));

      // Endereço alternativo de entrega: vale só para o pedido; o endereço
      // principal da ficha (customers_unified) continua intacto.
      const altSrc = (body.alt_address || null) as Record<string, unknown> | null;
      const altAddr = altSrc ? {
        cep: String(altSrc.cep || "").replace(/\D/g, "").slice(0, 8),
        address: String(altSrc.address || "").trim().slice(0, 160),
        address_number: String(altSrc.address_number || "").trim().slice(0, 20),
        complement: String(altSrc.complement || "").trim().slice(0, 120),
        neighborhood: String(altSrc.neighborhood || "").trim().slice(0, 120),
        city: String(altSrc.city || "").trim().slice(0, 120),
        state: String(altSrc.state || "").trim().slice(0, 2).toUpperCase(),
      } : null;
      const orderAddr = altAddr && altAddr.cep.length === 8 && altAddr.address && altAddr.address_number && altAddr.city && altAddr.state ? altAddr : addr;

      if (target.length) {
        for (const o of target) {
          const payload = { order_id: o.id, whatsapp: phone, full_name: fullName, cpf, email, ...orderAddr, ...signals, selfservice_advertising_consent_id: adv?.consentId || null, selfservice_advertising_snapshot: adv?.snapshot || null };
          const { data: reg } = await sb.from("customer_registrations").select("id").eq("order_id", o.id).maybeSingle();
          if (reg?.id) await sb.from("customer_registrations").update(payload).eq("id", reg.id);
          else await sb.from("customer_registrations").insert(payload);
          if (!o.registered_at) await sb.from("orders").update({ registered_at: now }).eq("id", o.id).is("registered_at", null);
        }
      } else {
        // Caso B: lead do evento
        const { data: leadRows } = await sb.from("event_leads").select("id, source, metadata, phone")
          .eq("event_id", ev.id).eq("phone_suffix", suffix8(phone)).order("created_at").limit(20);
        const lead = (leadRows || []).find((l: any) => samePhone(l.phone || "", phone)) || null;
        const metaBase = (lead?.metadata as any) || {};
        const metadata = {
          ...metaBase,
          self_service_registered_at: metaBase.self_service_registered_at || now,
          ...(lead && lead.source !== "autoatendimento" && !metaBase.original_source ? { original_source: lead.source } : {}),
        };
        if (lead?.id) {
          await sb.from("event_leads").update({ name: fullName, metadata, instagram: igReg || undefined }).eq("id", lead.id);
        } else {
          const { data: buyers } = await sb.from("customers_unified").select("id")
            .eq("phone_suffix8", suffix8(phone)).eq("ddd", dddOf(phone)).gt("total_orders", 0).limit(1);
          if (!buyers?.length) await sb.from("event_leads").insert({ event_id: ev.id, name: fullName, phone, source: "autoatendimento", metadata, instagram: igReg || null });
        }
      }

      if (body.access_id) {
        await sb.from("live_selfservice_accesses").update({ registered_at: now, form_draft: null, updated_at: now, advertising_consent_id: adv?.consentId || null, advertising_snapshot: adv?.snapshot || null, advertising_signals: allowed ? signals : null })
          .eq("id", body.access_id).eq("event_id", ev.id);
      }

      // Código único de confirmação (mesmo formato do /zap), gravado no acesso.
      let accessId: string | null = body.access_id ? String(body.access_id) : null;
      if (!accessId) {
        const { data: na } = await sb.from("live_selfservice_accesses").insert({
          event_id: ev.id, entered_phone: phone, phone_key: phoneKey(phone), instagram: igReg || null,
          order_ids: target.map((o: any) => o.id), registered_at: now,
        }).select("id").single();
        accessId = na?.id || null;
      }
      let code: string | null = null;
      const nextMetadata = { ...((access.metadata as Record<string, unknown>) || {}) };
      nextMetadata.registration_details = { full_name: fullName, cpf, email, ...orderAddr };
      delete nextMetadata.auto_reply_sent_at;
      delete nextMetadata.auto_reply_case;
      for (let i = 0; i < 6 && accessId && !code; i++) {
        const cand = genCode();
        const { count } = await sb.from("live_whatsapp_clicks").select("id", { count: "exact", head: true }).eq("code", cand);
        if ((count || 0) > 0) continue;
        const { error } = await sb.from("live_selfservice_accesses")
          .update({ confirm_code: cand, whatsapp_confirmed_at: null, confirmed_phone: null, confirmed_phone_key: null, confirmed_number_id: null, confirm_message_id: null, instagram: igReg, metadata: nextMetadata, form_draft: null, updated_at: now, order_ids: target.map((o: any) => o.id) })
          .eq("id", accessId).eq("event_id", ev.id);
        if (!error) code = cand;
      }
      if (!code) return json({ ok: false, error: "Não foi possível gerar a confirmação. Tente novamente." }, 503);
      await linkDispatch(accessId);
      // Lead na Meta via CAPI (servidor; os dados são hasheados na função de eventos).
      // Base legal validada pelo controlador; respeita o flag do evento e a recusa da cliente.
      try {
        if (adv?.mode !== "refused" && accessId) {
          const advFlag = (ev as any).capi_advanced_matching !== false;
          const leadBody: Record<string, unknown> = {
            event_name: "Lead",
            event_id: `lead_ss_${accessId}`,
            from_server: true,
            action_source: "website",
          };
          if (target.length) {
            // Com pedido: a função de eventos puxa o cadastro do próprio pedido e aplica o flag.
            leadBody.order_id = target[0].id;
          } else {
            if (advFlag) Object.assign(leadBody, { phone, email, full_name: fullName, city: addr.city, state: addr.state, zip: addr.cep });
            if (allowed) Object.assign(leadBody, {
              fbc: (signals as any).fbc || undefined,
              fbp: (signals as any).fbp || undefined,
              client_ip_address: (signals as any).client_ip || undefined,
              client_user_agent: (signals as any).client_user_agent || undefined,
            });
          }
          const leadReq = fetch(`${SB_URL}/functions/v1/meta-capi-event`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(leadBody),
          }).then((r) => r.json().catch(() => ({}))).then((d) => { if (!(d as any)?.ok) console.warn("[live-selfservice] lead capi recusado", JSON.stringify(d).slice(0, 300)); })
            .catch((e) => console.warn("[live-selfservice] lead capi falhou", e));
          const rt = (globalThis as any).EdgeRuntime;
          if (rt?.waitUntil) rt.waitUntil(leadReq); else await leadReq;
        }
      } catch (e) { console.warn("[live-selfservice] lead capi", e); }

      const greet = greetName(igReg, fullName);
      const text = `Oii, aqui é a ${greet}, já preenchi meu cadastro #${code || ""}. ${target.length ? "Pode enviar o link do meu carrinho?" : "Pode confirmar meu cadastro para a live?"}`;
      const waUrl = officialPhone ? `https://wa.me/${officialPhone}?text=${encodeURIComponent(text)}` : null;
      return json({ ok: true, code, text, wa_url: waUrl, has_order: target.length > 0 });
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
