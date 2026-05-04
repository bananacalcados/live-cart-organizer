import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmtMoney(v: number | null | undefined) {
  const n = Number(v || 0);
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}
function normalizePhoneBR(raw: string) {
  let p = String(raw || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = p.slice(1);
  if (!p.startsWith("55")) p = "55" + p;
  if (p.length === 12) p = p.slice(0, 4) + "9" + p.slice(4);
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { sale_id } = await req.json();
    if (!sale_id) return new Response(JSON.stringify({ error: "sale_id required" }), { status: 400, headers: corsHeaders });

    // Carrega venda + relacionados
    const { data: sale, error: saleErr } = await supabase
      .from("pos_sales")
      .select("id, store_id, seller_id, customer_id, total, customer_name, customer_phone, created_at")
      .eq("id", sale_id)
      .maybeSingle();
    if (saleErr || !sale) return new Response(JSON.stringify({ error: "sale not found" }), { status: 404, headers: corsHeaders });

    const [{ data: customer }, { data: seller }, { data: store }] = await Promise.all([
      sale.customer_id
        ? supabase.from("pos_customers").select("name, whatsapp").eq("id", sale.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sale.seller_id
        ? supabase.from("pos_sellers").select("name").eq("id", sale.seller_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sale.store_id
        ? supabase.from("pos_stores").select("name").eq("id", sale.store_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const rawPhone = customer?.whatsapp || sale.customer_phone || "";
    if (!rawPhone) return new Response(JSON.stringify({ ok: true, message: "no phone" }), { headers: corsHeaders });
    const phone = normalizePhoneBR(rawPhone);
    const phoneSuffix = phone.replace(/\D/g, "").slice(-8);

    const customerName = customer?.name || sale.customer_name || "Cliente";
    const firstName = customerName.split(" ")[0] || "Cliente";
    const sellerName = seller?.name || "nossa equipe";
    const storeName = store?.name || "";

    // Cashback mais recente desse cliente (criado nas últimas 24h ~ vinculado à venda)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: cb } = await supabase
      .from("internal_cashback")
      .select("coupon_code, cashback_amount, min_purchase, expires_at")
      .ilike("customer_phone", `%${phoneSuffix}`)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const vars: Record<string, string> = {
      "{{nome_cliente}}": customerName,
      "{{primeiro_nome}}": firstName,
      "{{nome}}": firstName,
      "{{nome_vendedora}}": sellerName,
      "{{loja}}": storeName,
      "{{valor_compra}}": fmtMoney(sale.total),
      "{{valor_cashback}}": cb ? fmtMoney(cb.cashback_amount) : "",
      "{{codigo_cashback}}": cb?.coupon_code || "",
      "{{cupom}}": cb?.coupon_code || "",
      "{{compra_minima}}": cb ? fmtMoney(cb.min_purchase) : "",
      "{{validade_cashback}}": cb?.expires_at ? new Date(cb.expires_at).toLocaleDateString("pt-BR") : "",
      "{{telefone}}": phone,
      "__first_name__": firstName,
      "__full_name__": customerName,
    };

    function replaceVars(text: string): string {
      if (!text) return text;
      let out = text;
      for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
      return out;
    }

    // Busca flows ativos
    const { data: flows } = await supabase
      .from("automation_flows")
      .select("id, name, trigger_config, steps:automation_steps(*)")
      .eq("trigger_type", "pos_sale_completed")
      .eq("is_active", true);

    if (!flows || flows.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "no active flows" }), { headers: corsHeaders });
    }

    const results: any[] = [];

    for (const flow of flows) {
      // Filtros opcionais (loja, vendedora, ticket mínimo)
      const cfg = (flow.trigger_config || {}) as any;
      if (cfg.store_id && cfg.store_id !== sale.store_id) continue;
      if (cfg.seller_id && cfg.seller_id !== sale.seller_id) continue;
      if (cfg.min_total && Number(sale.total) < Number(cfg.min_total)) continue;

      // Cancela follow-ups pendentes anteriores deste cliente para este flow (recompra reinicia)
      await supabase
        .from("automation_pos_followups")
        .update({ cancelled_at: new Date().toISOString(), cancel_reason: "new_purchase_restart" })
        .eq("flow_id", flow.id)
        .eq("customer_phone_suffix", phoneSuffix)
        .is("sent_at", null)
        .is("cancelled_at", null);

      const steps = (flow.steps || []).sort((a: any, b: any) => a.step_order - b.step_order);

      let cumulativeDelay = 0; // segundos
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const sCfg = (step.action_config || {}) as any;
        cumulativeDelay += Number(step.delay_seconds || 0);

        if (step.action_type === "delay") {
          cumulativeDelay += Number(sCfg.seconds || sCfg.duration || 0);
          continue;
        }

        if (cumulativeDelay <= 5) {
          // Executa imediatamente
          await executeStep(supabase, step, phone, replaceVars, flow.id);
        } else {
          const scheduledAt = new Date(Date.now() + cumulativeDelay * 1000).toISOString();
          await supabase.from("automation_pos_followups").insert({
            sale_id: sale.id,
            flow_id: flow.id,
            step_id: step.id,
            step_index: i,
            customer_phone: phone,
            scheduled_at: scheduledAt,
            payload: { vars, action_type: step.action_type, action_config: sCfg },
          });
        }
      }
      results.push({ flow_id: flow.id, flow_name: flow.name });
    }

    return new Response(JSON.stringify({ ok: true, flows_executed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("automation-trigger-pos-sale error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

async function executeStep(supabase: any, step: any, phone: string, replaceVars: (s: string) => string, flowId: string) {
  const cfg = step.action_config || {};
  if (step.action_type === "send_template") {
    const templateName = cfg.templateName || cfg.template_name;
    const whatsappNumberId = cfg.whatsappNumberId || cfg.whatsapp_number_id;
    const language = cfg.language || "pt_BR";
    let components = cfg.components || [];
    if (components.length === 0 && cfg.templateVars) {
      const vars = cfg.templateVars as Record<string, string>;
      const sortedKeys = Object.keys(vars).sort((a, b) => Number(a) - Number(b));
      const parameters = sortedKeys.map((k) => ({ type: "text", text: replaceVars(vars[k]) || "" }));
      if (parameters.length > 0) components = [{ type: "body", parameters }];
    } else if (components.length > 0) {
      components = JSON.parse(replaceVars(JSON.stringify(components)));
    }
    const payload: any = { phone, templateName, language, whatsappNumberId };
    if (components.length > 0) payload.components = components;
    const { error } = await supabase.functions.invoke("meta-whatsapp-send-template", { body: payload });
    await supabase.from("automation_executions").insert({
      flow_id: flowId, step_id: step.id, status: error ? "failed" : "sent",
      result: { trigger: "pos_sale_completed", phone, template: templateName, error: error?.message },
    });
  } else if (step.action_type === "send_text") {
    const message = replaceVars(cfg.message || "");
    if (!message) return;
    await supabase.functions.invoke("meta-whatsapp-send", {
      body: { phone, message, whatsappNumberId: cfg.whatsappNumberId },
    });
    await supabase.from("automation_executions").insert({
      flow_id: flowId, step_id: step.id, status: "sent",
      result: { trigger: "pos_sale_completed", phone, message: message.slice(0, 80) },
    });
  } else if (step.action_type === "add_tag") {
    // log apenas
    await supabase.from("automation_executions").insert({
      flow_id: flowId, step_id: step.id, status: "sent",
      result: { trigger: "pos_sale_completed", phone, tag: cfg.tags },
    });
  }
}
