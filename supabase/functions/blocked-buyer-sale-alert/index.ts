import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getServiceClient,
  uazapiInstance,
  formatUazapiNumber,
} from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Instância Whats Pérola (uazapi) — envia o alerta
const ALERT_INSTANCE_ID = "0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c";
// Admin que recebe o alerta
const ALERT_ADMIN_PHONE = "5533991955003";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      sale_id,
      customer_name,
      customer_phone,
      total,
      store_name,
      seller_name,
    } = body || {};

    const supabase = getServiceClient();
    const { data: inst, error } = await supabase
      .from("whatsapp_numbers")
      .select("uazapi_token")
      .eq("id", ALERT_INSTANCE_ID)
      .maybeSingle();
    if (error || !inst?.uazapi_token) {
      console.error("[blocked-buyer-sale-alert] instância sem token", error);
      return new Response(JSON.stringify({ error: "instance token missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const totalTxt = typeof total === "number"
      ? `R$ ${total.toFixed(2).replace(".", ",")}`
      : (total ?? "-");

    const message =
      `🚨 *ALERTA — CLIENTE BLOQUEADA*\n\n` +
      `Entrou uma venda no PDV com o telefone monitorado.\n\n` +
      `👤 *Cliente:* ${customer_name || "(sem nome)"}\n` +
      `📱 *Telefone:* ${customer_phone || "-"}\n` +
      `🧾 *Venda:* ${sale_id || "-"}\n` +
      `💵 *Total:* ${totalTxt}\n` +
      `🏪 *Loja:* ${store_name || "-"}\n` +
      `🧑‍💼 *Vendedora:* ${seller_name || "-"}\n\n` +
      `⚠️ *Barre o envio antes de despachar.*`;

    const payload = {
      number: formatUazapiNumber(ALERT_ADMIN_PHONE),
      text: message,
    };
    const r = await uazapiInstance("/send/text", inst.uazapi_token, {
      method: "POST",
      body: payload,
    });

    if (!r.ok) {
      console.error("[blocked-buyer-sale-alert] uazapi error", r.data);
      return new Response(JSON.stringify({ error: "uazapi send failed", details: r.data }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[blocked-buyer-sale-alert] error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
