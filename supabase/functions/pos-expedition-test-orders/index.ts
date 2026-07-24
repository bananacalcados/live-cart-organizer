import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const TEST_TAG = "[TESTE-EXPEDICAO]";

const scenarios = [
  {
    key: "live",
    label: "Live Shopping",
    sale_type: "live",
    payment_method: "PIX (R$ 189.90)",
    payment_gateway: "mercadopago",
    total: 189.9,
    avulso: false,
    details: { link_origin: "live", channel: "live" },
  },
  {
    key: "whatsapp",
    label: "WhatsApp (link do chat)",
    sale_type: "online",
    payment_method: "Crédito 3x (R$ 249.90)",
    payment_gateway: "appmax",
    total: 249.9,
    avulso: false,
    details: { link_origin: "whatsapp_chat", installments: 3 },
  },
  {
    key: "online",
    label: "Link de pagamento (Online)",
    sale_type: "online",
    payment_method: "PIX (R$ 159.90)",
    payment_gateway: "pagarme",
    total: 159.9,
    avulso: false,
    details: { link_origin: "online_hub" },
  },
  {
    key: "pix_avulso",
    label: "PIX avulso (WhatsApp)",
    sale_type: "online",
    payment_method: "PIX (R$ 120.00)",
    payment_gateway: "mercadopago",
    total: 120,
    avulso: true,
    details: { link_origin: "whatsapp_chat", is_avulso: true, is_custom_amount: true },
  },
  {
    key: "link_avulso",
    label: "Link avulso personalizado",
    sale_type: "online",
    payment_method: "Crédito 2x (R$ 300.00)",
    payment_gateway: "vindi",
    total: 300,
    avulso: true,
    details: { link_origin: "custom_link", is_avulso: true, is_custom_amount: true, installments: 2 },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    if (action === "purge") {
      const { data: sales } = await supabase
        .from("pos_sales")
        .select("id")
        .eq("payment_details->>is_test", "true");
      const ids = (sales || []).map((s: any) => s.id);
      if (!ids.length) return json({ ok: true, deleted: 0 });

      await supabase.from("pos_expedition_checks").delete().in("sale_id", ids);
      await supabase.from("cash_flow_entries").delete().in("pos_sale_id", ids);
      await supabase.from("meta_capi_offline_log").delete().in("sale_id", ids);
      await supabase.from("pos_stock_adjustments").delete().in("sale_id", ids);
      await supabase.from("automation_pos_followups").delete().in("sale_id", ids);
      await supabase.from("pos_sale_items").delete().in("sale_id", ids);
      const { error } = await supabase.from("pos_sales").delete().in("id", ids);
      if (error) throw error;
      return json({ ok: true, deleted: ids.length });
    }

    if (action !== "create") return json({ error: "invalid action" }, 400);

    const storeId = body?.store_id as string;
    if (!storeId) return json({ error: "store_id required" }, 400);

    const created: any[] = [];
    let i = 0;
    for (const sc of scenarios) {
      i++;
      const phone = `5533000000${String(i).padStart(3, "0")}`;
      const payload: any = {
        store_id: storeId,
        sale_type: sc.sale_type,
        status: "pending",
        subtotal: sc.total,
        discount: 0,
        total: sc.total,
        payment_method: sc.payment_method,
        payment_gateway: sc.payment_gateway,
        payment_details: { ...sc.details, is_test: true, test_scenario: sc.key },
        notes: `${TEST_TAG} ${sc.label}`,
        customer_name: `TESTE ${sc.label}`,
        customer_phone: phone,
        customer_email: `teste${i}@teste.local`,
        expedition_stage: "novo",
      };

      const { data: sale, error } = await supabase
        .from("pos_sales")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;

      if (!sc.avulso) {
        const items = [
          {
            sale_id: sale.id,
            product_name: `PRODUTO TESTE ${sc.label}`,
            variant_name: "PRETO",
            size: "36",
            sku: `TESTE-SKU-${sc.key}`,
            barcode: `TESTE-${sc.key}-${Date.now()}`,
            quantity: 1,
            unit_price: sc.total,
            total_price: sc.total,
          },
        ];
        const { error: itErr } = await supabase.from("pos_sale_items").insert(items);
        if (itErr) throw itErr;
      }

      created.push({ id: sale.id, scenario: sc.key, label: sc.label });
    }

    return json({ ok: true, created });
  } catch (e) {
    console.error("[pos-expedition-test-orders]", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
