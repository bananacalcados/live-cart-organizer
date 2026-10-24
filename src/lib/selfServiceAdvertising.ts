import { supabase } from "@/integrations/supabase/client";
import { captureAttribution, attributionPayload } from "./metaAttribution";
import { initMetaPixel, trackPixelEvent } from "./metaPixel";

const KEY = "bc_selfservice_advertising_v1";
export const NOTICE_VERSION = "selfservice-meta-v1";
export const AD_NOTICE = "Opcional: autorizo compartilhar nome, e-mail, WhatsApp, cidade, estado, CEP, identificador interno, IP, navegador e sinais de anúncio com a Meta para medir compras e melhorar anúncios. Posso retirar a autorização em Configurações de privacidade, sem impedir meu cadastro ou compra.";
type Choice = { id: string; accepted: boolean; region: string | null };
let memory: Choice | null = null;
export function advertisingChoice(): Choice | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null") || memory; } catch { return memory; }
}
export function advertisingSignals() {
  const choice = advertisingChoice();
  if (!choice?.accepted) return { consent_id: choice?.id || null };
  captureAttribution();
  return { consent_id: choice.id, ...attributionPayload(), client_user_agent: navigator.userAgent, notice_version: NOTICE_VERSION };
}
export async function saveAdvertisingChoice(slug: string, accepted: boolean) {
  let region: string | null = advertisingChoice()?.region || null;
  if (!region) {
    try {
      const response = await fetch("/cdn-cgi/trace", { signal: AbortSignal.timeout(2000) });
      if (response.ok) region = (await response.text()).match(/^loc=([A-Z]{2})$/m)?.[1] || null;
    } catch { /* unresolved region keeps tracking denied without explicit acceptance */ }
  }
  const { data, error } = await supabase.functions.invoke("live-selfservice", { body: { action: "advertising_choice", slug, consent_id: advertisingChoice()?.id, accepted, region } });
  if (error || !data?.consent_id) throw new Error("Não foi possível salvar sua escolha. Tente novamente.");
  memory = { id: data.consent_id, accepted, region };
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* checkout independent of storage */ }
  const fbq = (window as any).fbq;
  if (!accepted) fbq?.("consent", "revoke");
  else { initMetaPixel(); (window as any).fbq?.("consent", "grant"); captureAttribution(); }
  window.dispatchEvent(new Event("selfservice-advertising-change"));
  return memory;
}
export function trackSelfservice(event: string, data?: Record<string, unknown>, eventId?: string) {
  if (!advertisingChoice()?.accepted) return;
  initMetaPixel(); trackPixelEvent(event, data, eventId ? { eventID: eventId } : undefined);
}