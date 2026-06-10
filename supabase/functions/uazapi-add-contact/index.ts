import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  resolveUazapiCredentials,
  uazapiInstance,
  formatUazapiNumber,
} from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Salva um contato na agenda da instância uazapi (endpoint /contact/add).
 * Necessário para que o cliente esteja em "Meus contatos" e possa visualizar
 * os status/stories publicados pela loja (privacidade do status = meus contatos).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { whatsapp_number_id, phone, name } = await req.json();

    if (!phone || !String(phone).trim()) {
      return new Response(JSON.stringify({ error: "phone é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const formattedPhone = formatUazapiNumber(String(phone));
    const contactName = (name && String(name).trim()) || formattedPhone;

    const r = await uazapiInstance("/contact/add", token, {
      method: "POST",
      body: { phone: formattedPhone, name: contactName },
    });

    if (!r.ok) {
      console.error("uazapi contact/add error:", r.data);
      return new Response(
        JSON.stringify({ error: "Falha ao salvar contato", details: r.data }),
        { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ success: true, data: r.data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro ao salvar contato uazapi:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
