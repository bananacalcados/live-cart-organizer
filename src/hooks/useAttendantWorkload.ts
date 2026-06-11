import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAttendanceRules } from "./useAttendanceRules";

interface WorkloadConversation {
  phone: string;
  conversationStatus?: string;
  isFinished?: boolean;
  isArchived?: boolean;
  isAwaitingProduct?: boolean;
}

export interface AttendantWorkload {
  awaitingCount: number;
  followupCount: number;
  showAwaiting: boolean;
  showFollowups: boolean;
  enabled: boolean;
}

const suffix = (p: string) => p.replace(/\D/g, "").slice(-8);

/**
 * Contadores de carga de trabalho da vendedora logada.
 *
 * - "aguardando você": deriva da lista de conversas já filtrada por atribuição
 *   (status `awaiting_reply`), sem query extra.
 * - "follow-ups pra fazer": follow-ups de pagamento/agendados vencidos cujos
 *   telefones batem com as conversas da vendedora (match por sufixo de 8 dígitos).
 */
export function useAttendantWorkload(conversations: WorkloadConversation[]): AttendantWorkload {
  const rules = useAttendanceRules();
  const rule = rules["workload_counters"];
  const enabled = rule?.enabled !== false;
  const showAwaiting = (rule?.config?.show_awaiting as boolean | undefined) !== false;
  const showFollowups = (rule?.config?.show_followups as boolean | undefined) !== false;

  const [followupCount, setFollowupCount] = useState(0);

  const awaitingCount = useMemo(
    () =>
      conversations.filter(
        (c) => c.conversationStatus === "awaiting_reply" && !c.isFinished && !c.isArchived && !c.isAwaitingProduct,
      ).length,
    [conversations],
  );

  // "Follow-ups pra fazer": mesma base do badge "Follow Up" da lista —
  // conversas aguardando o cliente (status `awaiting_customer`). Assim o card
  // sempre bate com o número que a vendedora vê na aba Follow Up.
  const conversationFollowups = useMemo(
    () =>
      conversations.filter(
        (c) => c.conversationStatus === "awaiting_customer" && !c.isFinished && !c.isArchived && !c.isAwaitingProduct,
      ).length,
    [conversations],
  );

  // sufixos das conversas da vendedora (estável o suficiente pra dependência)
  const phoneSuffixes = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      if (!c.isFinished && !c.isArchived) set.add(suffix(c.phone));
    }
    return set;
  }, [conversations]);

  // Reforço opcional: follow-ups de pagamento/agendados vencidos cujos telefones
  // batem com as conversas da vendedora. Usamos o MAIOR entre os dois sinais
  // pra nunca subestimar o que a vendedora precisa fazer.
  useEffect(() => {
    if (!enabled || !showFollowups || phoneSuffixes.size === 0) {
      setFollowupCount(0);
      return;
    }
    let alive = true;

    const fetchFollowups = async () => {
      const nowIso = new Date().toISOString();
      const [pay, sched] = await Promise.all([
        (supabase as any)
          .from("chat_payment_followups")
          .select("phone")
          .eq("is_active", true)
          .is("completed_at", null)
          .lte("next_reminder_at", nowIso),
        (supabase as any)
          .from("chat_scheduled_followups")
          .select("phone")
          .eq("is_sent", false)
          .lte("scheduled_at", nowIso),
      ]);

      if (!alive) return;
      const phones = new Set<string>();
      for (const r of (pay.data || []) as Array<{ phone: string }>) {
        if (phoneSuffixes.has(suffix(r.phone))) phones.add(suffix(r.phone));
      }
      for (const r of (sched.data || []) as Array<{ phone: string }>) {
        if (phoneSuffixes.has(suffix(r.phone))) phones.add(suffix(r.phone));
      }
      setFollowupCount(phones.size);
    };

    fetchFollowups();
    const id = setInterval(fetchFollowups, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled, showFollowups, phoneSuffixes]);

  return {
    awaitingCount,
    // o card mostra o maior sinal entre status da conversa e tabelas de follow-up
    followupCount: Math.max(conversationFollowups, followupCount),
    showAwaiting,
    showFollowups,
    enabled,
  };
}
