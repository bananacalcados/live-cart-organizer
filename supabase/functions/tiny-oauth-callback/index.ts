import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  const clientId = Deno.env.get("TINY_APP_CLIENT_ID")!;
  const clientSecret = Deno.env.get("TINY_APP_CLIENT_SECRET")!;
  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/tiny-oauth-callback`;

  // Step 0: If called with ?start=true, redirect to Olist auth
  if (params.get("start") === "true") {
    const authUrl = `https://id.olist.com/openid/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20email%20profile&state=tiny_app_auth`;
    console.log("Redirecting to auth URL:", authUrl);
    return new Response(null, {
      status: 302,
      headers: { "Location": authUrl },
    });
  }

  // Step 1: Check for error
  const error = params.get("error");
  if (error) {
    const errorDesc = params.get("error_description") || "A autorização foi negada.";
    console.error("OAuth error:", error, errorDesc);
    return new Response(renderHTML("Erro na Autorização", `
      <p style="color:#ef4444;">Erro: ${error}</p>
      <p>${errorDesc}</p>
      <p>Você pode fechar esta aba e tentar novamente.</p>
    `), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // Step 2: Check for authorization code
  const code = params.get("code");
  if (code) {
    console.log("Received authorization code, exchanging for token...");

    try {
      // Exchange code for access token
      const tokenRes = await fetch("https://id.olist.com/openid/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      const tokenData = await tokenRes.json();
      console.log("Token exchange response status:", tokenRes.status);
      console.log("Token exchange response keys:", Object.keys(tokenData));

      if (!tokenRes.ok) {
        console.error("Token exchange failed:", JSON.stringify(tokenData));
        return new Response(renderHTML("Erro na Troca de Token", `
          <p style="color:#ef4444;">Erro ao trocar código por token.</p>
          <pre style="background:#1e293b;padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;">${JSON.stringify(tokenData, null, 2)}</pre>
          <p>Tente novamente ou entre em contato com o suporte.</p>
        `), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      // Save the tokens
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      await supabase.from("app_settings").upsert({
        key: "tiny_app_token",
        value: {
          access_token: tokenData.access_token,
          id_token: tokenData.id_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          token_type: tokenData.token_type,
          connected_at: new Date().toISOString(),
        },
      }, { onConflict: "key" });

      console.log("Tiny App token saved successfully!");

      return new Response(renderHTML("Tiny App Conectado! ✅", `
        <p style="color:#22c55e; font-weight:bold; font-size:18px;">Autorização concluída com sucesso!</p>
        <p>O token do Tiny App foi salvo automaticamente no sistema.</p>
        <p style="color:#64748b; font-size:14px;">Você pode fechar esta aba e voltar ao sistema.</p>
        <script>setTimeout(() => { try { window.close(); } catch(e) {} }, 3000);</script>
      `), { headers: { "Content-Type": "text/html; charset=utf-8" } });

    } catch (err) {
      console.error("Error during token exchange:", err);
      return new Response(renderHTML("Erro", `
        <p style="color:#ef4444;">Erro inesperado: ${err.message}</p>
      `), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  }

  // Fallback: show all received params for debugging
  console.log("Callback received with params:", Object.fromEntries(params.entries()));
  return new Response(renderHTML("Callback Recebido", `
    <p>Parâmetros recebidos:</p>
    <pre style="background:#1e293b;padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;">${
      JSON.stringify(Object.fromEntries(params.entries()), null, 2)
    }</pre>
  `), { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

function renderHTML(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.3);
    }
    h1 { font-size: 24px; margin-bottom: 16px; }
    p { line-height: 1.6; color: #94a3b8; }
    pre { text-align: left; color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    ${body}
  </div>
</body>
</html>`;
}
