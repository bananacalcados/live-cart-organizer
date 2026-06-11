import { useState } from "react";
import { Bell, Clock, MessageCircleReply, ChevronDown, ChevronUp } from "lucide-react";
import { useAttendantWorkload } from "@/hooks/useAttendantWorkload";

interface AttendantNudgeCardProps {
  conversations: Array<{
    phone: string;
    conversationStatus?: string;
    isFinished?: boolean;
    isArchived?: boolean;
  }>;
  /** Clicar em "aguardando" pode filtrar a lista (opcional). */
  onShowAwaiting?: () => void;
  /** Clicar em "follow-ups" pode filtrar a lista (opcional). */
  onShowFollowups?: () => void;
  /**
   * "floating" (padrão): card discreto e recolhível flutuando no canto do chat.
   * "inline": painel centralizado e chamativo, usado na área vazia (nenhuma conversa aberta).
   */
  variant?: "floating" | "inline";
}

/**
 * Card de lembretes da vendedora logada: clientes aguardando resposta e
 * follow-ups pra fazer. Some quando não há nada a avisar.
 */
export function AttendantNudgeCard({
  conversations,
  onShowAwaiting,
  onShowFollowups,
  variant = "floating",
}: AttendantNudgeCardProps) {
  const { awaitingCount, followupCount, showAwaiting, showFollowups, enabled } =
    useAttendantWorkload(conversations);
  const [collapsed, setCollapsed] = useState(false);

  const total =
    (showAwaiting ? awaitingCount : 0) + (showFollowups ? followupCount : 0);

  if (!enabled || total === 0) return null;

  if (variant === "inline") {
    return (
      <div className="w-[420px] max-w-[calc(100vw-3rem)] rounded-3xl border-2 border-primary/40 bg-card shadow-2xl ring-4 ring-primary/10 overflow-hidden">
        <div className="flex items-center gap-3 bg-gradient-to-r from-primary to-primary/80 px-5 py-4 text-primary-foreground">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
            <Bell className="h-6 w-6 animate-pulse" />
          </span>
          <div className="flex-1 text-left">
            <p className="text-lg font-extrabold leading-tight">Sua fila de atendimento</p>
            <p className="text-sm text-primary-foreground/80">Lembretes da sua vez</p>
          </div>
          <span className="flex h-10 min-w-[40px] items-center justify-center rounded-full bg-white px-3 text-xl font-black text-primary">
            {total}
          </span>
        </div>
        <div className="flex flex-col gap-2 p-4">
          {showAwaiting && awaitingCount > 0 && (
            <button
              type="button"
              onClick={onShowAwaiting}
              className="flex items-center gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3.5 text-left transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-950/30 dark:hover:bg-amber-900/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                <MessageCircleReply className="h-6 w-6" />
              </span>
              <span className="flex-1 text-base font-semibold text-amber-900 dark:text-amber-100">
                <span className="text-2xl font-black">{awaitingCount}</span>{" "}
                {awaitingCount === 1 ? "cliente está aguardando" : "clientes estão aguardando"} sua
                resposta
              </span>
            </button>
          )}
          {showFollowups && followupCount > 0 && (
            <button
              type="button"
              onClick={onShowFollowups}
              className="flex items-center gap-3 rounded-2xl border border-sky-300/60 bg-sky-50 px-4 py-3.5 text-left transition hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-950/30 dark:hover:bg-sky-900/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 text-sky-600 dark:text-sky-400">
                <Clock className="h-6 w-6" />
              </span>
              <span className="flex-1 text-base font-semibold text-sky-900 dark:text-sky-100">
                Você precisa fazer follow-up em{" "}
                <span className="text-2xl font-black">{followupCount}</span>{" "}
                {followupCount === 1 ? "cliente" : "clientes"}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute top-3 right-3 z-30 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border-2 border-primary/30 bg-card/98 shadow-xl ring-2 ring-primary/10 backdrop-blur">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 rounded-t-xl bg-gradient-to-r from-primary/15 to-transparent px-3 py-2.5 text-left"
      >
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary">
          <Bell className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-bold">Sua fila</span>
        <span className="flex h-7 min-w-[28px] items-center justify-center rounded-full bg-primary px-2 text-sm font-black text-primary-foreground">
          {total}
        </span>
        {collapsed ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-1.5 px-2 pb-2">
          {showAwaiting && awaitingCount > 0 && (
            <button
              type="button"
              onClick={onShowAwaiting}
              className="flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-left text-sm font-medium text-amber-900 transition hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <MessageCircleReply className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="flex-1">
                <strong className="text-base">{awaitingCount}</strong>{" "}
                {awaitingCount === 1 ? "cliente aguarda" : "clientes aguardam"} sua resposta
              </span>
            </button>
          )}
          {showFollowups && followupCount > 0 && (
            <button
              type="button"
              onClick={onShowFollowups}
              className="flex items-center gap-2 rounded-lg bg-sky-50 px-2.5 py-2 text-left text-sm font-medium text-sky-900 transition hover:bg-sky-100 dark:bg-sky-950/30 dark:text-sky-100"
            >
              <Clock className="h-4 w-4 shrink-0 text-sky-500" />
              <span className="flex-1">
                Follow-up em <strong className="text-base">{followupCount}</strong>{" "}
                {followupCount === 1 ? "cliente" : "clientes"}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
