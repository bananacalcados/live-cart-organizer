import { supabase } from "@/integrations/supabase/client";
import { extractEdgeError } from "@/lib/edgeFunctionError";

/**
 * Envio da mensagem de rastreio (Expedição).
 *
 * Motivo do arquivo: o envio pelo modal de Conferência falhava silenciosamente.
 * A causa real era o `instance-guard` das edge functions devolvendo 409
 * (INSTANCE_MISMATCH) quando a instância escolhida pela expedidora não é a da
 * última mensagem RECEBIDA do cliente. Aqui:
 *  - a escolha da instância é explícita da operadora → enviamos com
 *    `x-force-instance: true`;
 *  - qualquer erro do provedor é propagado com a mensagem real (nada de falha muda).
 */

function extractMessageId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, any>;
  const c =
    d.messageId ??
    d.data?.messageId ??
    d.data?.messageid ??
    d.data?.id ??
    d.data?.message?.messageid ??
    d.data?.message?.id ??
    d.data?.data?.msgId ??
    null;
  return c != null ? String(c) : null;
}

/**
 * Envia o texto de rastreio exclusivamente pela instância UAZAPI escolhida.
 * A validação antes da chamada impede que um ID antigo ou de outro provedor
 * seja desviado silenciosamente para Z-API/Meta.
 */
export async function sendTrackingWhatsApp(opts: {
  phone: string;
  message: string;
  numberId: string;
}): Promise<string | null> {
  const phone = (opts.phone || "").replace(/\D/g, "");
  if (!phone) throw new Error("Cliente sem WhatsApp");
  if (!opts.numberId) throw new Error("Selecione a instância de WhatsApp");

  const { data: num, error: numberError } = await supabase
    .from("whatsapp_numbers_safe")
    .select("id, label, provider, is_active")
    .eq("id", opts.numberId)
    .eq("provider", "uazapi")
    .eq("is_active", true)
    .maybeSingle();

  if (numberError) throw new Error(numberError.message || "Erro ao validar a instância UAZAPI");
  if (!num) throw new Error("A instância UAZAPI selecionada não existe ou está inativa. Selecione outra instância.");

  const { data, error } = await supabase.functions.invoke("uazapi-send-message", {
    body: { phone, message: opts.message, whatsapp_number_id: opts.numberId },
    headers: { "x-force-instance": "true" },
  });

  if (error) throw new Error(await extractEdgeError(error, "Falha no envio da mensagem"));
  if ((data as any)?.error) throw new Error(String((data as any).message || (data as any).error));

  return extractMessageId(data);
}
