import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getServiceClient,
  uazapiAdmin,
  uazapiInstance,
} from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Eventos do webhook que a instância uazapi deve assinar.
// (nomes válidos da uazapi v2 — ver schema Webhook na doc)
const WEBHOOK_EVENTS = [
  "connection",
  "messages",
  "messages_update",
  "contacts",
  "groups",
];

// Não reprocessar o que NÓS mesmos enviamos via API (evita eco/loop).
// Mensagens enviadas pelo celular físico (fromMe, mas não via API) continuam chegando.
const EXCLUDE_MESSAGES = ["wasSentByApi"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * uazapi-session — gerencia instâncias uazapi.
 *
 * Ações (body.action):
 *  - create:        cria instância (admintoken) + linha em whatsapp_numbers + webhook
 *  - connect:       inicia conexão, retorna { status, qrCode }
 *  - qrcode:        retorna QR fresco (via /instance/status)
 *  - status:        status atual (atualiza is_online)
 *  - disconnect:    desconecta a instância
 *  - delete:        exclui a instância na uazapi (e opcionalmente a linha local)
 *  - update_events: reconfigura o webhook da instância
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getServiceClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const numberId: string | null = body.whatsapp_number_id || null;

    async function loadToken(): Promise<string | null> {
      if (!numberId) return null;
      const { data } = await supabase
        .from("whatsapp_numbers")
        .select("uazapi_token")
        .eq("id", numberId)
        .maybeSingle();
      return data?.uazapi_token ?? null;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    async function configureWebhook(token: string, id: string) {
      const webhookUrl = `${supabaseUrl}/functions/v1/uazapi-webhook?number_id=${id}`;
      return uazapiInstance("/webhook", token, {
        method: "POST",
        body: {
          action: "add",
          enabled: true,
          url: webhookUrl,
          events: WEBHOOK_EVENTS,
          excludeMessages: EXCLUDE_MESSAGES,
        },
      });
    }

    switch (action) {
      case "create": {
        const { label, phone } = body;
        if (!label) return json({ error: "label é obrigatório" }, 400);

        // 1) cria a linha local primeiro (precisamos do id para o webhook_url)
        //    ai_paused: true → instância NOVA nasce em "modo aquecimento":
        //    nenhuma IA/automação responde até o operador liberar manualmente.
        //    Isso reduz o risco de banimento nos primeiros minutos de uma sessão nova.
        const { data: row, error: insErr } = await supabase
          .from("whatsapp_numbers")
          .insert({
            label: String(label).trim(),
            phone_display: phone ? String(phone).trim() : "",
            provider: "uazapi",
            is_active: true,
            is_default: false,
            ai_paused: true,
          })
          .select("id")
          .single();
        if (insErr || !row) {
          return json({ error: "Falha ao criar linha local", details: insErr?.message }, 500);
        }

        // 2) cria a instância na uazapi (admintoken)
        const created = await uazapiAdmin("/instance/create", {
          method: "POST",
          body: { name: String(label).trim() },
        });
        if (!created.ok) {
          await supabase.from("whatsapp_numbers").delete().eq("id", row.id);
          return json({ error: "Falha ao criar instância uazapi", details: created.data }, created.status);
        }

        const token: string | null = created.data?.token ?? created.data?.instance?.token ?? null;
        const owner: string | null = created.data?.instance?.id ?? created.data?.instance?.owner ?? null;
        const name: string | null = created.data?.instance?.name ?? String(label).trim();

        if (!token) {
          await supabase.from("whatsapp_numbers").delete().eq("id", row.id);
          return json({ error: "Instância criada sem token", details: created.data }, 500);
        }

        await supabase
          .from("whatsapp_numbers")
          .update({
            uazapi_token: token,
            uazapi_owner: owner,
            uazapi_instance_name: name,
          })
          .eq("id", row.id);

        // 3) configura o webhook
        const wh = await configureWebhook(token, row.id);
        if (!wh.ok) console.warn("[uazapi-session] falha ao configurar webhook:", wh.data);

        return json({ success: true, whatsapp_number_id: row.id, owner });
      }

      case "connect": {
        const token = await loadToken();
        if (!token) return json({ error: "Instância uazapi não encontrada" }, 400);

        // Reaplica a região do proxy interno gerenciado (persistida na linha local),
        // para que toda reconexão saia da mesma cidade/UF brasileira escolhida.
        const connectBody: Record<string, unknown> = body.phone
          ? { phone: String(body.phone).replace(/\D/g, "") }
          : {};
        if (numberId) {
          const { data: cfg } = await supabase
            .from("whatsapp_numbers")
            .select("uazapi_proxy_mode, uazapi_proxy_managed_country, uazapi_proxy_managed_state, uazapi_proxy_managed_city")
            .eq("id", numberId)
            .maybeSingle();
          if (cfg?.uazapi_proxy_mode === "internal") {
            if (cfg.uazapi_proxy_managed_country) connectBody.proxy_managed_country = cfg.uazapi_proxy_managed_country;
            if (cfg.uazapi_proxy_managed_state) connectBody.proxy_managed_state = cfg.uazapi_proxy_managed_state;
            if (cfg.uazapi_proxy_managed_city) connectBody.proxy_managed_city = cfg.uazapi_proxy_managed_city;
          }
        }

        const r = await uazapiInstance("/instance/connect", token, {
          method: "POST",
          body: connectBody,
        });
        if (!r.ok) return json({ error: "Falha ao conectar", details: r.data }, r.status);
        const inst = r.data?.instance || r.data;
        const qr = inst?.qrcode ?? inst?.qrCode ?? null;
        const status = inst?.status ?? (r.data?.connected ? "connected" : null);
        if (numberId && qr) {
          await supabase
            .from("whatsapp_numbers")
            .update({ uazapi_last_qr: qr, uazapi_qr_updated_at: new Date().toISOString(), is_online: false })
            .eq("id", numberId);
        }
        return json({ success: true, status, qrCode: qr });
      }

      case "qrcode": {
        const token = await loadToken();
        if (!token) return json({ error: "Instância uazapi não encontrada" }, 400);

        const r = await uazapiInstance("/instance/status", token, { method: "GET" });
        const inst = r.data?.instance || r.data;
        const qr = inst?.qrcode ?? inst?.qrCode ?? null;
        return json({ success: r.ok, qrCode: qr });
      }

      case "status": {
        const token = await loadToken();
        if (!token) return json({ error: "Instância uazapi não encontrada" }, 400);

        const r = await uazapiInstance("/instance/status", token, { method: "GET" });
        const inst = r.data?.instance || r.data;
        const statusBlock = r.data?.status || {};
        const statusStr = (inst?.status || "").toString().toLowerCase();
        const isOnline = Boolean(statusBlock?.connected) || statusStr === "connected";
        if (numberId) {
          const update: Record<string, unknown> = {
            is_online: isOnline,
            last_health_check: new Date().toISOString(),
          };
          if (isOnline) {
            update.uazapi_last_qr = null;
            update.uazapi_qr_updated_at = null;
          }
          await supabase.from("whatsapp_numbers").update(update).eq("id", numberId);
        }
        return json({ success: r.ok, status: inst?.status ?? null, is_online: isOnline });
      }

      case "disconnect": {
        const token = await loadToken();
        if (!token) return json({ error: "Instância uazapi não encontrada" }, 400);

        const r = await uazapiInstance("/instance/disconnect", token, { method: "POST" });
        if (numberId) {
          await supabase.from("whatsapp_numbers").update({ is_online: false }).eq("id", numberId);
        }
        return json({ success: r.ok, details: r.data });
      }

      case "delete": {
        const token = await loadToken();
        if (token) {
          await uazapiInstance("/instance", token, { method: "DELETE" });
        }
        if (numberId && body.delete_row) {
          await supabase.from("whatsapp_numbers").delete().eq("id", numberId);
        }
        return json({ success: true });
      }

      case "update_events": {
        const token = await loadToken();
        if (!token || !numberId) return json({ error: "Instância uazapi não encontrada" }, 400);
        const r = await configureWebhook(token, numberId);
        if (!r.ok) return json({ error: "Falha ao atualizar webhook", details: r.data }, r.status);
        return json({ success: true, events: WEBHOOK_EVENTS });
      }

      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    console.error("[uazapi-session] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
