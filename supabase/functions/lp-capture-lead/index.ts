// Captação de lead das Landing Pages públicas (ex.: /lp/conforto).
// Grava no MESMO log de captação que alimenta o Leads Dashboard (lp_leads),
// sem deduplicar (re-cadastros são preservados para análise de jornada).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Retorna DDD + 9 dígitos (11 dígitos) ou null. */
function normalizePhoneBR(raw: string): string | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);
  return d.length === 11 ? d : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      nome,
      telefone_raw,
      fbc,
      fbp,
      fbclid,
      utms,
      canal_captacao,
      event_source_url,
      user_agent,
      campaign_tag,
    } = body || {};

    const name = String(nome ?? "").trim().slice(0, 120);
    if (name.length < 3) return json({ success: false, error: "nome inválido" }, 400);

    const phone11 = normalizePhoneBR(String(telefone_raw ?? ""));
    if (!phone11) return json({ success: false, error: "telefone inválido" }, 400);

    const u = (utms && typeof utms === "object" && !Array.isArray(utms)) ? utms : {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase.from("lp_leads").insert({
      name,
      phone: phone11,
      source: "landing_page",
      campaign_tag: str(campaign_tag) || "lp-conforto",
      canal_captacao: str(canal_captacao) || "LP",
      fbc: str(fbc),
      fbp: str(fbp),
      fbclid: str(fbclid),
      utm_source: str(u.utm_source),
      utm_medium: str(u.utm_medium),
      utm_campaign: str(u.utm_campaign),
      utm_content: str(u.utm_content),
      utm_term: str(u.utm_term),
      metadata: {
        event_source_url: str(event_source_url),
        user_agent: typeof user_agent === "string" ? user_agent.slice(0, 400) : null,
        campaign_name: str((u as any)["campaign.name"]),
        adset_id: str((u as any)["adset.id"]),
      },
    } as any);

    if (error) {
      console.error("[lp-capture-lead] insert error:", error);
      return json({ success: false, error: error.message }, 500);
    }

    return json({ success: true });
  } catch (e) {
    console.error("[lp-capture-lead]", e);
    return json({ success: false, error: String(e) }, 500);
  }
});
