import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ContactLane = "doubts" | "new";

export interface ContactLaneMark {
  lane: ContactLane;
  reason: string | null;
  movedAt: string;
}

/** Chave de casamento por telefone: DDD + 8 últimos dígitos. */
export const phoneLaneKey = (phone?: string | null) => {
  const d = (phone || "").replace(/\D/g, "");
  return d ? d.slice(-8) : "";
};

/**
 * Marcações manuais de linha (Dúvidas & cancelamentos / Novos contatos) por
 * telefone dentro de um evento. Tempo real via Realtime.
 */
export function useEventContactLanes(eventId: string | null | undefined) {
  const [marks, setMarks] = useState<Map<string, ContactLaneMark>>(new Map());

  const load = useCallback(async () => {
    if (!eventId) {
      setMarks(new Map());
      return;
    }
    const { data } = await supabase
      .from("event_contact_lanes")
      .select("phone_key, lane, reason, moved_at")
      .eq("event_id", eventId);
    const map = new Map<string, ContactLaneMark>();
    for (const r of (data || []) as { phone_key: string; lane: string; reason: string | null; moved_at: string }[]) {
      map.set(r.phone_key, { lane: r.lane as ContactLane, reason: r.reason, movedAt: r.moved_at });
    }
    setMarks(map);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`event-contact-lanes-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_contact_lanes", filter: `event_id=eq.${eventId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, load]);

  const setLane = useCallback(
    async (phone: string, lane: ContactLane, reason?: string | null) => {
      const key = phoneLaneKey(phone);
      if (!eventId || key.length < 8) return;
      const mark: ContactLaneMark = { lane, reason: reason?.trim() || null, movedAt: new Date().toISOString() };
      setMarks((prev) => new Map(prev).set(key, mark));
      const { data: auth } = await supabase.auth.getUser();
      await supabase.from("event_contact_lanes").upsert(
        {
          event_id: eventId,
          phone_key: key,
          lane,
          reason: mark.reason,
          moved_by: auth.user?.id ?? null,
          moved_at: mark.movedAt,
        },
        { onConflict: "event_id,phone_key" },
      );
    },
    [eventId],
  );

  const clearLane = useCallback(
    async (phone: string) => {
      const key = phoneLaneKey(phone);
      if (!eventId || key.length < 8) return;
      setMarks((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      await supabase.from("event_contact_lanes").delete().eq("event_id", eventId).eq("phone_key", key);
    },
    [eventId],
  );

  return { marks, setLane, clearLane, reload: load };
}
