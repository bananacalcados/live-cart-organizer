import { createClient } from "npm:@supabase/supabase-js@2";
import { appmaxGetPayment } from "../_shared/refund-gateways/appmax.ts";
// TEMPORÁRIO: diagnóstico de campos de data/valor da Appmax. Remover após uso.
Deno.serve(async (req) => {
  const { order_id } = await req.json();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: o } = await sb.from("orders").select("appmax_order_id").eq("id", order_id).maybeSingle();
  const r: any = await appmaxGetPayment(sb, String(o?.appmax_order_id), null);
  if (r.kind !== "ok") return Response.json({ kind: r.kind });
  const raw = r.payment.raw || {};
  const pick = (x: any) => Object.fromEntries(Object.entries(x || {}).filter(([k, v]) => /date|_at|paid|total|status|amount/i.test(k) && (typeof v !== "object" || v === null)));
  return Response.json({ status: r.payment.status, amount: r.payment.amount, dateApproved: r.payment.dateApproved, keys: Object.keys(raw), fields: pick(raw), payment: pick(raw.payment || raw.payments?.[0]) });
});
