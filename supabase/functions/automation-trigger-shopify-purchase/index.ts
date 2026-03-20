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

    const body = await req.json();
    const {
      phone, name, email,
      products, orderTotal, shopifyOrderId, shopifyOrderName, rastreio, transportadora
    } = body;

    if (!phone) return new Response(JSON.stringify({ error: "phone required" }), { status: 400, headers: corsHeaders });

    // Formata telefone
    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) formattedPhone = formattedPhone.slice(1);
    if (!formattedPhone.startsWith("55")) formattedPhone = "55" + formattedPhone;
    if (formattedPhone.length === 12) formattedPhone = formattedPhone.slice(0, 4) + "9" + formattedPhone.slice(4);

    // Busca flows ativos com trigger shopify_purchase
    const { data: flows } = await supabase
      .from("automation_flows")
      .select("id, name, steps:automation_steps(*)")
      .eq("trigger_type", "shopify_purchase")
      .eq("is_active", true);

    if (!flows || flows.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "no active flows" }), { headers: corsHeaders });
    }

    const firstName = name?.split(" ")[0] || "Cliente";
    const results = [];

    for (const flow of flows) {
      const steps = (flow.steps || []).sort((a: any, b: any) => a.step_order - b.step_order);
      console.log("Processing flow:", flow.id, "steps:", steps.length);

      for (const step of steps) {
        console.log("Step config:", JSON.stringify(step));
        // Substitui variáveis
        const replaceVars = (text: string) => text
          ?.replace(/__first_name__/g, firstName)
          ?.replace(/__full_name__/g, name || "Cliente")
          ?.replace(/__phone__/g, phone)
          ?.replace(/{{nome}}/g, firstName)
          ?.replace(/{{telefone}}/g, phone)
          ?.replace(/{{email}}/g, email || "")
          ?.replace(/{{produtos}}/g, products || "")
          ?.replace(/{{total}}/g, orderTotal ? `R$ ${parseFloat(orderTotal).toFixed(2).replace(".", ",")}` : "")
          ?.replace(/{{pedido}}/g, shopifyOrderName || shopifyOrderId || "")
          ?.replace(/{{numero_pedido}}/g, shopifyOrderName || shopifyOrderId || "")
          ?.replace(/{{codigo_rastreio}}/g, rastreio || "")
          ?.replace(/{{transportadora}}/g, transportadora || "");

        if (step.action_type === "send_template") {
          const config = step.action_config || {};
          const templateName = config.templateName || config.template_name;
          const whatsappNumberId = config.whatsappNumberId || config.whatsapp_number_id;
          const language = config.language || "pt_BR";

          // Monta components: prioriza config.components, senão gera a partir de templateVars
          let components = config.components || [];
          if (components.length === 0 && config.templateVars) {
            const vars = config.templateVars;
            const sortedKeys = Object.keys(vars).sort((a, b) => Number(a) - Number(b));
            const parameters = sortedKeys.map((key) => ({
              type: "text",
              text: replaceVars(vars[key]) || "",
            }));
            if (parameters.length > 0) {
              components = [{ type: "body", parameters }];
            }
          } else {
            components = JSON.parse(replaceVars(JSON.stringify(components)));
          }

          const payload: any = { phone: formattedPhone, templateName, language, whatsappNumberId };
          if (components.length > 0) payload.components = components;

          console.log("Sending template:", JSON.stringify({ templateName, whatsappNumberId, language, phone: formattedPhone, components }));
          const { error: sendErr } = await supabase.functions.invoke("meta-whatsapp-send-template", {
            body: payload,
          });
          console.log("Template send result:", JSON.stringify({ sendErr, success: !sendErr }));

          await supabase.from("automation_executions").insert({
            flow_id: flow.id,
            status: sendErr ? "failed" : "sent",
            result: {
              trigger: "shopify_purchase",
              step_id: step.id,
              phone: formattedPhone,
              template: templateName,
              shopify_order_id: shopifyOrderId,
              error: sendErr?.message,
            },
          });

          if (sendErr) console.error("Template send error:", sendErr);

        } else if (step.action_type === "send_text") {
          const config = step.action_config || {};
          const message = replaceVars(config.message || "");
          if (message) {
            await supabase.functions.invoke("meta-whatsapp-send", {
              body: { phone: formattedPhone, message, whatsappNumberId: config.whatsappNumberId },
            });
          }

        } else if (step.action_type === "delay") {
          console.log(`delay step — stopping (async not implemented)`);
          break;

        } else if (step.action_type === "wait_for_reply") {
          const config = step.action_config || {};
          await supabase.from("automation_pending_replies").insert({
            phone: formattedPhone,
            flow_id: flow.id,
            step_id: step.id,
            button_branches: config.branches || {},
            whatsapp_number_id: config.whatsappNumberId || null,
            recipient_data: { name: name || "", firstName, shopify_order_id: shopifyOrderId },
          });
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      results.push({ flow_id: flow.id, flow_name: flow.name, steps_executed: steps.length });
    }

    return new Response(JSON.stringify({ ok: true, flows_executed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("automation-trigger-shopify-purchase error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
