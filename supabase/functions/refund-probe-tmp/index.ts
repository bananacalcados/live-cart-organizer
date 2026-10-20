// TEMPORÁRIA — só leitura, IDs fixos, removida após o teste da Fase E1.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appmaxGetPayment, appmaxCheckPayment } from "../_shared/refund-gateways/appmax.ts";
import { checkPayment } from "../_shared/refund-gateways/mercadopago.ts";
import { loadMpSalePayments } from "../_shared/mp-sale-payment.ts";

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: any = {};
  const { data: sale } = await sb.from("pos_sales").select("id, mercadopago_payment_id, mp_account_id, total, appmax_order_id").eq("id", "44b2e457-ed24-4690-8481-c639d995c497").maybeSingle();
  const pay = (await loadMpSalePayments(sb, [sale])).get(sale.id);
  const mp = await checkPayment(sb, { id: sale.id, paymentId: pay?.paymentId ?? null, mpAccountId: pay?.accountId ?? null, paymentOrderId: pay?.orderId, total: Number(sale.total), label: "", channel: "pdv", customerName: null, isPaid: true, stageOrStatus: null, shipped: false, createdAt: null } as any, null);
  out.a = { mpStatus: mp.payment?.status, ok: mp.ok, remaining: mp.remaining, appmax: sale.appmax_order_id };
  for (const [k, id, total] of [["b", "130294358", 0], ["c", "126124420", 0], ["d", "129888321", 0]] as any) {
    const raw = await appmaxGetPayment(sb, id, null);
    const c = await appmaxCheckPayment(sb, id, total || (raw as any).payment?.amount || 0, null);
    out[k] = { kind: raw.kind, status: (raw as any).payment?.status, amount: (raw as any).payment?.amount, method: (raw as any).payment?.method, rawo: (raw as any).payment?.raw, check: { ok: c.ok, error: c.error, remaining: c.remaining } };
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
