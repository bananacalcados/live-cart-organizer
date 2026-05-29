import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  WASENDER_BASE,
  getServiceClient,
  wasenderPAT,
} from "../_shared/wasender-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * wasender-session — gerencia sessões (instâncias) WaSender usando o PAT global.
 *
 * Ações (body.action):
 *  - create:     cria sessão + linha em whatsapp_numbers (provider=wasender)
 *  - connect:    inicia conexão, retorna { status, qrCode }
 *  - qrcode:     retorna QR fresco
 *  - status:     status atual da sessão (atualiza is_online)
 *  - disconnect: desconecta a sessão
 *  - delete:     exclui a sessão na WaSender (e opcionalmente a linha local)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getServiceClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // Resolve sessão WaSender a partir do whatsapp_number_id (quando aplicável)
    const numberId: string | null = body.whatsapp_number_id || null;
    let sessionId: number | null = body.session_id ?? null;

    async function loadNumber() {
      if (!numberId) return null;
      const { data } = await supabase
        .from("whatsapp_numbers")
        .select("id, wasender_session_id, wasender_api_key, wasender_webhook_secret")
        .eq("id", numberId)
        .maybeSingle();
      return data;
    }

    switch (action) {
      case "create": {
        const { label, phone } = body;
        if (!label || !phone) {
          return json({ error: "label e phone são obrigatórios" }, 400);
        }

        // 1) cria a linha local primeiro para termos o id (usado no webhook_url)
        const { data: row, error: insErr } = await supabase
          .from("whatsapp_numbers")
          .insert({
            label: String(label).trim(),
            phone_display: String(phone).trim(),
            provider: "wasender",
            is_active: true,
            is_default: false,
            wasender_phone_number: String(phone).replace(/\D/g, ""),
          })
          .select("id")
          .single();
        if (insErr || !row) {
          return json({ error: "Falha ao criar linha local", details: insErr?.message }, 500);
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const webhookUrl = `${supabaseUrl}/functions/v1/wasender-webhook?number_id=${row.id}`;

        // 2) cria a sessão na WaSender
        const created = await wasenderPAT("/whatsapp-sessions", {
          method: "POST",
          body: {
            name: String(label).trim(),
            phone_number: String(phone).trim(),
            account_protection: true,
            log_messages: true,
            read_incoming_messages: false,
            webhook_url: webhookUrl,
            webhook_enabled: true,
            webhook_events: ["messages.received", "messages.update", "session.status"],
          },
        });

        if (!created.ok) {
          // rollback da linha local
          await supabase.from("whatsapp_numbers").delete().eq("id", row.id);
          return json({ error: "Falha ao criar sessão WaSender", details: created.data }, created.status);
        }

        const d = created.data?.data || created.data;
        await supabase
          .from("whatsapp_numbers")
          .update({
            wasender_session_id: d?.id ?? null,
            wasender_api_key: d?.api_key ?? null,
            wasender_webhook_secret: d?.webhook_secret ?? null,
          })
          .eq("id", row.id);

        return json({ success: true, whatsapp_number_id: row.id, session_id: d?.id ?? null });
      }

      case "connect": {
        const num = await loadNumber();
        sessionId = num?.wasender_session_id ?? sessionId;
        if (!sessionId) return json({ error: "Sessão WaSender não encontrada" }, 400);

        const r = await wasenderPAT(`/whatsapp-sessions/${sessionId}/connect`, { method: "POST" });
        if (!r.ok) return json({ error: "Falha ao conectar", details: r.data }, r.status);
        const d = r.data?.data || r.data;
        return json({ success: true, status: d?.status ?? null, qrCode: d?.qrCode ?? null });
      }

      case "qrcode": {
        const num = await loadNumber();
        sessionId = num?.wasender_session_id ?? sessionId;
        if (!sessionId) return json({ error: "Sessão WaSender não encontrada" }, 400);

        const r = await wasenderPAT(`/whatsapp-sessions/${sessionId}/qrcode`, { method: "GET" });
        if (!r.ok) return json({ error: "Falha ao obter QR", details: r.data }, r.status);
        const d = r.data?.data || r.data;
        return json({ success: true, qrCode: d?.qrCode ?? null });
      }

      case "status": {
        const num = await loadNumber();
        sessionId = num?.wasender_session_id ?? sessionId;
        if (!sessionId) return json({ error: "Sessão WaSender não encontrada" }, 400);

        const r = await wasenderPAT(`/whatsapp-sessions/${sessionId}`, { method: "GET" });
        const d = r.data?.data || r.data;
        const status = (d?.status || "").toString().toLowerCase();
        const isOnline = status === "connected";
        if (numberId) {
          await supabase
            .from("whatsapp_numbers")
            .update({ is_online: isOnline, last_health_check: new Date().toISOString() })
            .eq("id", numberId);
        }
        return json({ success: r.ok, status: d?.status ?? null, is_online: isOnline });
      }

      case "disconnect": {
        const num = await loadNumber();
        sessionId = num?.wasender_session_id ?? sessionId;
        if (!sessionId) return json({ error: "Sessão WaSender não encontrada" }, 400);

        const r = await wasenderPAT(`/whatsapp-sessions/${sessionId}/disconnect`, { method: "POST" });
        if (numberId) {
          await supabase.from("whatsapp_numbers").update({ is_online: false }).eq("id", numberId);
        }
        return json({ success: r.ok, details: r.data });
      }

      case "delete": {
        const num = await loadNumber();
        sessionId = num?.wasender_session_id ?? sessionId;
        if (sessionId) {
          await wasenderPAT(`/whatsapp-sessions/${sessionId}`, { method: "DELETE" });
        }
        if (numberId && body.delete_row) {
          await supabase.from("whatsapp_numbers").delete().eq("id", numberId);
        }
        return json({ success: true });
      }

      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    console.error("[wasender-session] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
