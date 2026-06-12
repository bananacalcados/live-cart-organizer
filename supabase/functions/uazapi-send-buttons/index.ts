import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveUazapiCredentials, uazapiInstance, formatUazapiNumber } from "../_shared/uazapi-credentials.ts";
import { checkInstanceGuard } from "../_shared/instance-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-force-instance",
};

/**
 * Envia botões de resposta rápida via uazapi (/send/menu type=button).
 * Para botões de quick-reply o formato de cada item em `choices` é apenas o título.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, message, buttons, imageUrl, whatsapp_number_id } = await req.json();
    if (!phone || !Array.isArray(buttons) || buttons.length === 0) {
      return new Response(JSON.stringify({ error: "phone and buttons are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isGroupId =
      phone.includes("@") || phone.includes("-") || phone.replace(/\D/g, "").startsWith("120");
    if (!isGroupId) {
      const guard = await checkInstanceGuard({ req, phone, whatsappNumberId: whatsapp_number_id });
      if (!guard.ok) {
        return new Response(JSON.stringify(guard.body), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const number = formatUazapiNumber(phone);

    // Quick reply buttons → choices são apenas os títulos.
    const choices = (buttons as Array<{ id?: string; title?: string }>).map(
      (b, i) => b.title || `Opção ${i + 1}`,
    );

    const payload: Record<string, unknown> = {
      number,
      type: "button",
      text: message || "",
      choices,
    };
    if (imageUrl) payload.imageButton = imageUrl;

    const r = await uazapiInstance("/send/menu", token, { method: "POST", body: payload });
    if (!r.ok) {
      console.error("uazapi send-buttons error:", r.data);
      return new Response(JSON.stringify({ error: "Failed to send buttons", details: r.data }), {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageId =
      r.data?.messageid || r.data?.id || r.data?.message?.messageid || r.data?.message?.id || null;
    return new Response(JSON.stringify({ success: true, messageId, data: r.data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending uazapi buttons:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
