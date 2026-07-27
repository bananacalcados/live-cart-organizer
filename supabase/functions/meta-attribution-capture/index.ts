// Etapa 3 — captura pública dos sinais de clique da Meta.
//
// Usada por páginas de captação que gravam o lead direto do navegador
// (catálogo, LPs simples). Guarda fbclid/_fbp/_fbc por telefone na memória
// de atribuição (90 dias) para que a conversão futura — link da live, PDV ou
// loja física — ainda consiga enviar o `fbc` para a Meta.
//
// Só escreve na tabela de atribuição. Não lê nem devolve dado de cliente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { saveMetaAttribution, buildFbc } from "../_shared/meta-attribution-memory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { phone, fbclid, fbp, fbc, source_url, origin, lead_id } = body || {};

    if (!phone || String(phone).replace(/\D/g, "").length < 10) {
      return json({ error: "phone inválido" }, 400);
    }

    const fbcResolved = (typeof fbc === "string" && fbc) || buildFbc(fbclid);
    if (!fbcResolved && !fbp) return json({ ok: true, saved: false, reason: "sem sinais" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const saved = await saveMetaAttribution(supabase, {
      phone: String(phone),
      fbc: fbcResolved,
      fbp: typeof fbp === "string" ? fbp : null,
      fbclid: typeof fbclid === "string" ? fbclid : null,
      source_url: typeof source_url === "string" ? source_url.slice(0, 500) : null,
      origin: typeof origin === "string" ? origin.slice(0, 40) : "public_page",
      lead_id: lead_id ? String(lead_id) : null,
    });

    return json({ ok: true, saved });
  } catch (e) {
    console.error("[meta-attribution-capture]", e);
    // Atribuição nunca pode quebrar a captação do lead.
    return json({ ok: false, saved: false });
  }
});
