import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HTML_DANFE_REGEX = /(?:^|\/)[^/?#]+\.html(?:$|[?#])/i;

function ensureUtf8Meta(html: string) {
  if (/<meta[^>]+charset=/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
  return `<meta charset="utf-8">${html}`;
}

function injectPrintScript(html: string) {
  const script = '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),120));</script>';
  if (html.includes('</body>')) return html.replace('</body>', `${script}</body>`);
  return `${html}${script}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const requestUrl = new URL(req.url);
    const rawUrl = requestUrl.searchParams.get("url")?.trim();
    const autoPrint = requestUrl.searchParams.get("autoprint") === "1";

    if (!rawUrl) throw new Error("url obrigatória");

    const target = new URL(rawUrl);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const allowedHost = new URL(supabaseUrl).host;
    if (target.host !== allowedHost) throw new Error("Host de documento não permitido");
    if (!HTML_DANFE_REGEX.test(target.pathname)) throw new Error("Apenas DANFE HTML é suportada");

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const marker = "/storage/v1/object/public/fiscal-documents/";
    const idx = target.pathname.indexOf(marker);
    if (idx < 0) throw new Error("Caminho do documento inválido");
    const storagePath = decodeURIComponent(target.pathname.slice(idx + marker.length));

    const { data, error } = await supabase.storage.from("fiscal-documents").download(storagePath);
    if (error || !data) throw new Error(error?.message || "Não foi possível baixar a DANFE");

    let html = await data.text();
    html = ensureUtf8Meta(html);
    if (autoPrint) html = injectPrintScript(html);

    return new Response(html, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: any) {
    console.error("[fiscal-render-document]", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});