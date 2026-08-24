// Shared sender for automation queue jobs (Etapa 1 — fila de automações).
//
// Both `automation-continue-flow` (first block, sent inline for instant reply)
// and `automation-queue-worker` (all remaining blocks, throttled) use this
// module, so the wire format is identical no matter who sends.

export type AutomationJobPayload =
  | {
      kind: "template";
      templateName: string;
      language?: string;
      components?: unknown[];
    }
  | {
      kind: "text";
      message?: string;
      mediaUrl?: string;
      mediaType?: string;
      type?: string;
    }
  | {
      kind: "interactive";
      body: string;
      buttons: string[];
    };

interface SendCtx {
  supabaseUrl: string;
  serviceKey: string;
  supabase: any;
}

/**
 * Sends one automation payload and persists it in whatsapp_messages.
 * Throws on a non-ok gateway response so the caller can retry / mark failed.
 */
export async function sendAutomationJob(
  ctx: SendCtx,
  phone: string,
  whatsappNumberId: string | null | undefined,
  payload: AutomationJobPayload,
): Promise<void> {
  const { supabaseUrl, serviceKey, supabase } = ctx;
  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  if (payload.kind === "template") {
    const res = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send-template`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        phone,
        templateName: payload.templateName,
        language: payload.language || "pt_BR",
        whatsappNumberId,
        components: payload.components && (payload.components as unknown[]).length > 0
          ? payload.components
          : undefined,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`template send failed (${res.status}): ${txt.slice(0, 400)}`);
    }
    return;
  }

  if (payload.kind === "interactive") {
    const bodyText = payload.body || "👇";
    const res = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        phone,
        type: "interactive",
        whatsappNumberId,
        interactiveData: {
          body: bodyText,
          buttons: payload.buttons.slice(0, 3).map((title, idx) => ({ id: `btn-${idx}`, title })),
        },
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`interactive send failed (${res.status}): ${txt.slice(0, 400)}`);
    }
    await supabase.from("whatsapp_messages").insert({
      phone,
      message: bodyText,
      direction: "outgoing",
      status: "sent",
      whatsapp_number_id: whatsappNumberId || null,
    });
    return;
  }

  // plain text / media block
  const res = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      phone,
      message: payload.message,
      mediaUrl: payload.mediaUrl,
      mediaType: payload.mediaType,
      type: payload.type || (payload.mediaUrl ? payload.mediaType || "document" : "text"),
      whatsappNumberId,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`text send failed (${res.status}): ${txt.slice(0, 400)}`);
  }
  await supabase.from("whatsapp_messages").insert({
    phone,
    message: payload.message || null,
    media_url: payload.mediaUrl || null,
    direction: "outgoing",
    status: "sent",
    whatsapp_number_id: whatsappNumberId || null,
  });
}

/** Errors that must never be retried (config / policy / permanent media issues). */
export function isTerminalSendError(msg: string): boolean {
  return /\((40[0-3]|404)\)|131053|132001|132000|470|131047/.test(msg);
}
