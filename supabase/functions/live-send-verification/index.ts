import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, action } = await req.json();

    if (!phone) throw new Error("phone is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "verify") {
      // Verify a code
      const { code } = await req.json().catch(() => ({}));
      // Re-parse since we already consumed the body
      return new Response(JSON.stringify({ error: "Use verify action separately" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate 4-digit code
    const code = String(Math.floor(1000 + Math.random() * 9000));

    // Invalidate old codes for this phone
    await supabase
      .from("live_phone_verifications")
      .update({ verified: true })
      .eq("phone", phone)
      .eq("verified", false);

    // Save new code
    const { error: insertError } = await supabase
      .from("live_phone_verifications")
      .insert({ phone, code });

    if (insertError) {
      console.error("Error saving verification code:", insertError);
      throw new Error("Failed to save verification code");
    }

    // Send via Z-API (primary WhatsApp instance)
    const ZAPI_INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID");
    const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN");
    const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN");

    if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN) {
      console.error("Z-API credentials not configured");
      throw new Error("WhatsApp sending not configured");
    }

    const message = `🔐 Seu código de verificação para a Live Banana Calçados é: *${code}*\n\nDigite este código para entrar na live. Válido por 10 minutos.`;

    const zapiResponse = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Client-Token": ZAPI_CLIENT_TOKEN || "",
        },
        body: JSON.stringify({
          phone: phone.replace(/\D/g, '').startsWith('55') ? phone.replace(/\D/g, '') : '55' + phone.replace(/\D/g, ''),
          message,
        }),
      }
    );

    const zapiData = await zapiResponse.json();
    console.log("Z-API verification send result:", zapiData);

    if (!zapiResponse.ok) {
      throw new Error("Failed to send WhatsApp message");
    }

    return new Response(
      JSON.stringify({ success: true, message: "Code sent" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in live-send-verification:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
