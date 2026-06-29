// Cron de fallback: varre pedidos awaiting_payment e consulta o status na API do MP.
// Suporta multi-conta: itera por todas as contas cadastradas tentando localizar o pagamento.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listAllMpAccountsForPolling } from "../_shared/mp-account.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const accounts = await listAllMpAccountsForPolling(supabase);
  if (accounts.length === 0) {
    return new Response(JSON.stringify({ error: "no MP accounts available" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Janela: pedidos criados nas últimas 24h, ainda não pagos, com ID MP salvo
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [ordersRes, salesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, mercadopago_payment_id, mp_account_id, is_paid")
      .not("mercadopago_payment_id", "is", null)
      .eq("is_paid", false)
      .gte("created_at", since)
      .limit(50),
    supabase
      .from("pos_sales")
      .select("id, mercadopago_payment_id, mp_account_id, status")
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

  // Tenta resolver status testando contas: começa pela conta vinculada (se houver), depois as demais
  const checkOne = async (mpId: string, preferredAccountId?: string | null): Promise<string | null> => {
    const ordered = [...accounts].sort((a, b) => {
      if (preferredAccountId && a.account_id === preferredAccountId) return -1;
      if (preferredAccountId && b.account_id === preferredAccountId) return 1;
      return 0;
    });

    for (const acc of ordered) {
      try {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, {
          headers: { Authorization: `Bearer ${acc.access_token}` },
        });
        if (r.ok) {
          const j = await r.json();
          return j.status || null;
        }
        // 401/404 — tenta a próxima conta
      } catch {
        // continua
      }
    }
    return null;
  };

  // CRM orders
  for (const o of orders) {
    checked++;
    const status = await checkOne(o.mercadopago_payment_id, o.mp_account_id);
    if (status === "approved") {
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
    const status = await checkOne(s.mercadopago_payment_id, s.mp_account_id);
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
    JSON.stringify({ ok: true, accounts: accounts.length, checked, confirmed, errors: errors.slice(0, 5) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
