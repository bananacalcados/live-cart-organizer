import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PresenterPairCount {
  size: string;
  total_stock: number;
  pending_pairs: number;
  available_pairs: number;
}
export interface PresenterPairRow { code: string; sizes: PresenterPairCount[] }

/** One read-only event aggregate. Never feeds any sale/size eligibility logic. */
export function usePresenterAvailablePairs(eventId: string, enabled: boolean) {
  const [rows, setRows] = useState<PresenterPairRow[]>([]);
  useEffect(() => {
    setRows([]);
    if (!enabled) return;
    let disposed = false;
    let inFlight = false;
    let lastKey = "";
    const refresh = async () => {
      if (disposed || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const { data, error } = await (supabase as any).rpc("live_presenter_available_pairs", {
          p_event_id: eventId, p_limit: 200, p_offset: 0,
        });
        if (disposed) return;
        const next = error ? [] : (data || []) as PresenterPairRow[];
        const key = JSON.stringify(next);
        if (key !== lastKey) { lastKey = key; setRows(next); }
      } catch {
        if (!disposed && lastKey !== "[]") { lastKey = "[]"; setRows([]); }
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [eventId, enabled]);
  return rows;
}