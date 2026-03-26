import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  const secrets = {
    META_WHATSAPP_VERIFY_TOKEN: Deno.env.get("META_WHATSAPP_VERIFY_TOKEN"),
  };

  const html = `<!DOCTYPE html>
<html><head><title>Secrets</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:monospace;padding:20px;background:#111;color:#0f0}
pre{background:#222;padding:15px;border-radius:8px;overflow-x:auto;word-break:break-all;white-space:pre-wrap}
h2{color:#ff0}button{margin-top:10px;padding:8px 16px;cursor:pointer}</style></head>
<body><h1>⚠️ DELETE THIS FUNCTION AFTER COPYING</h1>
${Object.entries(secrets).map(([k,v]) => `<h2>${k}</h2><pre id="${k}">${v || 'NOT SET'}</pre>
<button onclick="navigator.clipboard.writeText(document.getElementById('${k}').textContent).then(()=>this.textContent='✅ Copied!')">📋 Copy</button>`).join('<hr>')}
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html" } });
});
