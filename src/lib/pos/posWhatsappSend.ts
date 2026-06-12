import { supabase } from "@/integrations/supabase/client";

/**
 * Envio de WhatsApp ciente do PROVIDER real da instância (meta | zapi | uazapi | wasender).
 *
 * Motivo: os diálogos do PDV (catálogo, checkout, pix) historicamente só sabiam
 * rotear `zapi` ou `meta`. Quando a instância é uazapi/wasender, o envio caía no
 * `else` e ia para `zapi-send-*` (instância Z-API desconectada) → a mídia/botões
 * não chegavam ao cliente, embora o texto comum (que usa useChatSender, já ciente
 * de provider) chegasse normalmente.
 *
 * Este helper centraliza a rota correta por provider para esses fluxos.
 */

export type PosSendProvider = "meta" | "zapi" | "uazapi" | "wasender";

export interface PosSendButton {
  id: string;
  title: string;
}

function normalizeProvider(p?: string | null): PosSendProvider {
  if (p === "meta" || p === "uazapi" || p === "wasender") return p;
  return "zapi";
}

/**
 * Extrai o message_id real (WhatsApp/uazapi) da resposta das edge functions de envio.
 * Cada provider devolve um formato diferente; aqui normalizamos para uma única string.
 * É ESSENCIAL gravar esse id na linha de whatsapp_messages — sem ele, quando o cliente
 * responde/cita a mensagem, o front não consegue casar a citação (quoted_message_id)
 * com a mensagem original e o balão de resposta não aparece.
 */
function extractMessageId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, any>;
  const candidate =
    d.messageId ??
    d.data?.messageId ??
    d.data?.messageid ??
    d.data?.id ??
    d.data?.message?.messageid ??
    d.data?.message?.id ??
    d.data?.data?.msgId ??
    null;
  return candidate != null ? String(candidate) : null;
}

/** Envia uma mensagem de texto pela rota correta do provider. Retorna o message_id. */
export async function posSendText(opts: {
  provider?: string | null;
  phone: string;
  message: string;
  numberId?: string | null;
}): Promise<string | null> {
  const provider = normalizeProvider(opts.provider);
  const { phone, message, numberId } = opts;

  if (provider === "meta") {
    const { data } = await supabase.functions.invoke("meta-whatsapp-send", {
      body: { phone, message, whatsapp_number_id: numberId },
    });
    return extractMessageId(data);
  }
  const fn =
    provider === "uazapi"
      ? "uazapi-send-message"
      : provider === "wasender"
        ? "wasender-send-message"
        : "zapi-send-message";
  const { data } = await supabase.functions.invoke(fn, {
    body: { phone, message, whatsapp_number_id: numberId },
  });
  return extractMessageId(data);
}

/** Envia uma mídia (imagem/vídeo/documento/áudio) pela rota correta do provider. Retorna o message_id. */
export async function posSendMedia(opts: {
  provider?: string | null;
  phone: string;
  mediaUrl: string;
  mediaType: "image" | "video" | "audio" | "document";
  caption?: string;
  numberId?: string | null;
}): Promise<string | null> {
  const provider = normalizeProvider(opts.provider);
  const { phone, mediaUrl, mediaType, caption, numberId } = opts;

  if (provider === "meta") {
    const { data } = await supabase.functions.invoke("meta-whatsapp-send", {
      body: {
        phone,
        type: mediaType,
        mediaUrl,
        caption,
        whatsapp_number_id: numberId,
      },
    });
    return extractMessageId(data);
  }
  const fn =
    provider === "uazapi"
      ? "uazapi-send-media"
      : provider === "wasender"
        ? "wasender-send-media"
        : "zapi-send-media";
  const { data } = await supabase.functions.invoke(fn, {
    body: { phone, mediaUrl, mediaType, caption, whatsapp_number_id: numberId },
  });
  return extractMessageId(data);
}

/**
 * Envia botões de resposta rápida pela rota correta do provider. Retorna o message_id.
 * - meta: mensagem interativa nativa.
 * - zapi: send-button-list (com ou sem imagem).
 * - uazapi: /send/menu type=button.
 * - wasender: sem suporte nativo confiável → fallback em texto com as opções.
 */
export async function posSendButtons(opts: {
  provider?: string | null;
  phone: string;
  message: string;
  buttons: PosSendButton[];
  imageUrl?: string | null;
  numberId?: string | null;
}): Promise<string | null> {
  const provider = normalizeProvider(opts.provider);
  const { phone, message, buttons, imageUrl, numberId } = opts;

  if (provider === "meta") {
    const { data } = await supabase.functions.invoke("meta-whatsapp-send", {
      body: {
        phone,
        type: "interactive",
        interactiveData: { body: message, buttons },
        whatsapp_number_id: numberId,
      },
    });
    return extractMessageId(data);
  }

  if (provider === "uazapi") {
    const { data } = await supabase.functions.invoke("uazapi-send-buttons", {
      body: { phone, message, buttons, imageUrl, whatsapp_number_id: numberId },
    });
    return extractMessageId(data);
  }

  if (provider === "wasender") {
    // Sem botões nativos confiáveis: envia as opções como texto para garantir entrega.
    const lines = buttons.map((b) => `• ${b.title}`).join("\n");
    const { data } = await supabase.functions.invoke("wasender-send-message", {
      body: { phone, message: `${message}\n\n${lines}`, whatsapp_number_id: numberId },
    });
    return extractMessageId(data);
  }

  // zapi
  const { data } = await supabase.functions.invoke("zapi-send-button-list", {
    body: { phone, message, buttons, imageUrl: imageUrl || undefined, whatsapp_number_id: numberId },
  });
  return extractMessageId(data);
}
