import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { InitialLiveContact } from "@/lib/selfServiceInitial";

export function useInitialLiveContacts(eventId?: string | null, search?: string) {
  const [contacts, setContacts] = useState<InitialLiveContact[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async (pageOffset = offset) => {
    if (!eventId) { setContacts([]); return; }
    const current = ++generation.current;
    const { data, error } = await supabase.rpc("selfservice_initial_contacts", {
      p_event_id: eventId, p_limit: 100, p_offset: pageOffset, p_search: search?.trim() || null,
    });
    if (error || current !== generation.current) return;
    const next = (data || []) as InitialLiveContact[];
    setHasMore(next.length === 100);
    setContacts((previous) => {
      const merged = pageOffset ? [...previous.filter((row) => !next.some((item) => item.id === row.id)), ...next] : next;
      return JSON.stringify(previous) === JSON.stringify(merged) ? previous : merged;
    });
  }, [eventId, offset, search]);
  useEffect(() => { setOffset(0); setContacts([]); }, [eventId, search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!eventId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (document.hidden || timer) return;
      timer = setTimeout(() => { timer = undefined; void load(0); }, 600);
    };
    const channel = supabase.channel(`selfservice_contacts_${eventId}`)
      .on("broadcast", { event: "initial_contact" }, bump).subscribe();
    const interval = setInterval(() => { if (!document.hidden) void load(0); }, 60_000);
    return () => { clearInterval(interval); if (timer) clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [eventId, load]);
  return { contacts, hasMore, loadMore: () => setOffset((value) => value + 100) };
}