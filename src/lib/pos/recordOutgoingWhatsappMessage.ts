import { supabase } from "@/integrations/supabase/client";
import { normalizeBRPhone } from "@/lib/phoneUtils";

export type OutgoingWhatsappMessageInput = {
  phone: string;
  message: string;
  messageId?: string | null;
  numberId?: string | null;
};

export function outgoingWhatsappMessageRow(input: OutgoingWhatsappMessageInput) {
  return {
    phone: normalizeBRPhone(input.phone) || input.phone.replace(/\D/g, ""),
    message: input.message.slice(0, 4000),
    direction: "outgoing",
    status: "sent",
    media_type: "text",
    message_id: input.messageId || null,
    whatsapp_number_id: input.numberId || null,
  };
}

type MessageRow = ReturnType<typeof outgoingWhatsappMessageRow>;
type InsertMessage = (row: MessageRow) => Promise<{ error: { message: string } | null }>;

/** O histórico é best-effort: uma falha aqui nunca desfaz nem derruba um envio concluído. */
export async function recordOutgoingWhatsappMessage(
  input: OutgoingWhatsappMessageInput,
  insertMessage?: InsertMessage,
): Promise<boolean> {
  const row = outgoingWhatsappMessageRow(input);
  try {
    const insert = insertMessage || (async (messageRow: MessageRow) => {
      const { error } = await supabase.from("whatsapp_messages").insert(messageRow as any);
      return { error };
    });
    const { error } = await insert(row);
    if (error) {
      console.warn("[whatsapp] envio concluído, mas o histórico não foi gravado:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[whatsapp] envio concluído, mas o histórico não foi gravado:", error);
    return false;
  }
}
