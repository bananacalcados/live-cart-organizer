// Fallback multicanal de entrega.
//
// Quando a Meta falha por motivo NÃO terminal (mídia 131053, throttling pesado,
// cobrança 131042), a mensagem simplesmente não chega — mesmo o número sendo
// válido. Este helper reenvia o MESMO conteúdo em TEXTO por um provider
// secundário (uazapi ou wasender) para não perder o contato.
//
// Regras:
//  - Só texto (sem template/mídia): garante entrega mesmo em pico do storage.
//  - Nunca usa a mesma instância Meta que falhou.
//  - Escolhe a primeira instância ATIVA e ONLINE com provider uazapi/wasender.
//  - Best-effort: qualquer erro aqui NÃO derruba o fluxo do disparo.

let cachedInstance: { id: string; provider: string } | null | undefined;

async function pickFallbackInstance(supabase: any): Promise<{ id: string; provider: string } | null> {
  if (cachedInstance !== undefined) return cachedInstance;
  try {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id, provider, is_online, is_default")
      .in("provider", ["uazapi", "wasender"])
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("is_online", { ascending: false });
    const row = (data || []).find((r: any) => r.is_online !== false) || (data || [])[0] || null;
    cachedInstance = row ? { id: row.id, provider: row.provider } : null;
  } catch (_e) {
    cachedInstance = null;
  }
  return cachedInstance;
}

export interface FallbackResult {
  ok: boolean;
  provider?: string;
  messageId?: string | null;
  error?: string;
}

/** Envia `text` para `phone` por um provider secundário. Retorna ok=false se não houver rota. */
export async function sendTextFallback(
  supabase: any,
  opts: { phone: string; text: string; supabaseUrl: string; serviceKey: string; reason?: string },
): Promise<FallbackResult> {
  const { phone, text, supabaseUrl, serviceKey, reason } = opts;
  if (!phone || !text || !text.trim()) return { ok: false, error: "sem conteúdo" };

  const inst = await pickFallbackInstance(supabase);
  if (!inst) return { ok: false, error: "sem instância de fallback" };

  const fn = inst.provider === "uazapi" ? "uazapi-send-message" : "wasender-send-message";
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "x-force-instance": "true",
      },
      body: JSON.stringify({ phone, message: text, whatsapp_number_id: inst.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      return { ok: false, provider: inst.provider, error: JSON.stringify(data).slice(0, 200) };
    }
    const messageId = data?.messageId || data?.data?.messageid || data?.data?.id || null;

    try {
      await supabase.from("whatsapp_messages").insert({
        phone,
        message: text,
        direction: "outgoing",
        status: "sent",
        message_id: messageId,
        whatsapp_number_id: inst.id,
        source: "broadcast_fallback",
        is_mass_dispatch: true,
      });
    } catch (_e) { /* log é best-effort */ }

    console.log(`[meta-fallback] ${phone} entregue via ${inst.provider} (motivo: ${reason || "n/a"})`);
    return { ok: true, provider: inst.provider, messageId };
  } catch (e) {
    return { ok: false, provider: inst.provider, error: (e as Error).message };
  }
}
