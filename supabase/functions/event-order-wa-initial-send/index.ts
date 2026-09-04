// Mensagem inicial NÃO-API (uazapi/wasender/zapi) do evento em modo WhatsApp.
// Escolhe uma das variações configuradas em rodízio (round-robin atômico via
// RPC next_event_wa_initial_variant), resolve as variáveis do pedido e envia
// pela instância configurada no evento. Registra em whatsapp_messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { issueMagicLink } from "../_shared/member-magic-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Variant {
  text: string;
  media_url?: string | null;
  media_type?: string | null;
}

const MEMBER_AREA_PUBLIC = "https://checkout.bananacalcados.com.br/minha-area";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // viaNumberId (opcional) sobrescreve a instância do evento.
    // Modo CONTATO (sem pedido): informe eventId + phone (+ name opcional) —
    // usado na linha "Novos contatos" da live para quem só digitou o WhatsApp.
    const { orderId, viaNumberId, eventId: contactEventId, phone: contactPhone, name: contactName } = await req.json();
    if (!orderId && !(contactEventId && contactPhone)) {
      return json({ error: "orderId ou (eventId + phone) required" }, 400);
    }

    let order: any;
    let customer: any;
    if (orderId) {
      const { data } = await supabase
        .from("orders")
        .select("id, event_id, customer_id, products, cart_link, discount_type, discount_value")
        .eq("id", orderId)
        .maybeSingle();
      if (!data) return json({ error: "Pedido não encontrado" }, 404);
      if (!data.event_id) return json({ error: "Pedido sem evento vinculado" }, 400);
      order = data;
      const { data: c } = await supabase
        .from("customers")
        .select("id, instagram_handle, whatsapp")
        .eq("id", order.customer_id)
        .maybeSingle();
      customer = c;
    } else {
      order = { id: null, event_id: contactEventId, products: [], cart_link: null, discount_type: null, discount_value: null };
      customer = { instagram_handle: contactName || null, whatsapp: contactPhone };
    }

    const rawPhone = (customer?.whatsapp || "").replace(/\D/g, "");
    if (!rawPhone) return json({ error: "Cliente sem WhatsApp cadastrado" }, 400);
    const waPhone = rawPhone.startsWith("55") ? rawPhone : "55" + rawPhone;

    const { data: ev } = await supabase
      .from("events")
      .select("id, wa_initial_enabled, wa_initial_number_id, wa_initial_variants")
      .eq("id", order.event_id)
      .maybeSingle();

    const variants: Variant[] = (((ev as any)?.wa_initial_variants as Variant[]) || []).filter(
      (v) => v && typeof v.text === "string" && v.text.trim().length > 0,
    );
    if (variants.length === 0) {
      return json({ error: "Nenhuma variação de mensagem configurada no evento (etapa MENSAGEM)." }, 400);
    }
    const numberId: string | null = viaNumberId || (ev as any)?.wa_initial_number_id || null;
    if (!numberId) return json({ error: "Nenhuma instância não-API configurada para a mensagem inicial." }, 400);

    const { data: num } = await supabase
      .from("whatsapp_numbers")
      .select("id, provider, is_active, label")
      .eq("id", numberId)
      .maybeSingle();
    if (!num || !num.is_active) return json({ error: "Instância não encontrada ou inativa." }, 400);
    const provider = String(num.provider || "");
    if (!["uazapi", "wasender", "zapi"].includes(provider)) {
      return json({ error: "A instância da mensagem inicial precisa ser não-API (uazapi/wasender/zapi)." }, 400);
    }

    // ---- Rodízio ----
    const { data: idxData } = await supabase.rpc("next_event_wa_initial_variant", { p_event_id: order.event_id });
    let idx = typeof idxData === "number" ? idxData : 0;
    if (idx < 0 || idx >= variants.length) idx = idx % variants.length;
    const variant = variants[idx];

    // ---- Tokens (mesma resolução do template Meta) ----
    const products = (order.products as any[]) || [];
    const productLines = products
      .map((p: any) => `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ""} — R$${Number(p.price || 0).toFixed(2)}`)
      .join("\n");
    const subtotal = products.reduce(
      (sum: number, p: any) => sum + Number(p.price || 0) * Number(p.quantity || 1),
      0,
    );
    let discountAmount = 0;
    if (order.discount_value && Number(order.discount_value) > 0) {
      discountAmount = order.discount_type === "percentage"
        ? subtotal * (Number(order.discount_value) / 100)
        : Number(order.discount_value);
    }
    const total = Math.max(0, subtotal - discountAmount);

    const igHandle = customer?.instagram_handle || "Cliente";
    const igName = igHandle.startsWith("@") ? igHandle : `@${igHandle}`;
    const firstName = (igHandle.replace(/^@/, "").split(/[._\s]/)[0] || "").trim();
    const displayName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : igName;
    const checkoutLink = order.cart_link || `https://checkout.bananacalcados.com.br/checkout/order/${orderId}`;

    const memberAreaLink = variant.text.includes("{member_area_link}")
      ? await issueMagicLink(supabase, waPhone).catch(() => MEMBER_AREA_PUBLIC)
      : MEMBER_AREA_PUBLIC;

    const tokens: Record<string, string> = {
      "{customer_name}": igHandle || displayName || "",
      "{customer_first_name}": displayName || "",
      "{instagram}": igName || "",
      "{products}": productLines,
      "{products_short}": products.map((p: any) => `${p.quantity || 1}x ${p.title}`).join(", "),
      "{checkout_link}": checkoutLink,
      "{member_area_link}": memberAreaLink,
      "{member_area_public}": MEMBER_AREA_PUBLIC,
      "{subtotal}": `R$${subtotal.toFixed(2)}`,
      "{discount}": `R$${discountAmount.toFixed(2)}`,
      "{total}": `R$${total.toFixed(2)}`,
      "{order_id}": String(orderId).slice(0, 8),
    };
    const text = variant.text.replace(/\{[a-z_]+\}/g, (m) => (m in tokens ? tokens[m] : m)).trim();

    const mediaUrl = variant.media_url || null;
    const mediaType = mediaUrl ? (variant.media_type || "image") : "text";

    const fnBase = provider === "uazapi" ? "uazapi" : provider === "wasender" ? "wasender" : "zapi";
    const headers = {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "x-force-instance": "true",
    };

    let sendResp: Response;
    if (mediaUrl) {
      sendResp = await fetch(`${supabaseUrl}/functions/v1/${fnBase}-send-media`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: waPhone, mediaUrl, mediaType, caption: text, whatsapp_number_id: numberId }),
      });
    } else {
      sendResp = await fetch(`${supabaseUrl}/functions/v1/${fnBase}-send-message`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: waPhone, message: text, whatsapp_number_id: numberId }),
      });
    }
    const sendResult = await sendResp.json().catch(() => ({}));
    if (!sendResp.ok || (sendResult as any)?.error) {
      console.error("[event-order-wa-initial-send] falhou:", sendResp.status, sendResult);
      return json(
        { error: (sendResult as any)?.message || (sendResult as any)?.error || "Falha ao enviar pela instância", details: sendResult },
        502,
      );
    }

    await supabase.from("whatsapp_messages").insert({
      phone: waPhone,
      message: text.slice(0, 4000),
      direction: "outgoing",
      status: "sent",
      media_url: mediaUrl,
      media_type: mediaType,
      whatsapp_number_id: numberId,
      message_id: (sendResult as any)?.messageId || null,
    });
    await supabase.from("orders").update({ last_sent_message_at: new Date().toISOString() }).eq("id", orderId);

    return json({ success: true, via: num.label || provider, phone: waPhone, variant_index: idx, variants: variants.length });
  } catch (e) {
    console.error("[event-order-wa-initial-send] error:", e);
    return json({ error: String(e) }, 500);
  }
});
