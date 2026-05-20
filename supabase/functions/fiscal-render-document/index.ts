import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HTML_DANFE_REGEX = /(?:^|\/)[^/?#]+\.html(?:$|[?#])/i;

function toBase64(input: string) {
  return btoa(unescape(encodeURIComponent(input)));
}

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

function buildRedirectDocument(fetchUrl: string) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Carregando DANFE...</title>
    <style>
      html, body { margin: 0; min-height: 100%; background: #f4f4f5; }
      body { display: grid; place-items: center; font-family: Arial, sans-serif; color: #18181b; }
      .status { padding: 18px 20px; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="status">Carregando DANFE...</div>
    <script>
      const sourceUrl = ${JSON.stringify(fetchUrl)};
      fetch(sourceUrl, { credentials: 'omit' })
        .then(async (response) => {
          if (!response.ok) throw new Error('Não foi possível carregar a DANFE');
          return await response.text();
        })
        .then((html) => {
          document.open();
          document.write(html);
          document.close();
        })
        .catch((error) => {
          document.body.innerHTML = '<div class="status">Erro ao carregar DANFE: ' + (error?.message || 'falha inesperada') + '</div>';
        });
    </script>
  </body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const requestUrl = new URL(req.url);
    const rawUrl = requestUrl.searchParams.get("url")?.trim();
    const autoPrint = requestUrl.searchParams.get("autoprint") === "1";
    const rawMode = requestUrl.searchParams.get("raw") === "1";

    if (!rawUrl) throw new Error("url obrigatória");

    if (!rawMode) {
      const fetchUrl = new URL(req.url);
      fetchUrl.searchParams.set("raw", "1");
      const redirectHtml = buildRedirectDocument(fetchUrl.toString());
      return Response.redirect(`data:text/html;charset=utf-8;base64,${toBase64(redirectHtml)}`, 302);
    }

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