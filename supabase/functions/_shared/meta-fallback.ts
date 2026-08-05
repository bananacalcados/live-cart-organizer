// Fallback multicanal de entrega — DESLIGADO POR PADRÃO.
//
// ATENÇÃO (risco de banimento): providers NÃO oficiais (uazapi/wasender) não
// suportam volume de disparo em massa. Usá-los como fallback automático de um
// lote grande da Meta faz o número ser banido. Por isso:
//
//  - O fallback só roda se `app_settings.key = 'meta_text_fallback_enabled'`
//    estiver explicitamente com valor true (opt-in manual, uso pontual).
//  - Mesmo ligado, existe um teto diário rígido (MAX_PER_DAY) para nunca virar
//    disparo em massa por canal não oficial.
//  - Só texto, nunca a mesma instância Meta que falhou.
//  - Best-effort: qualquer erro aqui NÃO derruba o fluxo do disparo.

const MAX_PER_DAY = 30;

let cachedInstance: { id: string; provider: string } | null | undefined;
let cachedEnabled: { value: boolean; at: number } | null = null;

async function isFallbackEnabled(supabase: any): Promise<boolean> {
  if (cachedEnabled && Date.now() - cachedEnabled.at < 60_000) return cachedEnabled.value;
  let value = false;
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "meta_text_fallback_enabled")
      .order("updated_at", { ascending: false })
      .limit(1);
    const raw = (data || [])[0]?.value;
    value = raw === true || raw === "true" || raw?.enabled === true;
  } catch (_e) {
    value = false;
  }
  cachedEnabled = { value, at: Date.now() };
  return value;
}

async function underDailyCap(supabase: any): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("source", "broadcast_fallback")
      .gte("created_at", since);
    return (count ?? 0) < MAX_PER_DAY;
  } catch (_e) {
    return false; // fail-closed: na dúvida, não arrisca o número
  }
}

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

/**
 * Envia `text` para `phone` por um provider secundário.
 * Retorna ok=false quando desligado, acima do teto diário ou sem rota.
 */
export async function sendTextFallback(
  supabase: any,
  opts: { phone: string; text: string; supabaseUrl: string; serviceKey: string; reason?: string },
): Promise<FallbackResult> {
  const { phone, text, supabaseUrl, serviceKey, reason } = opts;
  if (!phone || !text || !text.trim()) return { ok: false, error: "sem conteúdo" };

  if (!(await isFallbackEnabled(supabase))) {
    return { ok: false, error: "fallback desligado (anti-ban)" };
  }
  if (!(await underDailyCap(supabase))) {
    console.warn("[meta-fallback] teto diário atingido — fallback suspenso (anti-ban)");
    return { ok: false, error: "teto diário de fallback atingido" };
  }

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
