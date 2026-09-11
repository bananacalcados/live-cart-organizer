import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Payload broadcasted by the AFTER INSERT / AFTER UPDATE triggers on
 * whatsapp_messages. Kept intentionally minimal to reduce DB CPU. Clients
 * should refetch the actual rows they need from the DB using these identifiers.
 *
 * `event` distingue mensagem NOVA (`wa_msg_insert`) de mudança de status/mídia
 * numa mensagem existente (`wa_msg_update`, ✓✓). Listas de conversas devem
 * ignorar updates — só o chat aberto precisa reagir a eles.
 */
export type WaMessageInsertPayload = {
  id: string;
  phone: string | null;
  whatsapp_number_id: string | null;
  direction: string | null;
  created_at: string;
  event?: "wa_msg_insert" | "wa_msg_update";
  status?: string | null;
  message_id?: string | null;
};

// Singleton channel + listener registry so many components can listen to the
// same broadcast topic ('wa_msg_inserts') without opening duplicate channels.
let sharedChannel: RealtimeChannel | null = null;
const listeners = new Set<(payload: WaMessageInsertPayload) => void>();

function dispatch(payload: WaMessageInsertPayload) {
  listeners.forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      console.error("[wa_msg_inserts] listener error", e);
    }
  });
}

function ensureChannel() {
  if (sharedChannel) return;
  sharedChannel = supabase
    .channel("wa_msg_inserts")
    .on("broadcast", { event: "wa_msg_insert" }, (msg: any) => {
      dispatch({ ...((msg?.payload ?? {}) as WaMessageInsertPayload), event: "wa_msg_insert" });
    })
    .on("broadcast", { event: "wa_msg_update" }, (msg: any) => {
      dispatch({ ...((msg?.payload ?? {}) as WaMessageInsertPayload), event: "wa_msg_update" });
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
  /**
   * Filtro aplicado ANTES do debounce. Eventos que não passam são descartados
   * sem agendar nada — assim uma mensagem de outra loja (ou um ✓✓ de status)
   * não dispara recarga da lista nem "engole" um evento relevante dentro da
   * janela de debounce. Não precisa ser memoizado (usa ref).
   */
  filter?: (payload: WaMessageInsertPayload) => boolean;
}

/**
 * Subscribe to WhatsApp message INSERT broadcasts.
 * The handler does not need to be memoized — we use a ref internally.
 */
export function useWaMessageBroadcast(
  handler: (payload: WaMessageInsertPayload) => void,
  options: UseWaMessageBroadcastOptions = {}
) {
  const { debounceMs = 0, filter } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const debounceRef = useRef(debounceMs);
  debounceRef.current = debounceMs;
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPayload: WaMessageInsertPayload | null = null;

    const fn = (p: WaMessageInsertPayload) => {
      const f = filterRef.current;
      if (f && !f(p)) return;
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
