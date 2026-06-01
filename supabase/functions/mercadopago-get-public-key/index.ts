import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getActiveMpAccount } from "../_shared/mp-account.ts";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function isAllowedOrigin(origin: string) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:") return false;
    return hostname.endsWith(".lovable.app") || hostname.endsWith(".lovableproject.com");
  } catch {
    return false;
  }
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

// Retorna a chave pública (publishable) + id da conta MP ativa.
// A public_key do Mercado Pago é segura para uso no frontend (tokenização de cartão via MercadoPago.JS V2).
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const mpAccount = await getActiveMpAccount(supabase);

    // Busca a public_key diretamente (o helper não a expõe)
    let publicKey: string | null = null;
    if (mpAccount?.account_id) {
      const { data } = await supabase
        .from("mercadopago_accounts")
        .select("public_key")
        .eq("id", mpAccount.account_id)
        .maybeSingle();
      publicKey = data?.public_key || null;
    }
    // Fallback: env secret (compatibilidade)
    if (!publicKey) {
      publicKey = Deno.env.get("MERCADOPAGO_PUBLIC_KEY") || null;
    }

    return new Response(
      JSON.stringify({
        publicKey,
        accountId: mpAccount?.account_id || null,
        accountName: mpAccount?.account_name || null,
        isSandbox: mpAccount?.is_sandbox || false,
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[mp-public-key] error:", error);
    return new Response(
      JSON.stringify({ publicKey: null, error: (error as Error).message }),
      { status: 200, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
