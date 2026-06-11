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
}

/**
 * Card flutuante discreto no canto da área de chat com os contadores da
 * vendedora logada: clientes aguardando resposta e follow-ups pra fazer.
 * Recolhível. Some quando não há nada a avisar.
 */
export function AttendantNudgeCard({ conversations, onShowAwaiting }: AttendantNudgeCardProps) {
  const { awaitingCount, followupCount, showAwaiting, showFollowups, enabled } =
    useAttendantWorkload(conversations);
  const [collapsed, setCollapsed] = useState(false);

  const total =
    (showAwaiting ? awaitingCount : 0) + (showFollowups ? followupCount : 0);

  if (!enabled || total === 0) return null;

  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-20 w-64 max-w-[calc(100%-2rem)] rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 rounded-t-xl px-3 py-2 text-left"
      >
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bell className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold">Sua fila</span>
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
          {total}
        </span>
        {collapsed ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-1 px-2 pb-2">
          {showAwaiting && awaitingCount > 0 && (
            <button
              type="button"
              onClick={onShowAwaiting}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <MessageCircleReply className="h-4 w-4 text-amber-500" />
              <span className="flex-1">
                <strong>{awaitingCount}</strong>{" "}
                {awaitingCount === 1 ? "cliente aguarda" : "clientes aguardam"} sua resposta
              </span>
            </button>
          )}
          {showFollowups && followupCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
              <Clock className="h-4 w-4 text-sky-500" />
              <span className="flex-1">
                <strong>{followupCount}</strong>{" "}
                {followupCount === 1 ? "follow-up" : "follow-ups"} pra fazer
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
