// Redirecionador da Live → WhatsApp com atribuição Meta (2 passos).
//
// GET  ?slug=...&fbc=...        → registra o clique (fbc/fbp/UTMs/IP/UA) e devolve
//                                 { click_id, message_text } — SEM link wa.me ainda.
// POST { click_id, phone }      → valida o WhatsApp digitado pela cliente, grava
//                                 entered_phone/entered_phone_key no clique, gera o
//                                 CÓDIGO CURTO único e devolve { wa_url, code }.
//
// Quando a mensagem chega no WhatsApp, o trigger `live_zap_match_incoming` casa o
// clique pelo telefone digitado (chave DDD+8) e/ou pelo código.
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

// DDDs brasileiros válidos
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Normaliza para E.164 BR (55 + DDD + 9 + 8 dígitos). Retorna null se inválido. */
export function normalizeEnteredPhone(raw: string): { e164: string; key: string } | null {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2); // injeta 9º dígito
  if (d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (!VALID_DDD.has(ddd)) return null;
  if (d[2] !== "9") return null; // celular BR
  if (/^(\d)\1{7}$/.test(d.slice(3))) return null; // 99999999 etc.
  return { e164: "55" + d, key: d.slice(0, 2) + d.slice(-8) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ─────────────────────────── PASSO 2: confirmar telefone ───────────────────────────
    if (req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "body inválido" }, 400);
      }
      const clickId = String(body?.click_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(clickId)) return json({ error: "click_id inválido" }, 400);
      const norm = normalizeEnteredPhone(String(body?.phone || ""));
      if (!norm) return json({ error: "invalid_phone" }, 400);

      const { data: click } = await supabase
        .from("live_whatsapp_clicks")
        .select("id, link_id, code, entered_phone")
        .eq("id", clickId)
        .maybeSingle();
      if (!click) return json({ error: "not_found" }, 404);

      const { data: link } = await supabase
        .from("live_whatsapp_links")
        .select("id, target_phone, message_text, is_active")
        .eq("id", click.link_id)
        .maybeSingle();
      if (!link) return json({ error: "not_found" }, 404);
      if (!link.is_active) return json({ error: "paused" }, 200);

      const targetPhone = String(link.target_phone || "").replace(/\D/g, "");
      if (!targetPhone) return json({ error: "link sem telefone de destino" }, 500);

      // Cada confirmação gera um código novo ligado ao telefone digitado.
      // Se a cliente confirmar de novo com OUTRO número no mesmo clique, o código muda também.
      let code = click.code && click.entered_phone === norm.e164 ? click.code : genCode();
      let saved = false;
      for (let attempt = 0; attempt < 5 && !saved; attempt++) {
        const { error } = await supabase
          .from("live_whatsapp_clicks")
          .update({
            code,
            entered_phone: norm.e164,
            entered_phone_key: norm.key,
            confirmed_at: new Date().toISOString(),
          })
          .eq("id", click.id);
        if (!error) saved = true;
        else if ((error as any).code === "23505") code = genCode();
        else {
          console.error("[live-whatsapp-redirect] confirm update error:", error);
          break;
        }
      }

      // Etapa 3: quem confirmou o telefone vira lead da Live (mesmo sem mandar mensagem)
      if (saved) {
        supabase
          .rpc("live_zap_upsert_lead", { p_click_id: click.id })
          .then(({ error }: { error: unknown }) => {
            if (error) console.error("[live-whatsapp-redirect] upsert lead error:", error);
          });
      }

      const baseText = (link.message_text || "Oii, vim da Live, pode me ajudar?").trim();
      const text = saved ? `${baseText} #${code}` : baseText;
      const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(text)}`;
      return json({ wa_url: waUrl, text, code: saved ? code : null, target_phone: targetPhone, phone: norm.e164 });
    }

    // ─────────────────────────── PASSO 1: registrar o clique ───────────────────────────
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

    const { data: inserted, error: insErr } = await supabase
      .from("live_whatsapp_clicks")
      .insert({
        link_id: link.id,
        event_id: link.event_id ?? null,
        code: null,
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
      })
      .select("id")
      .single();
    if (insErr) console.error("[live-whatsapp-redirect] insert error:", insErr);

    supabase
      .from("live_whatsapp_links")
      .update({ click_count: (link.click_count || 0) + 1 })
      .eq("id", link.id)
      .then(() => {});

    return json({
      click_id: inserted?.id ?? null,
      message_text: (link.message_text || "Oii, vim da Live, pode me ajudar?").trim(),
    });
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
