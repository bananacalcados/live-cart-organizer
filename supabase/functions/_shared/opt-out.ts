// opt-out.ts — Etapa 3 do motor anti-spam das automações.
//
// Descadastro REAL: quando o cliente responde "PARAR" (ou variações), gravamos em
// public.automation_opt_outs. A chave de match é DDD + 8 dígitos finais (mesma do
// blocked-guard), portanto o descadastro vale para TODAS as nossas instâncias —
// disparo em massa, automações de botão e nutrição param imediatamente.
//
// Importante: opt-out NÃO bloqueia o contato no WhatsApp e NÃO impede atendimento
// humano. Ele apenas suprime QUALQUER envio proativo automático.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { phoneKey } from "./blocked-guard.ts";

type SupabaseClient = ReturnType<typeof createClient>;

/** Palavras/frases que caracterizam pedido de descadastro. */
const OPT_OUT_PATTERNS: RegExp[] = [
  /^\s*parar\s*$/i,
  /^\s*pare\s*$/i,
  /^\s*sair\s*$/i,
  /^\s*stop\s*$/i,
  /^\s*cancelar\s*$/i,
  /^\s*descadastrar\s*$/i,
  /^\s*remover\s*$/i,
  /\bn[ãa]o\s+quero\s+(mais\s+)?receber\b/i,
  /\bn[ãa]o\s+me\s+mand[ea]\s+mais\b/i,
  /\bpar[ea]\s+de\s+(me\s+)?mandar\b/i,
  /\bme\s+(tir[ea]|remov[ea])\s+d[ao]s?\s+(lista|grupo|disparos?)\b/i,
  /\bdescadastr(ar|e|em)\b/i,
  /\bsair\s+da\s+lista\b/i,
  /\bcancelar\s+(as\s+)?(mensagens|promo[çc][õo]es)\b/i,
];

/** Detecta pedido de descadastro no texto recebido. Retorna a palavra-chave achada. */
export function detectOptOut(text: string | null | undefined): string | null {
  const t = (text || "").trim();
  if (!t || t.length > 200) return null; // textos longos não são comando
  for (const p of OPT_OUT_PATTERNS) {
    const m = t.match(p);
    if (m) return (m[0] || t).trim().slice(0, 60);
  }
  return null;
}

/** Registra o descadastro (idempotente por chave de telefone). */
export async function registerOptOut(
  supabase: SupabaseClient,
  phone: string,
  opts: { keyword?: string | null; whatsappNumberId?: string | null; source?: string } = {},
): Promise<boolean> {
  const key = phoneKey(phone);
  if (!key) return false;
  try {
    const { error } = await supabase.from("automation_opt_outs").upsert(
      {
        phone,
        keyword: opts.keyword ?? null,
        whatsapp_number_id: opts.whatsappNumberId ?? null,
        source: opts.source ?? "keyword",
      },
      { onConflict: "phone_key" },
    );
    if (error) {
      console.error("[opt-out] falha ao registrar:", error.message);
      return false;
    }
    console.log(`[opt-out] contato descadastrado (${key}) via "${opts.keyword ?? "manual"}"`);
    return true;
  } catch (e) {
    console.error("[opt-out] exceção ao registrar:", e);
    return false;
  }
}

/** Verifica descadastro cross-instância para um telefone. Fail-open. */
export async function isOptedOut(
  supabase: SupabaseClient,
  phone: string | null | undefined,
): Promise<boolean> {
  const key = phoneKey(phone);
  if (!key) return false;
  try {
    const { data, error } = await supabase
      .from("automation_opt_outs")
      .select("id")
      .eq("phone_key", key)
      .limit(1);
    if (error) return false;
    return !!data && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Detecta + registra em uma tacada. Retorna true quando o contato pediu para parar
 * (ou seja: o chamador deve interromper automações para esse telefone).
 */
export async function handleIncomingOptOut(
  supabase: SupabaseClient,
  phone: string,
  messageText: string | null | undefined,
  whatsappNumberId?: string | null,
): Promise<{ optedOut: boolean; keyword: string | null }> {
  const keyword = detectOptOut(messageText);
  if (!keyword) return { optedOut: false, keyword: null };
  await registerOptOut(supabase, phone, { keyword, whatsappNumberId, source: "keyword" });

  // Pausa automações em andamento e limpa a fila pendente desse contato.
  try {
    await supabase
      .from("automation_message_queue")
      .update({ status: "skipped", skip_reason: "opt_out", last_error: "cliente pediu para parar" })
      .eq("phone", phone)
      .eq("status", "pending");
  } catch (_e) { /* noop */ }
  try {
    await supabase
      .from("automation_ai_sessions")
      .update({ is_active: false })
      .eq("phone", phone)
      .eq("is_active", true);
  } catch (_e) { /* noop */ }

  return { optedOut: true, keyword };
}
