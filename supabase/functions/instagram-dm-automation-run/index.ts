import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Executa uma "automação do evento" quando o cliente clica em um botão de
 * postback do IG. Envia (via meta-messenger-send) o texto opcional + a mídia
 * configurada em events.ig_automations.
 *
 * Body: { eventId, automationId, recipientId, whatsapp_number_id? }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { eventId, automationId, recipientId, whatsapp_number_id } = await req.json();

    if (!eventId || !automationId || !recipientId) {
      return new Response(
        JSON.stringify({ error: "eventId, automationId, recipientId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: ev, error: evErr } = await supabase
      .from("events")
      .select("ig_automations, whatsapp_number_id")
      .eq("id", eventId)
      .single();

    if (evErr || !ev) {
      return new Response(JSON.stringify({ error: "event_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const automations = ((ev as any).ig_automations as Array<{
      id: string;
      label?: string;
      text?: string;
      media?: { kind: "image" | "video" | "audio" | "file"; url: string; mimeType?: string } | null;
    }>) || [];

    const auto = automations.find((a) => a.id === automationId);
    if (!auto) {
      return new Response(JSON.stringify({ error: "automation_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const wnId = whatsapp_number_id || (ev as any).whatsapp_number_id || undefined;
    const send = async (payload: Record<string, unknown>) => {
      const r = await fetch(`${supabaseUrl}/functions/v1/meta-messenger-send`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientId,
          channel: "instagram",
          whatsapp_number_id: wnId,
          ...payload,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) console.warn("[ig-auto-run] send failed:", r.status, d);
      return { ok: r.ok, data: d };
    };

    const results: any[] = [];
    if (auto.text && auto.text.trim().length > 0) {
      results.push(await send({ type: "text", message: auto.text }));
      await new Promise((r) => setTimeout(r, 500));
    }
    if (auto.media?.url) {
      results.push(await send({ type: auto.media.kind, mediaUrl: auto.media.url }));
    }
    if (results.length === 0) {
      return new Response(JSON.stringify({ error: "automation_empty" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, sent: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[ig-auto-run] error:", err);
    return new Response(JSON.stringify({ error: err?.message || "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
