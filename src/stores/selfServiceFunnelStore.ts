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
  /** Chaves (digitada e real) de quem confirmou o cadastro no WhatsApp. */
  confirmedKeys: Set<string>;
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
  confirmedKeys: new Set(),
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
      const confirmed = new Set<string>();
      if (self) {
        const { data } = await (supabase as any)
          .from("live_selfservice_accesses")
          .select("phone_key, viewed_product_at, whatsapp_confirmed_at, confirmed_phone_key")
          .eq("event_id", eventId)
          .or("viewed_product_at.not.is.null,whatsapp_confirmed_at.not.is.null")
          .order("created_at", { ascending: false })
          .limit(2000);
        const rows = (data || []) as any[];
        keys = new Set(rows.filter((r) => r.viewed_product_at).map((r) => r.phone_key));
        for (const r of rows) if (r.whatsapp_confirmed_at) { confirmed.add(r.phone_key); if (r.confirmed_phone_key) confirmed.add(r.confirmed_phone_key); }
      }
      set({
        eventId,
        isSelfService: self,
        minutes: Number((ev as any)?.self_service_registration_minutes ?? 5),
        viewedKeys: keys,
        confirmedKeys: confirmed,
        loadedAt: Date.now(),
      });
    } finally {
      set({ loading: false });
    }
  },
}));
