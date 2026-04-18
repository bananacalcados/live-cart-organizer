// Cron de fallback: varre pedidos awaiting_payment com mercadopago_payment_id
// e consulta o status diretamente na API do MercadoPago.
// Roda a cada 2 minutos via pg_cron. Atualiza pedidos confirmados sem depender do webhook.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!accessToken) {
    return new Response(JSON.stringify({ error: "MERCADOPAGO_ACCESS_TOKEN missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Janela: pedidos criados nas últimas 24h, ainda não pagos, com ID MP salvo
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [ordersRes, salesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, mercadopago_payment_id, store_id, is_paid")
      .not("mercadopago_payment_id", "is", null)
      .eq("is_paid", false)
      .gte("created_at", since)
      .limit(50),
    supabase
      .from("pos_sales")
      .select("id, mercadopago_payment_id, status")
      .not("mercadopago_payment_id", "is", null)
      .in("status", ["online_pending", "awaiting_payment", "pending"])
      .gte("created_at", since)
      .limit(50),
  ]);

  const orders = ordersRes.data || [];
  const sales = salesRes.data || [];

  let confirmed = 0;
  let checked = 0;
  const errors: any[] = [];

  const checkOne = async (mpId: string): Promise<string | null> => {
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.status || null;
    } catch { return null; }
  };

  // CRM orders
  for (const o of orders) {
    checked++;
    const status = await checkOne(o.mercadopago_payment_id);
    if (status === "approved") {
      // Trigger the webhook handler so notification + Shopify follow same flow
      try {
        await fetch(`${supabaseUrl}/functions/v1/payment-webhook?gateway=mercadopago`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ type: "payment", data: { id: o.mercadopago_payment_id } }),
        });
        confirmed++;
        console.log(`[poll] order ${o.id} confirmed via polling (mp=${o.mercadopago_payment_id})`);
      } catch (err: any) {
        errors.push({ id: o.id, err: err.message });
      }
    }
  }

  // POS sales
  for (const s of sales) {
    checked++;
    const status = await checkOne(s.mercadopago_payment_id);
    if (status === "approved") {
      try {
        await fetch(`${supabaseUrl}/functions/v1/payment-webhook?gateway=mercadopago`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ type: "payment", data: { id: s.mercadopago_payment_id } }),
        });
        confirmed++;
        console.log(`[poll] sale ${s.id} confirmed via polling (mp=${s.mercadopago_payment_id})`);
      } catch (err: any) {
        errors.push({ id: s.id, err: err.message });
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, checked, confirmed, errors: errors.slice(0, 5) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
