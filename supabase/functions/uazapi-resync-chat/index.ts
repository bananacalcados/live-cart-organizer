import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveUazapiCredentials, uazapiInstance } from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AnyObj = Record<string, unknown>;

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v == null) return null;
  return String(v);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Mapeia o mediaType/messageType da uazapi para o tipo genérico do sistema.
 * Tolera tanto os valores curtos ("image") quanto os nomes do baileys
 * ("ImageMessage", "AudioMessage", etc.) e mensagens de texto.
 */
function mapMediaType(t: string | null): string | null {
  const s = (t || "").toLowerCase();
  if (!s) return null;
  if (s.includes("image")) return "image";
  if (s.includes("video")) return "video";
  if (s.includes("audio") || s === "ptt" || s.includes("ptt")) return "audio";
  if (s.includes("sticker")) return "image";
  if (s.includes("document")) return "document";
  // ExtendedTextMessage / Conversation / text → não é mídia
  return null;
}

/**
 * Normaliza um telefone BR para E.164 com o 9º dígito (padrão do projeto),
 * igual ao normalizeJid usado no uazapi-webhook.
 */
function normalizeBRDigits(raw: string): string {
  let digits = (raw || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 11) digits = "55" + digits;
  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.substring(2, 4);
    const number = digits.substring(4);
    digits = "55" + ddd + "9" + number;
  }
  return digits;
}

/**
 * Variantes de dígitos para casar com/sem o 9º dígito (BR). Mesma lógica do
 * ownerVariants do uazapi-webhook.
 */
function phoneDigitVariants(raw: string): string[] {
  const digits = normalizeBRDigits(raw);
  const variants = new Set<string>([digits]);
  if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    variants.add(digits.slice(0, 4) + digits.slice(5)); // sem 9
  }
  if (digits.startsWith("55") && digits.length === 12) {
    variants.add(digits.slice(0, 4) + "9" + digits.slice(4)); // com 9
  }
  return [...variants];
}

