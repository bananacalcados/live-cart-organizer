import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Credenciais e helpers da integração uazapi (uazapiGO v2).
 *
 * Modelo de autenticação:
 *  - Servidor: cada conta tem um subdomínio próprio (ex.: https://banana.uazapi.com),
 *    guardado no secret UAZAPI_SUBDOMAIN. Essa é a BASE URL de TODAS as chamadas.
 *  - Admin Token (UAZAPI_ADMIN_TOKEN): token mestre do servidor. Header `admintoken`.
 *    Usado SÓ para criar instâncias.
 *  - Instance Token: gerado por instância no /instance/create. Header `token`.
 *    Usado para conectar, status, enviar mensagens, configurar webhook, etc.
 */

/** Base URL do servidor uazapi (sem barra final). */
export function getUazapiBase(): string {
  const raw = Deno.env.get("UAZAPI_SUBDOMAIN");
  if (!raw) throw new Error("UAZAPI_SUBDOMAIN não configurado");
  let base = raw.trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/+$/, "");
}

/** Admin Token do servidor uazapi (gerência de instâncias). */
export function getUazapiAdminToken(): string {
  const t = Deno.env.get("UAZAPI_ADMIN_TOKEN");
  if (!t) throw new Error("UAZAPI_ADMIN_TOKEN não configurado");
  return t;
}

export function getServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey);
}

interface UazapiResult {
  ok: boolean;
  status: number;
  data: any;
}

async function call(
  path: string,
  headers: Record<string, string>,
  init: { method?: string; body?: unknown } = {},
): Promise<UazapiResult> {
  const res = await fetch(`${getUazapiBase()}${path}`, {
    method: init.method || "GET",
    headers: { "Content-Type": "application/json", ...headers },
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

/** Chamada autenticada com o Admin Token (criar instância). */
export function uazapiAdmin(path: string, init: { method?: string; body?: unknown } = {}) {
  return call(path, { admintoken: getUazapiAdminToken() }, init);
}

/** Chamada autenticada com o Instance Token. */
export function uazapiInstance(
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
) {
  return call(path, { token }, init);
}

/**
 * Formata o destino para o formato aceito pela uazapi no campo `number`.
 * - Grupos (JID @g.us, sufixo -group ou ID que começa com 120) → `<id>@g.us`.
 * - JIDs completos são mantidos.
 * - Telefones individuais → dígitos com DDI 55 (BR) quando vier sem código de país.
 */
export function formatUazapiNumber(target: string): string {
  if (!target) return target;
  if (target.includes("@")) return target;
  const digits = target.replace(/\D/g, "");
  const isGroup = target.endsWith("-group") || /^120\d{5,}$/.test(digits);
  if (isGroup) return `${digits}@g.us`;
  let phone = digits;
  if (phone.length >= 10 && phone.length <= 11) phone = "55" + phone;
  return phone;
}

export interface UazapiSendCreds {
  token: string;
}

/** Resolve o Instance Token a partir do whatsapp_number_id. */
export async function resolveUazapiCredentials(
  whatsappNumberId?: string | null,
): Promise<UazapiSendCreds> {
  const supabase = getServiceClient();

  if (whatsappNumberId) {
    const { data, error } = await supabase
      .from("whatsapp_numbers")
      .select("uazapi_token")
      .eq("id", whatsappNumberId)
      .eq("provider", "uazapi")
      .single();
    if (!error && data?.uazapi_token) {
      return { token: data.uazapi_token };
    }
    console.warn(`Não foi possível resolver credenciais uazapi para whatsapp_number_id=${whatsappNumberId}`);
  }

  // Fallback: única instância uazapi ativa
  const { data: actives } = await supabase
    .from("whatsapp_numbers")
    .select("uazapi_token")
    .eq("provider", "uazapi")
    .eq("is_active", true)
    .limit(2);

  if (actives?.length === 1 && actives[0].uazapi_token) {
    return { token: actives[0].uazapi_token };
  }
  if ((actives?.length ?? 0) > 1) {
    throw new Error("Rota uazapi ambígua: whatsapp_number_id é obrigatório quando há múltiplas instâncias ativas");
  }
  throw new Error("Credenciais uazapi não configuradas");
}

const MEDIA_EXT: Record<string, string> = {
  image: "jpg",
  video: "mp4",
  audio: "ogg",
  document: "bin",
  sticker: "webp",
};

/**
 * Re-hospeda mídia recebida (a fileURL da uazapi pode expirar) no bucket
 * público `whatsapp-media`, devolvendo uma URL permanente. Fallback: URL original.
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

    let ext = MEDIA_EXT[mediaType] || "bin";
    if (hintFileName && hintFileName.includes(".")) {
      ext = hintFileName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") || ext;
    } else {
      const ctExt = contentType.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/g, "");
      if (ctExt) ext = ctExt;
    }

    const path = `uazapi/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const supabase = getServiceClient();
    const { error } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, buf, { contentType, upsert: false });
    if (error) {
      console.error("[uazapi rehostMedia] upload falhou:", error.message);
      return tempUrl;
    }
    const { data } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
    return data?.publicUrl || tempUrl;
  } catch (e) {
    console.error("[uazapi rehostMedia] erro:", (e as Error).message);
    return tempUrl;
  }
}
