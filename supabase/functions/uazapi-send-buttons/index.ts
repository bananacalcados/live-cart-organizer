import { withAccessLog } from "../_shared/withAccessLog.ts";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";
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
serve(withAccessLog("uazapi-send-buttons", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
// Fase 4 auth: funcionário com módulo ou chamada interna (service_role + x-internal-call).
{ const denied = await requireStaffOrInternal(req, ["chat","pos","events","marketing","expedition"], false); if (denied) return denied; }

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

    // PIX/copiar: desde 12/11/2026 o WhatsApp descarta o /send/menu com botão de copiar
    // vindo da uazapi (fica "sent" e nunca entrega). Envia duas mensagens de texto comum:
    // instrução + o código sozinho. Vale para todos os chamadores sem mudar o front.
    const copyBtn = (buttons as Array<{ copyCode?: string }>).find((b) => b?.copyCode);
    if (copyBtn?.copyCode) {
      const texts = buildCopyCodeTexts(String(message || ""), String(copyBtn.copyCode));
      const ids: (string | null)[] = [];
      for (const text of texts) {
        const r = await uazapiInstance("/send/text", token, { method: "POST", body: { number, text, linkPreview: false } });
        if (!r.ok) {
          console.error("uazapi copy-code text error:", r.data);
          return new Response(JSON.stringify({ error: "Failed to send copy-code text", details: r.data, sent: ids.length }), {
            status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        ids.push(r.data?.messageid || r.data?.id || r.data?.message?.messageid || r.data?.message?.id || null);
      }
      return new Response(JSON.stringify({ success: true, messageId: ids[0], codeMessageId: ids[1], mode: "text_fallback" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Quick reply → só o título. Botão de copiar → "título|copy:código".
    // Botão de link → "título|url:https://...".
    const choices = (
      buttons as Array<{ id?: string; title?: string; copyCode?: string; url?: string }>
    ).map((b, i) => {
      const title = b.title || `Opção ${i + 1}`;
      if (b.copyCode) return `${title}|copy:${b.copyCode}`;
      if (b.url) return `${title}|url:${b.url}`;
      return title;
    });

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
}));

/** Mensagem 1 (cabeçalho original "💰 *PIX de R$ X*" + descrição) e mensagem 2 (código puro). */
export function buildCopyCodeTexts(message: string, code: string): [string, string] {
  const head = (message.split(/\n\nToque em /)[0] || "").trim() || "💰 *PIX*";
  const intro = `${head}\n\nCopie o código da próxima mensagem (toque e segure → Copiar), abra o app do seu banco em *Pix → Pix Copia e Cola* e cole. 👇`;
  return [intro, code.trim()];
}