/** Monta os chatids candidatos no formato uazapi (todas as variantes do 9º dígito). */
function chatidVariants(raw: string): string[] {
  return phoneDigitVariants(raw).map((d) => `${d}@s.whatsapp.net`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as AnyObj;
    const phone = asString(body.phone);
    const whatsappNumberId = asString(body.whatsapp_number_id);
    const limit = Number(body.limit ?? 50) || 50;
    const dryRun = body.dryRun === undefined ? true : Boolean(body.dryRun);

    if (!phone) return json({ error: "phone é obrigatório" }, 400);
    if (!whatsappNumberId) return json({ error: "whatsapp_number_id é obrigatório" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Credenciais da instância
    const { token } = await resolveUazapiCredentials(whatsappNumberId);

    // 2. chatid + variantes do 9º dígito
    const normalizedPhone = normalizeBRDigits(phone);
    const candidates = chatidVariants(phone);

    // 3. Buscar mensagens recentes via /message/find (tenta cada variante de chatid
    //    até obter resultados).
    let rawMessages: AnyObj[] = [];
    let usedChatid: string | null = null;
    let firstRawResponse: unknown = null;

    for (const chatid of candidates) {
      const r = await uazapiInstance("/message/find", token, {
        method: "POST",
        body: { chatid, limit },
      });
      if (firstRawResponse === null) firstRawResponse = r.data;
      // O formato pode variar: array direto, ou { messages: [...] }, ou { data: [...] }
      const arr: AnyObj[] = Array.isArray(r.data)
        ? (r.data as AnyObj[])
        : Array.isArray((r.data as AnyObj)?.messages)
          ? ((r.data as AnyObj).messages as AnyObj[])
          : Array.isArray((r.data as AnyObj)?.data)
            ? ((r.data as AnyObj).data as AnyObj[])
            : [];
      if (arr.length > 0) {
        rawMessages = arr;
        usedChatid = chatid;
        break;
      }
    }

    // IMPORTANTE: log da resposta bruta COMPLETA de UMA mensagem para validar o formato real.
    console.log(
      "[uazapi-resync-chat] RAW first response sample:",
      JSON.stringify(firstRawResponse, null, 2)?.slice(0, 6000),
    );
    if (rawMessages.length > 0) {
      console.log(
        "[uazapi-resync-chat] RAW single message sample:",
        JSON.stringify(rawMessages[0], null, 2),
      );
    }

    // Helper: extrai os campos tolerando variações de nomes.
    const extract = (m: AnyObj) => {
      const ids = [
        asString(m.messageid),
        asString(m.id),
        asString((m.key as AnyObj)?.id),
        asString(m.message_id),
      ].filter(Boolean) as string[];
      const fromMe = Boolean(
        m.fromMe ?? m.fromme ?? (m.key as AnyObj)?.fromMe ?? false,
      );
      const tsRaw =
        m.messageTimestamp ?? m.timestamp ?? m.messageTimestampMs ?? m.t ?? m.date ?? null;
      let tsMs: number | null = null;
      if (tsRaw != null) {
        const n = Number(tsRaw);
        if (!Number.isNaN(n)) tsMs = n > 1e12 ? n : n * 1000; // segundos → ms
        else {
          const d = Date.parse(String(tsRaw));
          if (!Number.isNaN(d)) tsMs = d;
        }
      }
      const uazMediaType =
        asString(m.mediaType) || asString(m.messageType) || asString(m.type);
      const sysMediaType = mapMediaType(uazMediaType);
      const content = (typeof m.content === "object" ? (m.content as AnyObj) : {}) || {};
      const text =
        asString(m.text) ||
        asString(m.body) ||
        asString(m.caption) ||
        asString(content.text) ||
        asString(content.caption) ||
        "";
      const statusRaw = asString(m.status);
      return { ids, fromMe, tsMs, sysMediaType, text, statusRaw };
    };

    const mapped = rawMessages.map(extract).filter((x) => x.ids.length > 0);

    // 4. Verificar quais já existem no banco (por qualquer variante de id).
    const allIds = [...new Set(mapped.flatMap((x) => x.ids))];
    const existingIds = new Set<string>();
    if (allIds.length > 0) {
      const { data: existing } = await supabase
        .from("whatsapp_messages")
        .select("message_id")
        .in("message_id", allIds);
      for (const row of existing || []) {
        const mid = asString((row as AnyObj).message_id);
        if (mid) existingIds.add(mid);
      }
    }

    const missing = mapped.filter((x) => !x.ids.some((id) => existingIds.has(id)));
    const alreadyExisting = mapped.length - missing.length;

    const report = {
      phone: normalizedPhone,
      whatsapp_number_id: whatsappNumberId,
      used_chatid: usedChatid,
      tried_chatids: candidates,
      dryRun,
      total_found_uazapi: mapped.length,
      total_already_existing: alreadyExisting,
      total_missing: missing.length,
      missing: missing.map((x) => ({
        message_id: x.ids[0],
        fromMe: x.fromMe,
        timestamp: x.tsMs ? new Date(x.tsMs).toISOString() : null,
        preview: (x.text || "").slice(0, 60),
        tipo: x.sysMediaType || "text",
      })),
      inserted: [] as AnyObj[],
    };

    // 5. dryRun=true → não insere nada.
    if (dryRun) {
      return json(report);
    }

    // 5b. dryRun=false → insere as faltantes preservando created_at original.
    //     Sem auto-reply nem roteamento (apenas persistência), sem baixar mídia.
    for (const x of missing) {
      const fallbackStatus = x.fromMe ? "sent" : "received";
      let status = fallbackStatus;
      if (x.statusRaw) {
        const { data: norm } = await supabase.rpc("normalize_wa_status", {
          p_status: x.statusRaw,
        });
        if (typeof norm === "string" && norm) status = norm;
      }
      const displayMessage =
        x.text || (x.sysMediaType ? `📎 ${x.sysMediaType}` : "");
      if (!displayMessage) continue;

      const insertRow: AnyObj = {
        phone: normalizedPhone,
        message: displayMessage,
        direction: x.fromMe ? "outgoing" : "incoming",
        message_id: x.ids[0],
        status,
        whatsapp_number_id: whatsappNumberId,
        channel: "whatsapp",
        source: "resync",
        created_at: x.tsMs ? new Date(x.tsMs).toISOString() : new Date().toISOString(),
        ...(x.sysMediaType ? { media_type: x.sysMediaType, media_url: null } : {}),
      };

      const { error: insErr } = await supabase
        .from("whatsapp_messages")
        .insert(insertRow);
      if (insErr) {
        if ((insErr as AnyObj).code === "23505") continue; // dedup
        console.error("[uazapi-resync-chat] erro ao inserir:", insErr);
        continue;
      }
      report.inserted.push({
        message_id: x.ids[0],
        direction: insertRow.direction,
        timestamp: insertRow.created_at,
        tipo: x.sysMediaType || "text",
      });
    }

    return json(report);
  } catch (e) {
    console.error("[uazapi-resync-chat] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
