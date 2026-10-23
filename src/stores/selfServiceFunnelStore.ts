import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { isSelfServiceMode } from "@/lib/liveModes";

/**
 * Funil da página de autoatendimento por evento (1 carga por evento, no máximo
 * a cada 60 s). Usado pelos selos de estágio na Central e na apresentadora.
 */
interface FunnelState {
  eventId: string | null;
  isSelfService: boolean;
  minutes: number;
  viewedKeys: Set<string>;
  loadedAt: number;
  loading: boolean;
  load: (eventId: string, force?: boolean) => Promise<void>;
}

/** DDD + 8 últimos dígitos (mesma chave do /zap). */
export function phoneKeyOf(phone?: string | null): string | null {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

export const useSelfServiceFunnelStore = create<FunnelState>((set, get) => ({
  eventId: null,
  isSelfService: false,
  minutes: 5,
  viewedKeys: new Set(),
  loadedAt: 0,
  loading: false,
  load: async (eventId, force = false) => {
    const st = get();
    if (st.loading) return;
    if (!force && st.eventId === eventId && Date.now() - st.loadedAt < 60_000) return;
    set({ loading: true });
    try {
      const { data: ev } = await supabase
        .from("events")
        .select("operation_mode, self_service_registration_minutes")
        .eq("id", eventId)
        .maybeSingle();
      const self = isSelfServiceMode((ev as any)?.operation_mode);
      let keys = new Set<string>();
      if (self) {
        const { data } = await (supabase as any)
          .from("live_selfservice_accesses")
          .select("phone_key")
          .eq("event_id", eventId)
          .not("viewed_product_at", "is", null)
          .order("created_at", { ascending: false })
          .limit(2000);
        keys = new Set(((data || []) as any[]).map((r) => r.phone_key));
      }
      set({
        eventId,
        isSelfService: self,
        minutes: Number((ev as any)?.self_service_registration_minutes ?? 5),
        viewedKeys: keys,
        loadedAt: Date.now(),
      });
    } finally {
      set({ loading: false });
    }
  },
}));
