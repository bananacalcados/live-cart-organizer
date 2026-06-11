import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAttendanceRules } from "./useAttendanceRules";

interface WorkloadConversation {
  phone: string;
  conversationStatus?: string;
  isFinished?: boolean;
  isArchived?: boolean;
  isAwaitingProduct?: boolean;
  lastMessageAt?: Date;
}

export interface AttendantWorkload {
  awaitingCount: number;
  followupCount: number;
  /** Maior tempo (em minutos) que um cliente está aguardando resposta. */
  longestWaitMinutes: number;
  /** Rótulo amigável do maior tempo de espera (ex.: "25 min", "1h 10"). */
  longestWaitLabel: string;
  /** Taxa de resposta (0-100): conversas já respondidas / total ativo. */
  responseRate: number;
  showAwaiting: boolean;
  showFollowups: boolean;
  enabled: boolean;
}

function formatWait(minutes: number): string {
  if (minutes <= 0) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${String(m).padStart(2, "0")}` : `${h}h`;
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
  // tick a cada minuto pra recalcular o tempo de espera mesmo sem novas mensagens
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const awaitingConversations = useMemo(
    () =>
      conversations.filter(
        (c) => c.conversationStatus === "awaiting_reply" && !c.isFinished && !c.isArchived && !c.isAwaitingProduct,
      ),
    [conversations],
  );

  const awaitingCount = awaitingConversations.length;

  // Maior tempo de espera entre os clientes aguardando resposta.
  const longestWaitMinutes = useMemo(() => {
    let oldest = 0;
    for (const c of awaitingConversations) {
      const t = c.lastMessageAt instanceof Date ? c.lastMessageAt.getTime() : 0;
      if (!t) continue;
      const mins = Math.max(0, Math.floor((now - t) / 60_000));
      if (mins > oldest) oldest = mins;
    }
    return oldest;
  }, [awaitingConversations, now]);

  // Taxa de resposta: conversas já respondidas (aguardando cliente) sobre o total
  // ativo (respondidas + aguardando nós). 100% = nenhum cliente esperando.
  const responseRate = useMemo(() => {
    const active = conversations.filter(
      (c) =>
        !c.isFinished &&
        !c.isArchived &&
        !c.isAwaitingProduct &&
        (c.conversationStatus === "awaiting_reply" ||
          c.conversationStatus === "awaiting_customer" ||
          c.conversationStatus === "not_started"),
    );
    if (active.length === 0) return 100;
    const responded = active.filter((c) => c.conversationStatus === "awaiting_customer").length;
    return Math.round((responded / active.length) * 100);
  }, [conversations]);


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
    longestWaitMinutes,
    longestWaitLabel: formatWait(longestWaitMinutes),
    responseRate,
    showAwaiting,
    showFollowups,
    enabled,
  };
}
