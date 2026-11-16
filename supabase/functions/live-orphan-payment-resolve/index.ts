import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAccessLog, verifiedIdentity } from "../_shared/withAccessLog.ts";
import { requireAuth } from "../_shared/requireAuth.ts";
import { resolveOrphanPaymentForStaff } from "../_shared/orphan-payment.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(withAccessLog("live-orphan-payment-resolve", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const denied = await requireAuth(req, ["events"]);
  if (denied) return denied;
  try {
    const body = await req.json();
    const orphanId = String(body?.orphanId || "");
    const orderId = String(body?.orderId || "");
    const uuid = /^[0-9a-f-]{36}$/i;
    if (!uuid.test(orphanId) || !uuid.test(orderId)) return json({ error: "Pagamento ou pedido inválido" }, 400);
    const identity = await verifiedIdentity(req);
    if (!identity) return json({ error: "Unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await resolveOrphanPaymentForStaff(supabase, supabaseUrl, supabaseKey, orphanId, orderId, identity.userId);
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Não foi possível vincular" }, 400);
  }
}));
