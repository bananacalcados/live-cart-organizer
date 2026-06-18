import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import { loadBlockedSuffixes, isBlocked } from "../_shared/blocked-guard.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cron simplificado: apenas dispara follow-ups agendados.
// A lógica de cancelamento por recompra acontece no momento da venda (automation-trigger-pos-sale),
// que cancela tudo que estiver pendente para o mesmo CPF (ou sufixo de telefone) antes de criar nova régua.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(corsHeaders);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date().toISOString();
    const { data: due } = await supabase
      .from("automation_pos_followups")
      .select("id, sale_id, flow_id, step_id, customer_phone, payload")
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

    let sent = 0, errors = 0;

    // Bloqueio cross-instância: não dispara follow-up para contato bloqueado.
    const blockedSuffixes = await loadBlockedSuffixes(supabase);

    for (const f of due) {
      if (isBlocked(blockedSuffixes, f.customer_phone)) {
        await supabase.from("automation_pos_followups")
          .update({ cancelled_at: new Date().toISOString() }).eq("id", f.id);
        continue;
      }
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
        errors++;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: due.length, sent, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("automation-pos-followups-cron error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
