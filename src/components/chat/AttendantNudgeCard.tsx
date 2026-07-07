import { useState, useRef, useCallback, useEffect } from "react";
import {
  Bell,
  Clock,
  MessageCircleReply,
  ChevronDown,
  ChevronUp,
  Timer,
  Gauge,
  PackageCheck,
  GripVertical,
} from "lucide-react";
import { useAttendantWorkload } from "@/hooks/useAttendantWorkload";

interface AttendantNudgeCardProps {
  conversations: Array<{
    phone: string;
    conversationStatus?: string;
    isFinished?: boolean;
    isArchived?: boolean;
    isAwaitingProduct?: boolean;
    lastMessageAt?: Date;
  }>;
  /** Clicar em "aguardando" pode filtrar a lista (opcional). */
  onShowAwaiting?: () => void;
  /** Clicar em "follow-ups" pode filtrar a lista (opcional). */
  onShowFollowups?: () => void;
  /** Clicar em "produtos chegaram" pode abrir a aba de Espera de Produtos (opcional). */
  onShowArrived?: () => void;
  /** Quantidade de produtos que chegaram e precisam de aviso ao cliente. */
  arrivedCount?: number;
  /**
   * "floating" (padrão): card discreto e recolhível flutuando no canto do chat.
   * "inline": painel centralizado e chamativo, usado na área vazia (nenhuma conversa aberta).
   */
  variant?: "floating" | "inline";
}

/**
 * Card de lembretes da vendedora logada: clientes aguardando resposta, tempo de
 * espera, taxa de resposta, follow-ups pra fazer e produtos que chegaram pra
 * avisar o cliente. Some quando não há nada a avisar.
 */
export function AttendantNudgeCard({
  conversations,
  onShowAwaiting,
  onShowFollowups,
  onShowArrived,
  arrivedCount = 0,
  variant = "floating",
}: AttendantNudgeCardProps) {
  const {
    awaitingCount,
    followupCount,
    longestWaitMinutes,
    longestWaitLabel,
    responseRate,
    showAwaiting,
    showFollowups,
    enabled,
  } = useAttendantWorkload(conversations);
  const [collapsed, setCollapsed] = useState(false);

  // Posição arrastável do card flutuante (offset em px a partir do canto padrão).
  const STORAGE_KEY = "attendant-nudge-pos";
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return { x: 0, y: 0 };
  });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: pos.x,
        baseY: pos.y,
      };
    },
    [pos]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [pos]);

  const total =
    (showAwaiting ? awaitingCount : 0) + (showFollowups ? followupCount : 0) + arrivedCount;

  if (!enabled || total === 0) return null;

  // Cor do tempo de espera: verde até 10min, âmbar até 30, vermelho acima.
  const waitTone =
    longestWaitMinutes >= 30
      ? "text-red-600 dark:text-red-400"
      : longestWaitMinutes >= 10
        ? "text-amber-600 dark:text-amber-400"
        : "text-emerald-600 dark:text-emerald-400";
  // Cor da taxa de resposta: verde alto, âmbar médio, vermelho baixo.
  const rateTone =
    responseRate >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : responseRate >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

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

        {/* Métricas: tempo de espera + taxa de resposta */}
        {awaitingCount > 0 && (
          <div className="grid grid-cols-2 gap-2 px-4 pt-4">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-3">
              <Timer className={`h-6 w-6 ${waitTone}`} />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">Maior espera</p>
                <p className={`text-xl font-black leading-tight ${waitTone}`}>{longestWaitLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-3">
              <Gauge className={`h-6 w-6 ${rateTone}`} />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">Taxa de resposta</p>
                <p className={`text-xl font-black leading-tight ${rateTone}`}>{responseRate}%</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 p-4">
          {arrivedCount > 0 && (
            <button
              type="button"
              onClick={onShowArrived}
              className="flex items-center gap-3 rounded-2xl border border-emerald-300/60 bg-emerald-50 px-4 py-3.5 text-left transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <PackageCheck className="h-6 w-6" />
              </span>
              <span className="flex-1 text-base font-semibold text-emerald-900 dark:text-emerald-100">
                <span className="text-2xl font-black">{arrivedCount}</span>{" "}
                {arrivedCount === 1 ? "produto chegou" : "produtos chegaram"} — avise o cliente
              </span>
            </button>
          )}
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
          {/* Métricas rápidas: tempo de espera + taxa de resposta */}
          {awaitingCount > 0 && (
            <div className="flex gap-1.5 px-0.5 pt-1">
              <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5">
                <Timer className={`h-4 w-4 shrink-0 ${waitTone}`} />
                <div className="min-w-0 leading-tight">
                  <p className="text-[10px] text-muted-foreground">Maior espera</p>
                  <p className={`text-sm font-black ${waitTone}`}>{longestWaitLabel}</p>
                </div>
              </div>
              <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5">
                <Gauge className={`h-4 w-4 shrink-0 ${rateTone}`} />
                <div className="min-w-0 leading-tight">
                  <p className="text-[10px] text-muted-foreground">Resposta</p>
                  <p className={`text-sm font-black ${rateTone}`}>{responseRate}%</p>
                </div>
              </div>
            </div>
          )}

          {arrivedCount > 0 && (
            <button
              type="button"
              onClick={onShowArrived}
              className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-left text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-100"
            >
              <PackageCheck className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="flex-1">
                <strong className="text-base">{arrivedCount}</strong>{" "}
                {arrivedCount === 1 ? "produto chegou" : "produtos chegaram"} — avisar
              </span>
            </button>
          )}
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
