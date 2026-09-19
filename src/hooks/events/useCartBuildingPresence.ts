import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Presença em tempo real de "carrinho sendo montado" na Live.
 *
 * Quem abre o modal de pedido de um @ anuncia presença no canal do evento;
 * o painel de comentários escuta e mostra a tag "MONTANDO CARRINHO" para
 * evitar que duas pessoas montem o mesmo carrinho ao mesmo tempo.
 */
export interface CartBuildingPresence {
  handle: string;
  name: string;
  userId?: string | null;
  at: string;
}

const norm = (v?: string | null) =>
  String(v ?? "").trim().replace(/^@+/, "").toLowerCase();

const channelName = (eventId: string) => `live-cart-building:${eventId}`;

/** Anuncia que este usuário está montando o carrinho de um @. */
export function useCartBuildingTracker(
  eventId: string | null | undefined,
  handle: string | null | undefined,
  active: boolean,
) {
  const meRef = useRef<{ name: string; userId: string | null }>({ name: "", userId: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        let name =
          localStorage.getItem("team_chat_name") ||
          user?.user_metadata?.full_name ||
          user?.user_metadata?.name ||
          (user?.email || "").split("@")[0] ||
          "Alguém";
        if (user?.id) {
          const { data } = await supabase
            .from("user_profiles")
            .select("display_name")
            .eq("user_id", user.id)
            .maybeSingle();
          if (data?.display_name) name = data.display_name;
        }
        if (!cancelled) meRef.current = { name, userId: user?.id ?? null };
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const cleanHandle = norm(handle);

  useEffect(() => {
    if (!eventId || !active || !cleanHandle) return;
    const key = `${meRef.current.userId || meRef.current.name || "anon"}:${cleanHandle}`;
    const channel = supabase.channel(channelName(eventId), {
      config: { presence: { key } },
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          handle: cleanHandle,
          name: meRef.current.name || "Alguém",
          userId: meRef.current.userId,
          at: new Date().toISOString(),
        } satisfies CartBuildingPresence);
      }
    });
    return () => { supabase.removeChannel(channel); };
  }, [eventId, active, cleanHandle]);
}

/** Escuta quem está montando carrinho: mapa handle -> nomes. */
export function useCartBuildingWatcher(eventId: string | null | undefined) {
  const [building, setBuilding] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!eventId) {
      setBuilding(new Map());
      return;
    }
    const channel = supabase.channel(channelName(eventId), {
      config: { presence: { key: `watch-${Math.random().toString(36).slice(2)}` } },
    });
    const sync = () => {
      const state = channel.presenceState<CartBuildingPresence>();
      const map = new Map<string, string[]>();
      for (const entries of Object.values(state)) {
        for (const e of entries) {
          const h = norm((e as CartBuildingPresence).handle);
          if (!h) continue;
          const name = (e as CartBuildingPresence).name || "Alguém";
          const list = map.get(h) || [];
          if (!list.includes(name)) list.push(name);
          map.set(h, list);
        }
      }
      setBuilding(map);
    };
    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [eventId]);

  return building;
}
