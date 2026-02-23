import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const params = url.searchParams;

  // Tiny pode enviar token via query params ou fragment
  const accessToken = params.get("access_token") || params.get("code") || params.get("token");
  const state = params.get("state");
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  console.log("Tiny OAuth callback received:", {
    hasAccessToken: !!accessToken,
    state,
    error,
    allParams: Object.fromEntries(params.entries()),
  });

  if (error) {
    return new Response(renderHTML("Erro na Autorização", `
      <p style="color:#ef4444;">Erro: ${error}</p>
      <p>${errorDescription || "A autorização foi negada ou ocorreu um erro."}</p>
      <p>Você pode fechar esta aba e tentar novamente.</p>
    `), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (accessToken) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Salvar o token nas app_settings
      await supabase.from("app_settings").upsert({
        key: "tiny_app_token",
        value: JSON.stringify({
          access_token: accessToken,
          state,
          connected_at: new Date().toISOString(),
          all_params: Object.fromEntries(params.entries()),
        }),
      }, { onConflict: "key" });

      console.log("Tiny App token saved successfully");

      return new Response(renderHTML("Tiny App Conectado! ✅", `
        <p style="color:#22c55e; font-weight:bold;">Autorização concluída com sucesso!</p>
        <p>O token do Tiny App foi salvo automaticamente.</p>
        <p>Você pode fechar esta aba e voltar ao sistema.</p>
        <script>
          // Tenta fechar a aba automaticamente após 3s
          setTimeout(() => { try { window.close(); } catch(e) {} }, 3000);
        </script>
      `), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (err) {
      console.error("Error saving Tiny token:", err);
      return new Response(renderHTML("Erro ao Salvar", `
        <p style="color:#ef4444;">Erro ao salvar o token: ${err.message}</p>
        <p>Por favor, tente novamente ou entre em contato com o suporte.</p>
      `), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  }

  // Fallback: nenhum token recebido — mostra os parâmetros para debug
  return new Response(renderHTML("Callback Recebido", `
    <p>Nenhum token foi encontrado nos parâmetros.</p>
    <p>Parâmetros recebidos:</p>
    <pre style="background:#1e293b;padding:12px;border-radius:8px;overflow-x:auto;">${
      JSON.stringify(Object.fromEntries(params.entries()), null, 2)
    }</pre>
    <p>Se o Tiny enviou o token via fragment (#), ele não chega ao servidor. 
    Copie a URL completa desta aba e compartilhe para debug.</p>
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
      max-width: 480px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.3);
    }
    h1 { font-size: 24px; margin-bottom: 16px; }
    p { line-height: 1.6; color: #94a3b8; }
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
