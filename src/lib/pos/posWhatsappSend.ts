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

/** Envia uma mensagem de texto pela rota correta do provider. */
export async function posSendText(opts: {
  provider?: string | null;
  phone: string;
  message: string;
  numberId?: string | null;
}): Promise<void> {
  const provider = normalizeProvider(opts.provider);
  const { phone, message, numberId } = opts;

  if (provider === "meta") {
    await supabase.functions.invoke("meta-whatsapp-send", {
      body: { phone, message, whatsapp_number_id: numberId },
    });
    return;
  }
  const fn =
    provider === "uazapi"
      ? "uazapi-send-message"
      : provider === "wasender"
        ? "wasender-send-message"
        : "zapi-send-message";
  await supabase.functions.invoke(fn, {
    body: { phone, message, whatsapp_number_id: numberId },
  });
}

/** Envia uma mídia (imagem/vídeo/documento/áudio) pela rota correta do provider. */
export async function posSendMedia(opts: {
  provider?: string | null;
  phone: string;
  mediaUrl: string;
  mediaType: "image" | "video" | "audio" | "document";
  caption?: string;
  numberId?: string | null;
}): Promise<void> {
  const provider = normalizeProvider(opts.provider);
  const { phone, mediaUrl, mediaType, caption, numberId } = opts;

  if (provider === "meta") {
    await supabase.functions.invoke("meta-whatsapp-send", {
      body: {
        phone,
        type: mediaType,
        mediaUrl,
        caption,
        whatsapp_number_id: numberId,
      },
    });
    return;
  }
  const fn =
    provider === "uazapi"
      ? "uazapi-send-media"
      : provider === "wasender"
        ? "wasender-send-media"
        : "zapi-send-media";
  await supabase.functions.invoke(fn, {
    body: { phone, mediaUrl, mediaType, caption, whatsapp_number_id: numberId },
  });
}

/**
 * Envia botões de resposta rápida pela rota correta do provider.
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
}): Promise<void> {
  const provider = normalizeProvider(opts.provider);
  const { phone, message, buttons, imageUrl, numberId } = opts;

  if (provider === "meta") {
    await supabase.functions.invoke("meta-whatsapp-send", {
      body: {
        phone,
        type: "interactive",
        interactiveData: { body: message, buttons },
        whatsapp_number_id: numberId,
      },
    });
    return;
  }

  if (provider === "uazapi") {
    await supabase.functions.invoke("uazapi-send-buttons", {
      body: { phone, message, buttons, imageUrl, whatsapp_number_id: numberId },
    });
    return;
  }

  if (provider === "wasender") {
    // Sem botões nativos confiáveis: envia as opções como texto para garantir entrega.
    const lines = buttons.map((b) => `• ${b.title}`).join("\n");
    await supabase.functions.invoke("wasender-send-message", {
      body: { phone, message: `${message}\n\n${lines}`, whatsapp_number_id: numberId },
    });
    return;
  }

  // zapi
  await supabase.functions.invoke("zapi-send-button-list", {
    body: { phone, message, buttons, imageUrl: imageUrl || undefined, whatsapp_number_id: numberId },
  });
}
