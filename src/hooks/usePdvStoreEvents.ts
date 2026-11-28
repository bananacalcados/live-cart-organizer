import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Domain = "sales_changed" | "live_changed";
type Listener = (event: Domain | "reconnected") => void;
const rooms = new Map<string, { channel: RealtimeChannel; listeners: Set<Listener> }>();

/** One private room/store/tab; bursts coalesce, hidden tabs never fetch, no polling. */
export function usePdvStoreEvents(storeId: string, domain: Domain, refresh: () => void, enabled = true) {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    if (!enabled || !storeId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (document.hidden || timer) return;
      timer = setTimeout(() => { timer = undefined; if (!document.hidden) ref.current(); }, 1000);
    };
    const listener: Listener = (event) => { if (event === domain || event === "reconnected") schedule(); };
    let room = rooms.get(storeId);
    if (!room) {
      const listeners = new Set<Listener>();
      let subscribed = false;
      const openedAt = Date.now();
      const channel = supabase.channel(`pdv-store:${storeId}`, { config: { private: true } })
        .on("broadcast", { event: "sales_changed" }, () => listeners.forEach((fn) => fn("sales_changed")))
        .on("broadcast", { event: "live_changed" }, () => listeners.forEach((fn) => fn("live_changed")))
        .subscribe((status) => {
          if (status !== "SUBSCRIBED") return;
          if (subscribed || Date.now() - openedAt > 10_000) listeners.forEach((fn) => fn("reconnected"));
          subscribed = true;
        });
      room = { channel, listeners };
      rooms.set(storeId, room);
    }
    room.listeners.add(listener);
    const visible = () => { if (!document.hidden) schedule(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      room.listeners.delete(listener);
      if (!room.listeners.size) { void supabase.removeChannel(room.channel); rooms.delete(storeId); }
    };
  }, [storeId, domain, enabled]);
}