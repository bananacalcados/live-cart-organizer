import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { laneAutoKey, type ChatLane } from "@/lib/chat/conversationLanes";

/** Linhas que podem ser escolhidas manualmente (Finalizadas usa o fluxo de Finalizar). */
export type ManualChatLane = Extract<ChatLane, "new" | "unread" | "followup" | "support">;

export interface ChatLaneMark {
  lane: ManualChatLane;
  movedBy: string | null;
  movedAt: string;
}

const markKey = (phoneKey: string, numberId?: string | null) => `${phoneKey}__${numberId || ""}`;

/**
 * Marcações manuais de linha do WhatsApp do PDV (compartilhadas entre atendentes,
 * em tempo real). A marcação é apagada no servidor quando a cliente manda nova
 * mensagem ou quando a conversa é finalizada.
 */
export function useChatConversationLanes(enabled: boolean) {
  const [marks, setMarks] = useState<Map<string, ChatLaneMark>>(new Map());

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data } = await supabase
      .from("chat_conversation_lanes")
      .select("phone_key, whatsapp_number_id, lane, moved_by, moved_at");
    const map = new Map<string, ChatLaneMark>();
    for (const r of (data || []) as { phone_key: string; whatsapp_number_id: string; lane: string; moved_by: string | null; moved_at: string }[]) {
      map.set(markKey(r.phone_key, r.whatsapp_number_id), { lane: r.lane as ManualChatLane, movedBy: r.moved_by, movedAt: r.moved_at });
    }
    setMarks(map);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setMarks(new Map());
      return;
    }
    load();
    const channel = supabase
      .channel("chat-conversation-lanes")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversation_lanes" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, load]);

  /** Marcação para a conversa: exata (telefone+instância) ou geral (só telefone). */
  const getMark = useCallback(
    (phone: string, numberId?: string | null): ChatLaneMark | null => {
      const key = laneAutoKey(phone);
      if (key.length < 8) return null;
      return marks.get(markKey(key, numberId)) || marks.get(markKey(key, "")) || null;
    },
    [marks],
  );

  const setLane = useCallback(async (phone: string, numberId: string | null | undefined, lane: ManualChatLane) => {
    const key = laneAutoKey(phone);
    if (key.length < 8) return;
    const movedAt = new Date().toISOString();
    setMarks((prev) => new Map(prev).set(markKey(key, numberId), { lane, movedBy: null, movedAt }));
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("chat_conversation_lanes").upsert(
      { phone_key: key, whatsapp_number_id: numberId || "", lane, moved_by: auth.user?.id ?? null, moved_at: movedAt },
      { onConflict: "phone_key,whatsapp_number_id" },
    );
  }, []);

  const clearLane = useCallback(async (phone: string) => {
    const key = laneAutoKey(phone);
    if (key.length < 8) return;
    setMarks((prev) => {
      const next = new Map(prev);
      for (const k of Array.from(next.keys())) if (k.startsWith(`${key}__`)) next.delete(k);
      return next;
    });
    await supabase.from("chat_conversation_lanes").delete().eq("phone_key", key);
  }, []);

  return useMemo(() => ({ marks, getMark, setLane, clearLane }), [marks, getMark, setLane, clearLane]);
}
