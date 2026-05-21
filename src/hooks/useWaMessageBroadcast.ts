import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";

// Mapa local de nomes amigáveis das instâncias (debug temp)
const INSTANCE_LABELS: Record<string, string> = {
  "820ce69b-43f7-4ae2-99c5-fdc0b77def5e": "Zapi Centro",
  "72e1beb5-8b35-4158-8ae0-3e9efa306de0": "Zapi Pérola",
  "ae453235-50e1-4ef6-8a87-8c8a77b2b440": "Meta Pérola",
  "c01d2777-df4c-4746-9433-d8c97c57d529": "Meta Centro",
  "adaa3859-3123-47d6-9e98-47a9ae616c8c": "Zoppy",
  "e3e971ee-cd93-4420-8b2e-c80ecfc1a48d": "Banana",
  "08168ac6-eda8-4676-b918-d56c3642fc7b": "Datacrazy",
  "0ba63cd9-2c14-41e3-91ef-6291c5396014": "Ravena",
};

/**
 * Payload broadcasted by the AFTER INSERT trigger on whatsapp_messages.
 * Kept intentionally minimal to reduce DB CPU. Clients should refetch
 * the actual rows they need from the DB using these identifiers.
 */
export type WaMessageInsertPayload = {
  id: string;
  phone: string | null;
  whatsapp_number_id: string | null;
  direction: string | null;
  created_at: string;
};

// Singleton channel + listener registry so many components can listen to the
// same broadcast topic ('wa_msg_inserts') without opening duplicate channels.
let sharedChannel: RealtimeChannel | null = null;
const listeners = new Set<(payload: WaMessageInsertPayload) => void>();

function ensureChannel() {
  if (sharedChannel) return;
  sharedChannel = supabase
    .channel("wa_msg_inserts")
    .on("broadcast", { event: "wa_msg_insert" }, (msg: any) => {
      const payload = (msg?.payload ?? {}) as WaMessageInsertPayload;
      // TEMP DEBUG visual — remover após validar Meta Centro
      const instanceLabel = payload.whatsapp_number_id
        ? INSTANCE_LABELS[payload.whatsapp_number_id] || payload.whatsapp_number_id.slice(0, 8)
        : "sem-instância";
      toast.success(`📨 Broadcast: ${instanceLabel}`, {
        description: `${payload.direction} • ${payload.phone?.slice(-8) ?? "?"}`,
        duration: 4000,
      });
      console.log("[wa_msg_inserts] broadcast received", payload);
      listeners.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error("[wa_msg_inserts] listener error", e);
        }
      });
    })
    .subscribe((status) => {
      console.log("[wa_msg_inserts] channel status:", status);
      if (status === "SUBSCRIBED") {
        toast.info("🟢 Canal broadcast conectado", { duration: 2500 });
      }
    });
}

function teardownIfIdle() {
  if (listeners.size === 0 && sharedChannel) {
    supabase.removeChannel(sharedChannel);
    sharedChannel = null;
  }
}

/**
 * Subscribe to WhatsApp message INSERT broadcasts.
 * The handler does not need to be memoized — we use a ref internally.
 */
export function useWaMessageBroadcast(
  handler: (payload: WaMessageInsertPayload) => void
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const fn = (p: WaMessageInsertPayload) => handlerRef.current(p);
    listeners.add(fn);
    ensureChannel();
    return () => {
      listeners.delete(fn);
      teardownIfIdle();
    };
  }, []);
}
