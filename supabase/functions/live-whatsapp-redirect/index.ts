// Redirecionador da Live → WhatsApp com atribuição Meta.
// A página /zap/:slug captura fbc/fbp/UTMs no navegador da cliente e chama esta
// função, que registra o clique com um CÓDIGO CURTO único e devolve o link
// wa.me com a frase pré-preenchida + código. Quando a mensagem chega no WhatsApp,
// o trigger `live_zap_match_incoming` casa o código com o telefone.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildFbc } from "../_shared/meta-attribution-memory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sem 0/O/1/I para evitar confusão visual
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

const clean = (v: string | null, max = 300) => {
  const s = (v || "").trim();
  return s ? s.slice(0, max) : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const slug = (url.searchParams.get("slug") || "").trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]{1,60}$/.test(slug)) return json({ error: "slug inválido" }, 400);

    const fbclid = clean(url.searchParams.get("fbclid"));
    const fbc = clean(url.searchParams.get("fbc")) || buildFbc(fbclid);
    const fbp = clean(url.searchParams.get("fbp"));

    const { data: link } = await supabase
      .from("live_whatsapp_links")
      .select("id, event_id, whatsapp_number_id, target_phone, message_text, is_active, click_count")
      .eq("slug", slug)
      .maybeSingle();

    if (!link) return json({ error: "not_found" }, 404);
    if (!link.is_active) return json({ error: "paused" }, 200);

    const targetPhone = String(link.target_phone || "").replace(/\D/g, "");
    if (!targetPhone) return json({ error: "link sem telefone de destino" }, 500);

    // Gera código único (retry em colisão)
    let code = genCode();
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const { error } = await supabase.from("live_whatsapp_clicks").insert({
        link_id: link.id,
        event_id: link.event_id ?? null,
        code,
        fbc,
        fbp,
        fbclid,
        utm_source: clean(url.searchParams.get("utm_source")),
        utm_medium: clean(url.searchParams.get("utm_medium")),
        utm_campaign: clean(url.searchParams.get("utm_campaign")),
        utm_content: clean(url.searchParams.get("utm_content")),
        utm_term: clean(url.searchParams.get("utm_term")),
        user_agent: clean(req.headers.get("user-agent"), 500),
        ip: clean(req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip"), 80),
        referer: clean(url.searchParams.get("ref") || req.headers.get("referer"), 500),
      });
      if (!error) inserted = true;
      else if ((error as any).code === "23505") code = genCode();
      else {
        console.error("[live-whatsapp-redirect] insert error:", error);
        break;
      }
    }

    supabase
      .from("live_whatsapp_links")
      .update({ click_count: (link.click_count || 0) + 1 })
      .eq("id", link.id)
      .then(() => {});

    const baseText = (link.message_text || "Oii, vim da Live, pode me ajudar?").trim();
    const text = inserted ? `${baseText} #${code}` : baseText;
    const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(text)}`;

    return json({ wa_url: waUrl, text, code: inserted ? code : null, target_phone: targetPhone });
  } catch (err) {
    console.error("[live-whatsapp-redirect] error:", err);
    return json({ error: String((err as Error).message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
