import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Base URL da WasenderAPI.
 */
export const WASENDER_BASE = "https://www.wasenderapi.com/api";

/**
 * Normaliza um destino (telefone OU grupo) para um JID WhatsApp válido,
 * que é o formato exigido pela WaSender no campo `to`.
 *
 * - Grupos no formato Z-API (`120363...-group`) ou IDs de grupo crus que começam
 *   com `120` viram `120363...@g.us`.
 * - JIDs já completos (contêm `@`) são mantidos.
 * - Telefones individuais são normalizados para dígitos com DDI 55 (BR).
 *
 * Sem isso a WaSender rejeita o envio com:
 *   "The to must be a valid WhatsApp JID (User, Group, or Channel format)."
 */
export function formatWasenderJid(target: string): string {
  if (!target) return target;

  // Já é um JID completo (grupo @g.us, usuário @s.whatsapp.net, canal, etc.)
  if (target.includes("@")) return target;

  const digits = target.replace(/\D/g, "");

  // Grupo: sufixo "-group" (formato Z-API) ou ID de grupo cru (começa com 120)
  const isGroup = target.endsWith("-group") || /^120\d{5,}$/.test(digits);
  if (isGroup) {
    return `${digits}@g.us`;
  }

  // Telefone individual: garante DDI 55 para números BR sem código de país
  let phone = digits;
  if (phone.length >= 10 && phone.length <= 11) phone = "55" + phone;
  return phone;
}

/**
 * Personal Access Token (PAT) global da conta WaSender.
 * Usado para gerenciar sessões (criar/conectar/qrcode/status/excluir).
 */
export function getWasenderPAT(): string {
  const pat = Deno.env.get("WASENDER_API_TOKEN");
  if (!pat) throw new Error("WASENDER_API_TOKEN não configurado");
  return pat;
}

export function getServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey);
}

const MEDIA_EXT: Record<string, string> = {
  image: "jpg",
  video: "mp4",
  audio: "ogg",
  document: "bin",
  sticker: "webp",
};

/**
 * Baixa a mídia de uma URL temporária da WaSender (válida ~1h) e re-hospeda
 * no bucket público `whatsapp-media`, devolvendo uma URL permanente.
 * Em caso de falha, devolve a URL original como fallback.
 */
export async function rehostMedia(
  tempUrl: string,
  mediaType: string,
  hintFileName?: string | null,
): Promise<string> {
  try {
    const res = await fetch(tempUrl);
    if (!res.ok) return tempUrl;
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) return tempUrl;

    // Extensão: tenta pelo fileName, depois pelo tipo
    let ext = MEDIA_EXT[mediaType] || "bin";
    if (hintFileName && hintFileName.includes(".")) {
      ext = hintFileName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") || ext;
    } else {
      const ctExt = contentType.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/g, "");
      if (ctExt) ext = ctExt;
    }

    const path = `wasender/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const supabase = getServiceClient();
    const { error } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, buf, { contentType, upsert: false });
    if (error) {
      console.error("[rehostMedia] upload falhou:", error.message);
      return tempUrl;
    }
    const { data } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
    return data?.publicUrl || tempUrl;
  } catch (e) {
    console.error("[rehostMedia] erro:", (e as Error).message);
    return tempUrl;
  }
}

export interface WasenderSendCreds {
  /** API key da sessão (Bearer) usada para enviar mensagens. */
  apiKey: string;
  /** ID da sessão WaSender. */
  sessionId: number | null;
}

/**
 * Resolve a API key de envio da sessão WaSender a partir do whatsapp_number_id.
 */
export async function resolveWasenderCredentials(
  whatsappNumberId?: string | null,
): Promise<WasenderSendCreds> {
  const supabase = getServiceClient();

  if (whatsappNumberId) {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("wasender_api_key, wasender_session_id")
      .eq("id", whatsappNumberId)
      .eq("provider", "wasender")
      .eq("is_active", true)
      .maybeSingle();

    if (data?.wasender_api_key) {
      return { apiKey: data.wasender_api_key, sessionId: data.wasender_session_id ?? null };
    }
    // Explicit instance requested but inactive/not found → fail instead of using
    // default. NEVER silently fall back: that would send via the wrong number.
    throw new Error(`Instância WaSender ${whatsappNumberId} não encontrada ou inativa — envio cancelado para evitar número errado.`);
  }

  // Fallback: única instância wasender ativa
  const { data: actives } = await supabase
    .from("whatsapp_numbers")
    .select("wasender_api_key, wasender_session_id")
    .eq("provider", "wasender")
    .eq("is_active", true)
    .limit(2);

  if (actives?.length === 1 && actives[0].wasender_api_key) {
    return { apiKey: actives[0].wasender_api_key, sessionId: actives[0].wasender_session_id ?? null };
  }
  if ((actives?.length ?? 0) > 1) {
    throw new Error("Rota WaSender ambígua: whatsapp_number_id é obrigatório quando há múltiplas instâncias ativas");
  }

  throw new Error("Credenciais WaSender não configuradas");
}

/**
 * Chamada autenticada com o PAT (gerência de sessões).
 */
export async function wasenderPAT(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${WASENDER_BASE}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${getWasenderPAT()}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}
