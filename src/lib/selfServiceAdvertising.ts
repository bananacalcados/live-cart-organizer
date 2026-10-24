import { supabase } from "@/integrations/supabase/client";
import { captureAttribution, attributionPayload } from "./metaAttribution";
import { initMetaPixel, trackPixelEvent } from "./metaPixel";
import { advertisingChoice, storeAdvertisingChoice, advertisingAllowed, ordinaryAdvertisingAllowed, ensureAdvertisingRegion, currentAdvertisingRegion } from "./selfServiceAdvertisingChoice";
export { advertisingChoice, advertisingAllowed, advertisingRefused, ensureAdvertisingRegion } from "./selfServiceAdvertisingChoice";

export const NOTICE_VERSION = "selfservice-meta-v1";
export const AD_NOTICE = "Autorizo também compartilhar nome, e-mail, WhatsApp, cidade, estado, CEP e identificador interno (com hash) com a Meta para melhorar a medição de compras e anúncios. Posso retirar quando quiser.";
export function advertisingSignals() {
  const choice = advertisingChoice();
  if (choice?.accepted) {
    captureAttribution();
    return { consent_id: choice.id, ...attributionPayload(), client_user_agent: navigator.userAgent, notice_version: NOTICE_VERSION };
  }
  if (ordinaryAdvertisingAllowed()) {
    captureAttribution();
    return { consent_id: null, ordinary_region: currentAdvertisingRegion(), ...attributionPayload(), client_user_agent: navigator.userAgent };
  }
  return { consent_id: choice?.id || null };
}
export async function saveAdvertisingChoice(slug: string, accepted: boolean) {
  const region = advertisingChoice()?.region || (await ensureAdvertisingRegion());
  const { data, error } = await supabase.functions.invoke("live-selfservice", { body: { action: "advertising_choice", slug, consent_id: advertisingChoice()?.id, accepted, region } });
  if (error || !data?.consent_id) throw new Error("Não foi possível salvar sua escolha. Tente novamente.");
  const choice = { id: data.consent_id, accepted, region };
  storeAdvertisingChoice(choice);
  const fbq = (window as any).fbq;
  if (!accepted) fbq?.("consent", "revoke");
  else { initMetaPixel(); (window as any).fbq?.("consent", "grant"); captureAttribution(); }
  window.dispatchEvent(new Event("selfservice-advertising-change"));
  return choice;
}
export function trackSelfservice(event: string, data?: Record<string, unknown>, eventId?: string) {
  if (!advertisingAllowed()) return;
  initMetaPixel(); trackPixelEvent(event, data, eventId ? { eventID: eventId } : undefined);
}
