// ⚠️ FUNÇÃO ATUALMENTE INOPERANTE.
// Falha 100% das invocações com "Web Cache is not available in this context"
// (ImageMagick WASM incompatível com o Deno Edge Runtime do Supabase).
// Mantida no repo pendente de decisão de produto sobre o Caminho 2
// (substituir por lib de imagem compatível) ou remoção definitiva.
// NÃO invocar em produção — o erro é engolido pelo try/catch interno
// e a função retorna HTTP 200 mesmo falhando.

// Corrige a orientação EXIF de imagens já no storage que estão referenciadas em
// mensagens agendadas para grupos VIP (status='pending'/'sending'). Para cada
// media_url do tipo 'image', baixa, aplica autoOrient, regrava no bucket com novo
// nome e atualiza a referência no banco.
//
// Também processa registros multi-bloco (message_group_id) e mediaItems salvos
// como array no campo media_url (caso aplicável).
//
// Pode ser chamada com:
//   { campaign_id?: string, scope?: 'pending'|'all' }
//
// scope='pending' (default): só mensagens ainda não enviadas.
// scope='all': inclui já enviadas (útil para auditoria, mas não reenvia).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImageMagick, initialize, MagickFormat } from "https://deno.land/x/imagemagick_deno@0.0.31/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "marketing-attachments";
let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await initialize();
    initialized = true;
  }
}

async function autoOrientBytes(bytes: Uint8Array): Promise<Uint8Array> {
  await ensureInit();
  return await new Promise<Uint8Array>((resolve, reject) => {
    ImageMagick.read(bytes, (img) => {
      try {
        img.autoOrient();
        img.write(MagickFormat.Jpeg, (out) => resolve(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function extractStoragePath(publicUrl: string, bucket: string): string | null {
  // padrão: https://<proj>.supabase.co/storage/v1/object/public/<bucket>/<path>
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.substring(idx + marker.length);
}

async function processOneUrl(
  supabase: any,
  url: string
): Promise<{ ok: boolean; newUrl?: string; reason?: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: `download ${res.status}` };
    const ct = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    if (!ct.startsWith("image/")) return { ok: false, reason: `not image (${ct})` };
    if (ct === "image/gif" || ct === "image/svg+xml") return { ok: false, reason: "skip gif/svg" };

    const bytes = new Uint8Array(await res.arrayBuffer());
    const fixed = await autoOrientBytes(bytes);

    // Reupload com sufixo "-oriented" para não quebrar o original
    const path = extractStoragePath(url, BUCKET);
    if (!path) return { ok: false, reason: "url fora do bucket esperado" };

    const dot = path.lastIndexOf(".");
    const dir = path.substring(0, path.lastIndexOf("/"));
    const base = path.substring(path.lastIndexOf("/") + 1, dot >= 0 ? dot : path.length);
    const newPath = `${dir}/${base}-oriented-${Date.now()}.jpg`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, fixed, { contentType: "image/jpeg", upsert: false });
    if (upErr) return { ok: false, reason: `upload ${upErr.message}` };

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
    return { ok: true, newUrl: urlData.publicUrl };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const campaignId: string | undefined = body.campaign_id;
    const scope: string = body.scope || "pending";

    let q = supabase
      .from("group_campaign_scheduled_messages")
      .select("id, message_type, media_url, status")
      .eq("message_type", "image")
      .not("media_url", "is", null);

    if (scope === "pending") {
      q = q.in("status", ["pending", "sending", "grouped"]);
    }
    if (campaignId) q = q.eq("campaign_id", campaignId);

    const { data: msgs, error } = await q;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    let fixed = 0;
    let skipped = 0;
    let failed = 0;

    for (const m of msgs || []) {
      const url = (m as any).media_url as string;
      if (!url) {
        skipped++;
        continue;
      }
      const r = await processOneUrl(supabase, url);
      if (r.ok && r.newUrl) {
        const { error: updErr } = await supabase
          .from("group_campaign_scheduled_messages")
          .update({ media_url: r.newUrl })
          .eq("id", (m as any).id);
        if (updErr) {
          failed++;
          results.push({ id: (m as any).id, ok: false, reason: `update ${updErr.message}` });
        } else {
          fixed++;
          results.push({ id: (m as any).id, ok: true, newUrl: r.newUrl });
        }
      } else {
        if (r.reason?.startsWith("not image") || r.reason?.startsWith("skip")) {
          skipped++;
        } else {
          failed++;
        }
        results.push({ id: (m as any).id, ok: false, reason: r.reason });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: (msgs || []).length,
        fixed,
        skipped,
        failed,
        results: results.slice(0, 50), // truncate
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[fix-image-orientation] error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
