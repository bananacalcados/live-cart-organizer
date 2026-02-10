import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const shop = url.searchParams.get("shop");

    if (!code || !shop) {
      return new Response("Missing code or shop parameter", { status: 400 });
    }

    const clientId = Deno.env.get("SHOPIFY_CLIENT_ID")!;
    const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET")!;

    // Exchange code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", JSON.stringify(tokenData));
      return new Response(
        `<html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h1>❌ Erro ao obter token</h1>
          <p>${JSON.stringify(tokenData)}</p>
        </body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    const accessToken = tokenData.access_token;
    const scope = tokenData.scope;

    console.log("✅ Access token obtained! Scope:", scope);
    console.log("Access Token:", accessToken);

    return new Response(
      `<html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>✅ App instalado com sucesso!</h1>
        <p>O token de acesso foi gerado.</p>
        <p><strong>Copie o token abaixo e envie para o Lovable:</strong></p>
        <textarea style="width:80%;height:100px;font-size:14px;padding:10px" readonly>${accessToken}</textarea>
        <p style="margin-top:20px;color:#666">Escopo concedido: ${scope}</p>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    return new Response(
      `<html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>❌ Erro no callback</h1>
        <p>${error.message}</p>
      </body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
});
