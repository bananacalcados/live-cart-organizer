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

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendCapiLead(args: {
  phone11: string;
  eventId: string | null;
  eventSourceUrl: string | null;
  clientIp: string | null;
  clientUa: string | null;
  fbc: string | null;
  fbp: string | null;
}) {
  const PIXEL_ID = Deno.env.get("VITE_META_PIXEL_ID");
  const TOKEN =
    Deno.env.get("META_CAPI_TOKEN") ??
    Deno.env.get("META_CAPI_ACCESS_TOKEN") ??
    Deno.env.get("META_PAGE_ACCESS_TOKEN");
  if (!PIXEL_ID || !TOKEN) {
    console.warn("[lp-capture-lead] capi skipped: missing pixel id or token");
    return;
  }

  const user_data: Record<string, unknown> = {
    ph: [await sha256Hex("55" + args.phone11)],
  };
  if (args.clientIp) user_data.client_ip_address = args.clientIp;
  if (args.clientUa) user_data.client_user_agent = args.clientUa;
  if (args.fbc) user_data.fbc = args.fbc;
  if (args.fbp) user_data.fbp = args.fbp;

  const payload: Record<string, unknown> = {
    data: [{
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      ...(args.eventId ? { event_id: args.eventId } : {}),
      action_source: "website",
      event_source_url: args.eventSourceUrl || "https://checkout.bananacalcados.com.br/lp/conforto",
      user_data,
    }],
  };
  const testCode = Deno.env.get("META_CAPI_TEST_EVENT_CODE");
  if (testCode) payload.test_event_code = testCode;

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
  );
  const out = await res.text();
  if (!res.ok) console.error("[lp-capture-lead] capi failed:", res.status, out);
  else console.log("[lp-capture-lead] capi ok:", out);
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
      event_id,
    } = body || {};

    const name = String(nome ?? "").trim().slice(0, 120);
    if (name.length < 3) return json({ success: false, error: "nome inválido" }, 400);

    const phone11 = normalizePhoneBR(String(telefone_raw ?? ""));
    if (!phone11) return json({ success: false, error: "telefone inválido" }, 400);

    const eventId = typeof event_id === "string" && event_id.trim() ? event_id.trim().slice(0, 100) : null;

    // IP REAL do usuário (Cloudflare primeiro, depois x-forwarded-for)
    const clientIp =
      req.headers.get("cf-connecting-ip") ||
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      null;
    const clientUa =
      (typeof user_agent === "string" && user_agent.trim() ? user_agent : req.headers.get("user-agent")) || null;

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
      event_id: eventId,
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

    // CAPI (best-effort: nunca falha o lead)
    try {
      await sendCapiLead({
        phone11,
        eventId,
        eventSourceUrl: str(event_source_url),
        clientIp,
        clientUa,
        fbc: str(fbc),
        fbp: str(fbp),
      });
    } catch (e) {
      console.error("[lp-capture-lead] capi error:", e);
    }

    return json({ success: true, event_id: eventId });
  } catch (e) {
    console.error("[lp-capture-lead]", e);
    return json({ success: false, error: String(e) }, 500);
  }
});
