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
    .select("*, config:event_followup_configs(*), order:orders(id,is_paid,stage,phone,customer_id,event_id,last_customer_message_at,instagram_username,event:events(whatsapp_number_id))")
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
            components: buildComponents(cfg.template_variables, ord),
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
        if (!ord.instagram_username) { await markSkipped(supabase, row.id, "no_ig_username"); skipped++; continue; }
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/instagram-dm-send`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            username: ord.instagram_username,
            text: cfg.message_text || "",
            buttons: cfg.buttons || [],
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

function buildComponents(vars: any, ord: any): any[] {
  if (!vars || typeof vars !== "object") return [];
  // Simple body parameters ordered by numeric keys
  const entries = Object.entries(vars).filter(([, v]) => typeof v === "string");
  if (!entries.length) return [];
  return [{
    type: "body",
    parameters: entries.map(([, text]) => ({ type: "text", text: String(text) })),
  }];
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
