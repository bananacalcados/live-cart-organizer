import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const META_API_VERSION = "v22.0";

/** Normaliza telefone BR para dígitos com DDI 55. Não toca em grupos/JIDs. */
function normalizePhone(phone: string): string {
  if (!phone) return phone;
  if (phone.includes("@") || phone.includes("-")) return phone;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("120")) return digits;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length >= 10 && digits.length <= 11) return "55" + digits;
  if (digits.length >= 12 && !digits.startsWith("55")) return digits;
  return "55" + digits;
}

/**
 * whatsapp-block-contact — bloqueio/desbloqueio NATIVO no WhatsApp.
 *
 * Aciona a API de bloqueio do provedor da instância (Z-API, WaSender ou Meta Cloud),
 * que efetivamente impede enviar e receber mensagens daquele número no WhatsApp.
 * Também registra o estado em `blocked_contacts`.
 *
 * Body: { phone, whatsapp_number_id, action: 'block'|'unblock', reason?, blocked_by?, blocked_by_name? }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, whatsapp_number_id, action, reason, blocked_by, blocked_by_name } =
      await req.json();

    if (!phone || !whatsapp_number_id) {
      return json({ error: "phone e whatsapp_number_id são obrigatórios" }, 400);
    }
    if (action !== "block" && action !== "unblock") {
      return json({ error: "action deve ser 'block' ou 'unblock'" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: num, error: numErr } = await supabase
      .from("whatsapp_numbers")
      .select(
        "id, provider, phone_number_id, access_token, zapi_instance_id, zapi_token, zapi_client_token, wasender_api_key, uazapi_token",
      )
      .eq("id", whatsapp_number_id)
      .single();

    if (numErr || !num) {
      return json({ error: "Instância de WhatsApp não encontrada" }, 404);
    }

    const provider: string = num.provider;
    const normalized = normalizePhone(phone);

    let providerOk = false;
    let providerDetail: unknown = null;

    if (provider === "zapi") {
      if (!num.zapi_instance_id || !num.zapi_token || !num.zapi_client_token) {
        return json({ error: "Credenciais Z-API ausentes nesta instância" }, 400);
      }
      const url = `https://api.z-api.io/instances/${num.zapi_instance_id}/token/${num.zapi_token}/contacts/modify-blocked`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Client-Token": num.zapi_client_token },
        body: JSON.stringify({ phone: normalized, action }),
      });
      providerDetail = await res.json().catch(() => null);
      providerOk = res.ok;
    } else if (provider === "wasender") {
      if (!num.wasender_api_key) {
        return json({ error: "Credenciais WaSender ausentes nesta instância" }, 400);
      }
      const endpoint = action === "block" ? "block" : "unblock";
      const url = `https://www.wasenderapi.com/api/contacts/${normalized}/${endpoint}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${num.wasender_api_key}`,
          "Content-Type": "application/json",
        },
      });
      providerDetail = await res.json().catch(() => null);
      providerOk = res.ok;
    } else if (provider === "meta") {
      if (!num.phone_number_id || !num.access_token) {
        return json({ error: "Credenciais Meta ausentes nesta instância" }, 400);
      }
      const url = `https://graph.facebook.com/${META_API_VERSION}/${num.phone_number_id}/block_users`;
      const res = await fetch(url, {
        method: action === "block" ? "POST" : "DELETE",
        headers: {
          Authorization: `Bearer ${num.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          block_users: [{ user: normalized }],
        }),
      });
      providerDetail = await res.json().catch(() => null);
      // Meta retorna erros por número; consideramos ok se HTTP ok e sem failed_users
      const failed = (providerDetail as any)?.block_users?.failed_users?.length > 0;
      providerOk = res.ok && !failed;
    } else {
      return json({ error: `Provedor não suportado: ${provider}` }, 400);
    }

    if (!providerOk) {
      console.error(`[whatsapp-block-contact] ${provider} ${action} falhou:`, providerDetail);
      return json(
        {
          error: `Falha ao ${action === "block" ? "bloquear" : "desbloquear"} no WhatsApp (${provider})`,
          details: providerDetail,
        },
        502,
      );
    }

    // Persistir estado
    if (action === "block") {
      await supabase
        .from("blocked_contacts")
        .upsert(
          {
            phone: normalized,
            whatsapp_number_id,
            provider,
            reason: reason || null,
            blocked_by: blocked_by || null,
            blocked_by_name: blocked_by_name || null,
          },
          { onConflict: "phone,whatsapp_number_id" },
        );
    } else {
      await supabase
        .from("blocked_contacts")
        .delete()
        .eq("phone", normalized)
        .eq("whatsapp_number_id", whatsapp_number_id);
    }

    return json({ success: true, action, provider, phone: normalized, details: providerDetail });
  } catch (e) {
    console.error("[whatsapp-block-contact] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
