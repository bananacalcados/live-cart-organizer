import { createClient } from "npm:@supabase/supabase-js@2";
import { grantSelfserviceCashback } from "../_shared/selfservice-cashback.ts";
Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: evs } = await sb.from("events").select("id").eq("operation_mode", "whatsapp_autoatendimento");
  const { data: orders } = await sb.from("orders").select("id").in("event_id", (evs || []).map((e: any) => e.id)).not("appmax_order_id", "is", null).eq("is_paid", true).gte("created_at", "2026-10-24").limit(100);
  const out: any[] = [];
  for (const o of orders || []) {
    try { const r = await grantSelfserviceCashback(sb, o.id); out.push({ id: o.id, ok: true, amount: r?.cashback_amount }); }
    catch (e) { out.push({ id: o.id, ok: false, error: String((e as Error).message || e) }); }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
