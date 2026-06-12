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
    .on("broadcast", { event: "wa_msg_update" }, (msg: any) => {
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

export interface UseWaMessageBroadcastOptions {
  /**
   * Coalesce bursts of broadcasts: instead of running the handler on every
   * event, wait this many ms of "silence" and then fire ONCE with the most
   * recent payload. Use for heavy list refreshers (get_conversations) so a
   * burst of inserts triggers a single reload instead of dozens.
   *
   * Default 0 = fire immediately on every event (original behavior). Keep 0
   * for the currently-open chat so client replies appear instantly.
   *
   * NOTE: no message is ever lost — rows are always persisted in the DB. The
   * debounce only delays the UI refresh by up to `debounceMs`.
   */
  debounceMs?: number;
}

/**
 * Subscribe to WhatsApp message INSERT broadcasts.
 * The handler does not need to be memoized — we use a ref internally.
 */
export function useWaMessageBroadcast(
  handler: (payload: WaMessageInsertPayload) => void,
  options: UseWaMessageBroadcastOptions = {}
) {
  const { debounceMs = 0 } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const debounceRef = useRef(debounceMs);
  debounceRef.current = debounceMs;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPayload: WaMessageInsertPayload | null = null;

    const fn = (p: WaMessageInsertPayload) => {
      const ms = debounceRef.current;
      if (!ms || ms <= 0) {
        handlerRef.current(p);
        return;
      }
      lastPayload = p;
      if (timer) return; // already scheduled within this window
      timer = setTimeout(() => {
        timer = null;
        const payload = lastPayload;
        lastPayload = null;
        if (payload) handlerRef.current(payload);
      }, ms);
    };

    listeners.add(fn);
    ensureChannel();
    return () => {
      if (timer) clearTimeout(timer);
      listeners.delete(fn);
      teardownIfIdle();
    };
  }, []);
}
