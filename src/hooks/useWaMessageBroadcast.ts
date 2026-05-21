import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

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
      listeners.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error("[wa_msg_inserts] listener error", e);
        }
      });
    })
    .subscribe();
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
