import { supabase } from "@/integrations/supabase/client";

/**
 * Envio padronizado de um PIX (copia e cola) para o cliente no WhatsApp/Instagram.
 *
 * Sequência enviada:
 *  1. (opcional) Imagem do QR code com legenda explicando como pagar pela galeria.
 *  2. Mensagem com valor + botão nativo "Copiar código PIX" (só uazapi). Nos demais
 *     provedores vai um texto de instrução no lugar do botão.
 *  3. O código copia e cola SOZINHO em uma mensagem, sem nada em volta — os bancos
 *     rejeitam o código quando vem misturado com texto/emoji.
 *
 * O componente chamador injeta como cada mensagem é enviada/persistida (cada chat
 * tem seu próprio roteamento por provider/instância).
 */
export interface PixSendChannel {
  /** meta | zapi | uazapi | wasender | instagram | messenger */
  provider: string;
  sendText: (message: string) => Promise<string | null>;
  sendImage: (mediaUrl: string, caption: string) => Promise<string | null>;
  /** Mensagem com botão nativo de copiar. Se ausente/falhar, cai no texto. */
  sendCopyButton?: (message: string, buttonTitle: string, code: string) => Promise<string | null>;
  persist: (row: {
    message: string;
    media_type?: string | null;
    media_url?: string | null;
    message_id: string | null;
  }) => Promise<void>;
}

export interface SendPixOptions {
  channel: PixSendChannel;
  code: string;
  amount: number;
  description?: string | null;
  includeQr: boolean;
  qrBase64?: string | null;
  /** Chave usada no nome do arquivo do QR (ex.: id do pedido). */
  qrKey?: string;
}

export interface SendPixResult {
  sentQr: boolean;
  usedCopyButton: boolean;
}

const fmtBRL = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** Sobe o PNG do QR code (base64 do Mercado Pago) para o bucket público de mídia do chat. */
export async function uploadPixQrPng(base64: string, key: string): Promise<string | null> {
  try {
    const bin = atob(base64.replace(/^data:image\/\w+;base64,/, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "pix";
    const filePath = `chat/pix-${safeKey}-${Date.now()}.png`;
    const { error } = await supabase.storage
      .from("whatsapp-media")
      .upload(filePath, new Blob([bytes], { type: "image/png" }), {
        contentType: "image/png",
        upsert: false,
      });
    if (error) {
      console.error("[sendPix] upload QR falhou:", error);
      return null;
    }
    return supabase.storage.from("whatsapp-media").getPublicUrl(filePath).data.publicUrl;
  } catch (e) {
    console.error("[sendPix] upload QR erro:", e);
    return null;
  }
}

export async function sendPixMessages(opts: SendPixOptions): Promise<SendPixResult> {
  const { channel, amount, includeQr, qrBase64, qrKey } = opts;
  const code = opts.code.trim();
  const desc = opts.description?.trim() ? `\n📝 ${opts.description.trim()}` : "";
  const valor = fmtBRL(amount);

  let sentQr = false;
  let usedCopyButton = false;

  // 1) QR code (opcional)
  if (includeQr && qrBase64) {
    const url = await uploadPixQrPng(qrBase64, qrKey || "pix");
    if (url) {
      const caption =
        `💰 *PIX de ${valor}*${desc}\n\n` +
        `📷 Para pagar com este QR code: salve a imagem, abra o app do seu banco em ` +
        `*Pix → Pagar com QR code* e escolha a imagem da galeria.`;
      const mid = await channel.sendImage(url, caption);
      await channel.persist({ message: caption, media_type: "image", media_url: url, message_id: mid });
      sentQr = true;
    }
  }

  // 2) Valor + botão Copiar (uazapi) ou instrução em texto
  const canButton = channel.provider === "uazapi" && !!channel.sendCopyButton;
  if (canButton) {
    const text =
      `💰 *PIX de ${valor}*${desc}\n\n` +
      `Toque em *Copiar código PIX* aqui embaixo, abra o app do seu banco em ` +
      `*Pix → Pix Copia e Cola* e cole o código. 👇`;
    try {
      const mid = await channel.sendCopyButton!(text, "Copiar código PIX", code);
      await channel.persist({
        message: `${text}\n\n[Botão: Copiar código PIX]\n[PIX_CODE:${code}]`,
        message_id: mid,
      });
      usedCopyButton = true;
    } catch (e) {
      console.warn("[sendPix] botão copiar falhou, caindo para texto:", e);
    }
  }
  if (!usedCopyButton) {
    const intro =
      `💰 *PIX de ${valor}*${desc}\n\n` +
      `👇 O código *copia e cola* vem na *próxima mensagem*. Toque e segure nela, ` +
      `escolha *Copiar* e cole no app do seu banco em *Pix → Pix Copia e Cola*.`;
    const mid = await channel.sendText(intro);
    await channel.persist({ message: intro, message_id: mid });
  }

  // 3) Sem botão nativo, envia o código isolado para facilitar a cópia manual.
  // Quando há botão Copiar, o código já está no próprio botão e não deve ser duplicado no chat.
  if (!usedCopyButton) {
    const codeMid = await channel.sendText(code);
    await channel.persist({ message: code, message_id: codeMid });
  }

  return { sentQr, usedCopyButton };
}

const QR_PREF_KEY = "pix_send_include_qr";
export function getPixIncludeQrPref(): boolean {
  try {
    return localStorage.getItem(QR_PREF_KEY) === "1";
  } catch {
    return false;
  }
}
export function setPixIncludeQrPref(v: boolean) {
  try {
    localStorage.setItem(QR_PREF_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
