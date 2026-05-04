import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date().toISOString();
    const { data: due } = await supabase
      .from("automation_pos_followups")
      .select("id, sale_id, flow_id, step_id, customer_phone, customer_phone_suffix, payload, scheduled_at")
      .lte("scheduled_at", now)
      .is("sent_at", null)
      .is("cancelled_at", null)
      .order("scheduled_at", { ascending: true })
      .limit(100);

    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0, cancelled = 0, sent = 0;

    for (const f of due) {
      // Regra de re-compra: se houve nova venda física concluída para este cliente após o agendamento → cancela
      const sinceISO = new Date(new Date(f.scheduled_at).getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const { data: original } = await supabase
        .from("pos_sales")
        .select("created_at")
        .eq("id", f.sale_id)
        .maybeSingle();
      const baseTime = original?.created_at || sinceISO;

      const { data: newer } = await supabase
        .from("pos_sales")
        .select("id, customer_phone, customer_id")
        .gt("created_at", baseTime)
        .eq("status", "completed")
        .limit(50);

      const matched = (newer || []).some((s: any) => {
        const sp = (s.customer_phone || "").replace(/\D/g, "").slice(-8);
        return sp && sp === f.customer_phone_suffix;
      });

      if (matched) {
        await supabase
          .from("automation_pos_followups")
          .update({ cancelled_at: new Date().toISOString(), cancel_reason: "customer_repurchased" })
          .eq("id", f.id);
        cancelled++;
        processed++;
        continue;
      }

      // Envia
      const payload = (f.payload || {}) as any;
      const cfg = payload.action_config || {};
      const action = payload.action_type;
      const vars = payload.vars || {};
      const replaceVars = (s: string) => {
        if (!s) return s;
        let out = s;
        for (const [k, v] of Object.entries(vars)) out = out.split(k).join(String(v));
        return out;
      };

      try {
        if (action === "send_template") {
          const templateName = cfg.templateName || cfg.template_name;
          const language = cfg.language || "pt_BR";
          let components = cfg.components || [];
          if (components.length === 0 && cfg.templateVars) {
            const tv = cfg.templateVars as Record<string, string>;
            const sorted = Object.keys(tv).sort((a, b) => Number(a) - Number(b));
            const parameters = sorted.map((k) => ({ type: "text", text: replaceVars(tv[k]) || "" }));
            if (parameters.length > 0) components = [{ type: "body", parameters }];
          } else if (components.length > 0) {
            components = JSON.parse(replaceVars(JSON.stringify(components)));
          }
          const body: any = { phone: f.customer_phone, templateName, language, whatsappNumberId: cfg.whatsappNumberId };
          if (components.length > 0) body.components = components;
          await supabase.functions.invoke("meta-whatsapp-send-template", { body });
        } else if (action === "send_text") {
          const message = replaceVars(cfg.message || "");
          if (message) {
            await supabase.functions.invoke("meta-whatsapp-send", {
              body: { phone: f.customer_phone, message, whatsappNumberId: cfg.whatsappNumberId },
            });
          }
        }

        await supabase.from("automation_pos_followups").update({ sent_at: new Date().toISOString() }).eq("id", f.id);
        await supabase.from("automation_executions").insert({
          flow_id: f.flow_id, step_id: f.step_id, status: "sent",
          result: { trigger: "pos_sale_completed", followup: true, phone: f.customer_phone, action },
        });
        sent++;
      } catch (e: any) {
        await supabase.from("automation_pos_followups").update({
          cancelled_at: new Date().toISOString(), cancel_reason: "error: " + (e.message || "unknown"),
        }).eq("id", f.id);
      }
      processed++;
    }

    return new Response(JSON.stringify({ ok: true, processed, sent, cancelled }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("automation-pos-followups-cron error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
