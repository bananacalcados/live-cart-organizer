import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Runs every minute. For each active event follow-up config, looks at unpaid
 * orders in that event and ensures there is a queued row in
 * event_followup_dispatches with the correct scheduled_at.
 *
 * Uses ON CONFLICT DO NOTHING on the (config_id, order_id) unique index so
 * running many times a minute is safe.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Active configs (join events to skip archived/past events if needed)
    const { data: configs, error: cfgErr } = await supabase
      .from("event_followup_configs")
      .select("*")
      .eq("enabled", true);
    if (cfgErr) throw cfgErr;
    if (!configs?.length) {
      return json({ ok: true, scheduled: 0, note: "no active configs" });
    }

    let scheduled = 0;

    for (const cfg of configs) {
      // Pull unpaid, non-cancelled orders of this event
      const { data: orders, error: oErr } = await supabase
        .from("orders")
        .select(
          "id, event_id, is_paid, stage, checkout_started_at, last_sent_message_at, last_customer_message_at, created_at, customer_id",
        )
        .eq("event_id", cfg.event_id)
        .eq("is_paid", false)
        .neq("stage", "cancelled")
        .is("merged_into_order_id", null);
      if (oErr) {
        console.error("[scheduler] orders fetch error:", oErr.message);
        continue;
      }
      if (!orders?.length) continue;

      const rows: any[] = [];
      for (const o of orders) {
        // Choose trigger time
        const baseAt = pickTriggerTime(cfg, o);
        if (!baseAt) continue;
        const scheduledAt = new Date(baseAt.getTime() + cfg.delay_minutes * 60000);
        rows.push({
          config_id: cfg.id,
          event_id: cfg.event_id,
          order_id: o.id,
          channel: cfg.channel,
          scheduled_at: scheduledAt.toISOString(),
          status: "pending",
        });
      }

      if (!rows.length) continue;

      // Upsert-ignore by (config_id, order_id)
      const { error: insErr, count } = await supabase
        .from("event_followup_dispatches")
        .upsert(rows, { onConflict: "config_id,order_id", ignoreDuplicates: true, count: "exact" });
      if (insErr) {
        console.error("[scheduler] insert error:", insErr.message);
        continue;
      }
      scheduled += count || 0;
    }

    return json({ ok: true, scheduled, configs: configs.length });
  } catch (err: any) {
    console.error("[scheduler] error:", err?.message || err);
    return json({ ok: false, error: err?.message || "internal" }, 500);
  }
});

function pickTriggerTime(cfg: any, o: any): Date | null {
  const src = cfg.trigger_source || "auto";
  const parse = (v: any) => (v ? new Date(v) : null);

  if (src === "initial_template") return parse(o.last_sent_message_at) || parse(o.checkout_started_at) || parse(o.created_at);
  if (src === "last_customer_reply") return parse(o.last_customer_message_at);
  if (src === "incomplete_order_created") return o.stage === "incomplete_order" ? parse(o.created_at) : null;
  if (src === "order_created") return parse(o.created_at);

  // auto: respondeu → conta da última resposta; senão → conta do envio inicial
  if (o.last_customer_message_at) return parse(o.last_customer_message_at);
  return parse(o.last_sent_message_at) || parse(o.checkout_started_at) || parse(o.created_at);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
