/**
 * Memória de atribuição da Meta (Etapa 1/2).
 *
 * Guarda, por telefone (E.164 sem "+"), os sinais de clique de anúncio
 * (`fbc`, `fbp`, `ctwa_clid`, `fbclid`) por 90 dias — a janela de clique
 * da Meta. Assim, quando a cliente converte dias depois (link de checkout,
 * PDV, WhatsApp), ainda conseguimos enviar o `fbc` no evento de conversão.
 */

import { normalizeMetaPhone } from "./meta-phone.ts";

/**
 * Formato oficial do cookie `_fbc`: `fb.1.<unix_ms>.<clid>`.
 * Para Click-to-WhatsApp a Meta aceita o `ctwa_clid` nesse mesmo campo.
 */
export function buildFbc(clid: string | null | undefined, clickTimeMs?: number): string | null {
  const id = String(clid ?? "").trim();
  if (!id) return null;
  if (id.startsWith("fb.")) return id; // já é um _fbc completo
  const ts = Number.isFinite(clickTimeMs) && (clickTimeMs as number) > 0 ? Math.floor(clickTimeMs as number) : Date.now();
  return `fb.1.${ts}.${id}`;
}

export interface AttributionSignals {
  phone: string;
  fbc?: string | null;
  fbp?: string | null;
  ctwa_clid?: string | null;
  fbclid?: string | null;
  click_time?: string | null;
  ad_id?: string | null;
  source_url?: string | null;
  origin?: string | null;
  lead_id?: string | null;
}

/** Grava/atualiza os sinais. Nunca lança — atribuição não pode quebrar fluxo. */
export async function saveMetaAttribution(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> },
  s: AttributionSignals,
): Promise<boolean> {
  try {
    const phone = normalizeMetaPhone(s.phone);
    if (!phone || phone.length < 12) return false;

    const hasSignal = !!(s.fbc || s.fbp || s.ctwa_clid || s.fbclid);
    if (!hasSignal) return false;

    const { error } = await supabase.rpc("upsert_meta_attribution", {
      p_phone: phone,
      p_fbc: s.fbc ?? null,
      p_fbp: s.fbp ?? null,
      p_ctwa_clid: s.ctwa_clid ?? null,
      p_fbclid: s.fbclid ?? null,
      p_click_time: s.click_time ?? null,
      p_ad_id: s.ad_id ?? null,
      p_source_url: s.source_url ?? null,
      p_origin: s.origin ?? null,
      p_lead_id: s.lead_id ?? null,
    });
    if (error) {
      console.error("[meta-attr-memory] upsert error:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[meta-attr-memory] exception:", e);
    return false;
  }
}

export interface StoredAttribution {
  fbc: string | null;
  fbp: string | null;
  ctwa_clid: string | null;
  origin: string | null;
  last_seen_at: string | null;
}

/** Lê os sinais guardados e ainda válidos (não expirados) de um telefone. */
export async function getMetaAttribution(
  supabase: any,
  rawPhone: string | null | undefined,
): Promise<StoredAttribution | null> {
  try {
    const phone = normalizeMetaPhone(rawPhone);
    if (!phone) return null;
    const { data, error } = await supabase
      .from("meta_attribution_identities")
      .select("fbc, fbp, ctwa_clid, origin, last_seen_at, expires_at")
      .eq("phone", phone)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return {
      fbc: data.fbc ?? null,
      fbp: data.fbp ?? null,
      ctwa_clid: data.ctwa_clid ?? null,
      origin: data.origin ?? null,
      last_seen_at: data.last_seen_at ?? null,
    };
  } catch (e) {
    console.error("[meta-attr-memory] read exception:", e);
    return null;
  }
}

/** Extrai o `ctwa_clid` de um objeto de referral cru (Meta ou uazapi). */
export function extractCtwaClid(obj: Record<string, unknown> | null | undefined): string | null {
  if (!obj) return null;
  const cand = obj.ctwa_clid ?? obj.ctwaClid ?? (obj as any).ctwa ?? null;
  const v = String(cand ?? "").trim();
  return v || null;
}
