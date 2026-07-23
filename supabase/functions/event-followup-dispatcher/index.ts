import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Runs every minute. Picks pending event_followup_dispatches whose
 * scheduled_at has passed and either sends the WhatsApp template or the
 * Instagram DM. Skips (status=skipped) when order is paid, cancelled or
 * customer replied after config was created (stop_on_reply).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("event_followup_dispatches")
    .select("*, config:event_followup_configs(*), order:orders(id,is_paid,stage,customer_id,customer_unified_id,event_id,last_customer_message_at,cart_link,checkout_token,products,discount_value,shipping_cost,event:events(whatsapp_number_id))")
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[dispatcher] fetch error:", error.message);
    return json({ ok: false, error: error.message }, 500);
  }
  if (!due?.length) return json({ ok: true, processed: 0 });

  let sent = 0, skipped = 0, failed = 0;

  for (const row of due) {
    const cfg = row.config;
    const ord = row.order;
    if (!cfg || !ord) {
      await markSkipped(supabase, row.id, "config_or_order_missing");
      skipped++;
      continue;
    }

    // Stop conditions
    if (cfg.stop_on_paid && ord.is_paid) { await markSkipped(supabase, row.id, "order_paid"); skipped++; continue; }
    if (ord.stage === "cancelled") { await markSkipped(supabase, row.id, "order_cancelled"); skipped++; continue; }
    if (
      cfg.stop_on_reply && ord.last_customer_message_at &&
      new Date(ord.last_customer_message_at) > new Date(row.created_at)
    ) { await markSkipped(supabase, row.id, "customer_replied"); skipped++; continue; }

    // Enrich: customer + ig handle
    let customerName = "";
    let igHandle = "";
    if (ord.customer_id) {
      const { data: c } = await supabase.from("customers")
        .select("name, instagram_handle").eq("id", ord.customer_id).maybeSingle();
      customerName = (c as any)?.name || "";
      igHandle = (c as any)?.instagram_handle || "";
    }
    if ((!customerName || !igHandle) && ord.customer_unified_id) {
      const { data: cu } = await supabase.from("customers_unified")
        .select("instagram_handle").eq("id", ord.customer_unified_id).maybeSingle();
      igHandle = igHandle || (cu as any)?.instagram_handle || "";
    }

    const ctx = buildTokenContext(ord, customerName, igHandle);

    try {
      if (cfg.channel === "whatsapp") {
        if (!ord.phone || !cfg.template_name) {
          await markSkipped(supabase, row.id, !ord.phone ? "no_phone" : "no_template"); skipped++; continue;
        }
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/meta-whatsapp-send-template`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: ord.phone,
            templateName: cfg.template_name,
            language: cfg.template_language || "pt_BR",
            whatsappNumberId: cfg.whatsapp_number_id || ord.event?.whatsapp_number_id || null,
            components: buildComponents(cfg.template_variables, ctx),
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || `meta send failed (${resp.status})`);
        await supabase.from("event_followup_dispatches").update({
          status: "sent", sent_at: new Date().toISOString(),
          meta_message_id: data?.messageId || null, attempts: (row.attempts || 0) + 1,
        }).eq("id", row.id);
        sent++;
      } else if (cfg.channel === "instagram") {
        if (!igHandle) { await markSkipped(supabase, row.id, "no_ig_username"); skipped++; continue; }
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/instagram-dm-send`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            username: igHandle,
            text: resolveText(cfg.message_text || "", ctx),
            buttons: (cfg.buttons || []).map((b: any) => ({
              label: resolveText(b.label || "", ctx),
              url: resolveText(b.url || "", ctx),
            })),
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || `ig send failed (${resp.status})`);
        await supabase.from("event_followup_dispatches").update({
          status: "sent", sent_at: new Date().toISOString(),
          attempts: (row.attempts || 0) + 1,
        }).eq("id", row.id);
        sent++;
      } else {
        await markSkipped(supabase, row.id, "unknown_channel"); skipped++;
      }
    } catch (err: any) {
      failed++;
      const attempts = (row.attempts || 0) + 1;
      await supabase.from("event_followup_dispatches").update({
        status: attempts >= 3 ? "failed" : "pending",
        error_message: String(err?.message || err).slice(0, 500),
        attempts,
      }).eq("id", row.id);
    }
  }

  return json({ ok: true, processed: due.length, sent, skipped, failed });
});

type TokenContext = Record<string, string>;

function buildTokenContext(ord: any, customerName: string, igHandle: string): TokenContext {
  const products = Array.isArray(ord.products) ? ord.products : [];
  const subtotal = products.reduce((acc: number, p: any) => {
    const qty = Number(p.quantity ?? p.qty ?? 1) || 1;
    const price = Number(p.price ?? p.unit_price ?? 0) || 0;
    return acc + qty * price;
  }, 0);
  const discount = Number(ord.discount_value || 0);
  const shipping = Number(ord.shipping_cost || 0);
  const total = Math.max(0, subtotal - discount + shipping);
  const firstName = (customerName || "").trim().split(/\s+/)[0] || "";
  const checkoutLink = ord.cart_link
    || (ord.checkout_token
        ? `https://checkout.bananacalcados.com.br/checkout/${ord.checkout_token}`
        : `https://checkout.bananacalcados.com.br/checkout/order/${ord.id}`);
  return {
    "{customer_name}": customerName,
    "{customer_first_name}": firstName || customerName,
    "{instagram}": igHandle ? `@${igHandle.replace(/^@/, "")}` : "",
    "{products}": products.map((p: any) => `${p.quantity || 1}x ${p.title || p.name || ""}`).join("\n"),
    "{products_short}": products.map((p: any) => `${p.quantity || 1}x ${p.title || p.name || ""}`).join(", "),
    "{checkout_link}": checkoutLink,
    "{subtotal}": `R$${subtotal.toFixed(2)}`,
    "{discount}": `R$${discount.toFixed(2)}`,
    "{total}": `R$${total.toFixed(2)}`,
    "{order_id}": String(ord.id || "").slice(0, 8),
  };
}

function resolveText(input: string, ctx: TokenContext): string {
  if (!input) return "";
  return input.replace(/\{[a-z_]+\}/gi, (m) => (m in ctx ? ctx[m] : m));
}

function resolveValue(value: string, ctx: TokenContext): string {
  if (!value) return "";
  // Exact token replacement (e.g. "{customer_name}")
  if (/^\{[a-z_]+\}$/i.test(value) && value in ctx) return ctx[value];
  // Otherwise inline substitution
  return resolveText(value, ctx);
}

function buildComponents(vars: any, ctx: TokenContext): any[] {
  if (!vars || typeof vars !== "object") return [];
  const components: any[] = [];

  const header = typeof vars.__header === "string" ? vars.__header.trim() : "";
  if (header) {
    components.push({
      type: "header",
      parameters: [{ type: "text", text: resolveValue(header, ctx) }],
    });
  }

  const numeric = Object.entries(vars)
    .filter(([k, v]) => /^\d+$/.test(k) && typeof v === "string")
    .map(([k, v]) => [parseInt(k, 10), v as string] as [number, string])
    .sort((a, b) => a[0] - b[0]);

  if (numeric.length) {
    components.push({
      type: "body",
      parameters: numeric.map(([, text]) => ({ type: "text", text: resolveValue(text, ctx) })),
    });
  }

  return components;
}

async function markSkipped(supabase: any, id: string, reason: string) {
  await supabase.from("event_followup_dispatches").update({
    status: "skipped", skip_reason: reason,
  }).eq("id", id);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
