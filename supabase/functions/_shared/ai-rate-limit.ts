// Fase 4: limite simples de uso das funções de IA (por IP, janela de 10 min), usando o access_log.
import { createClient } from "npm:@supabase/supabase-js@2";
export async function aiRateLimit(req: Request, fn: string, max = 40): Promise<Response | null> {
  try {
    const auth = req.headers.get("authorization") || "";
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (svc && auth === `Bearer ${svc}`) return null; // chamadas internas não contam
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    if (!ip) return null;
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, svc);
    const { count } = await sb.from("access_log").select("id", { count: "exact", head: true })
      .eq("function_name", fn).eq("ip", ip).gte("created_at", new Date(Date.now() - 600_000).toISOString());
    if ((count || 0) > max) {
      return new Response(JSON.stringify({ error: "Muitas solicitações à IA. Aguarde alguns minutos." }), {
        status: 429, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
  } catch (_) { /* nunca bloquear por falha do contador */ }
  return null;
}
