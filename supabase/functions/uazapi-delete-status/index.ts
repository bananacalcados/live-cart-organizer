import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  resolveUazapiCredentials,
  uazapiInstance,
  getServiceClient,
} from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Apaga (revoga) um Status/Story já publicado pela instância uazapi.
 * Usa o mesmo endpoint de revogação de mensagens (/message/delete) com o
 * messageid do status. Também remove o registro de whatsapp_status_posts.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { whatsapp_number_id, message_id } = await req.json();

    if (!message_id || !String(message_id).trim()) {
      return new Response(JSON.stringify({ error: "message_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);

    const r = await uazapiInstance("/message/delete", token, {
      method: "POST",
      body: { messageId: String(message_id) },
    });

    // Mesmo que a uazapi devolva erro (status muito antigo, já apagado), removemos
    // o registro local para a lista refletir o estado desejado pelo lojista.
    try {
      const supabase = getServiceClient();
      await supabase
        .from("whatsapp_status_posts")
        .delete()
        .eq("message_id", String(message_id));
    } catch (e) {
      console.error("[uazapi-delete-status] falha ao remover registro local:", (e as Error).message);
    }

    if (!r.ok) {
      console.error("uazapi delete-status error:", r.data);
      return new Response(
        JSON.stringify({ error: "Falha ao apagar status na uazapi", details: r.data, localRemoved: true }),
        { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ success: true, data: r.data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro ao apagar status uazapi:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
