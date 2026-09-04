import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Sparkles, MailWarning, Clock, Radio, Headphones, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LaneSection } from "@/components/chat/LaneSection";
import { ConversationLaneCard } from "@/components/chat/ConversationLaneCard";
import { TransferLaneMenu } from "@/components/chat/TransferLaneMenu";
import type { ManualChatLane } from "@/hooks/useChatConversationLanes";
import type { Conversation } from "@/components/chat/ChatTypes";
import {
  CHAT_LANE_META,
  CHAT_LANE_ORDER,
  classifyConversationLane,
  laneAutoKey,
  msUntilFollowup,
  type ChatLane,
} from "@/lib/chat/conversationLanes";

interface POSWhatsAppLanesProps {
  storeId: string;
  conversations: Conversation[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectConversation: (phone: string, whatsappNumberId?: string | null) => void;
  selectedConversationKey?: string | null;
  contactPhotos?: Record<string, string>;
  contactNames?: Record<string, string>;
  igUsernameById?: Record<string, string>;
  getAssignedName?: (conversationKey: string) => string | null;
  liveStageMap?: Record<string, { stageTitle: string; eventName?: string }>;
  hasActiveSupport?: (phone: string) => boolean;
  finishedAtByPhone?: Map<string, string>;
  /** Marcação manual da conversa (Etapa 2). */
  getManualLane?: (phone: string, whatsappNumberId?: string | null) => ChatLane | null;
  onMoveLane?: (conv: Conversation, lane: ManualChatLane) => void;
  onFinishLane?: (conv: Conversation) => void;
  onClearManualLane?: (conv: Conversation) => void;
}

const LANE_ICON: Record<ChatLane, JSX.Element> = {
  new: <Sparkles className="h-3.5 w-3.5 text-emerald-500" />,
  unread: <MailWarning className="h-3.5 w-3.5 text-amber-500" />,
  followup: <Clock className="h-3.5 w-3.5 text-sky-500" />,
  live: <Radio className="h-3.5 w-3.5 text-fuchsia-500" />,
  support: <Headphones className="h-3.5 w-3.5 text-orange-500" />,
  finished: <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />,
};

/** Quantas finalizadas mostrar (as mais recentes) para não pesar a tela. */
const FINISHED_LIMIT = 40;

/**
 * Visão em Linhas do WhatsApp do PDV: todas as etapas visíveis ao mesmo tempo.
 * Não faz consulta própria — recebe as conversas já carregadas pela tela clássica.
 */
export function POSWhatsAppLanes({
  storeId,
  conversations,
  searchQuery,
  onSearchChange,
  onSelectConversation,
  selectedConversationKey,
  contactPhotos = {},
  contactNames = {},
  igUsernameById = {},
  getAssignedName,
  liveStageMap = {},
  hasActiveSupport,
  finishedAtByPhone,
  getManualLane,
  onMoveLane,
  onFinishLane,
  onClearManualLane,
}: POSWhatsAppLanesProps) {
  // Tick de 30s só para reavaliar a janela de 5 min (sem consulta ao banco).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Memória local: última linha "de origem" (Novas / Não lidas) por conversa,
  // usada para manter o card no lugar durante os 5 min após a nossa resposta.
  const previousLaneRef = useRef<Map<string, ChatLane>>(new Map());

  const q = searchQuery.trim().toLowerCase();

  const lanes = useMemo(() => {
    const out: Record<ChatLane, Conversation[]> = { new: [], unread: [], followup: [], live: [], support: [], finished: [] };
    const graceLeft = new Map<string, number>();
    const manual = new Set<string>();
    const prev = previousLaneRef.current;

    for (const conv of conversations) {
      if (conv.isArchived) continue;
      if (q) {
        const hay = `${conv.customerName || ""} ${contactNames[conv.phone] || ""} ${conv.phone} ${conv.lastMessage || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const key = conv.conversationKey || `${conv.phone}__${conv.whatsapp_number_id || "none"}`;
      // Marcação manual vale mesmo para finalizadas: mover tira da linha Finalizadas
      // (o servidor apaga a marcação quando a conversa é finalizada de novo).
      const manualLane = getManualLane?.(conv.phone, conv.whatsapp_number_id) || null;
      if (manualLane) manual.add(key);
      const lane = classifyConversationLane({
        conv,
        now,
        isLive: !!liveStageMap[conv.phone],
        hasSupport: !!hasActiveSupport?.(conv.phone),
        finishedAt: finishedAtByPhone?.get(laneAutoKey(conv.phone)) || null,
        manualLane,
        previousLane: prev.get(key) || null,
      });
      // Atualiza memória: só guardamos linhas "de origem" reais.
      if (lane === "new" || lane === "unread") prev.set(key, lane);
      else if (lane === "followup" || lane === "finished") prev.delete(key);

      const left = msUntilFollowup(conv, now);
      if (left > 0 && (lane === "new" || lane === "unread")) graceLeft.set(key, left);
      out[lane].push(conv);
    }

    // Ordenação: Novas / Não lidas / Follow Up — mais antigas primeiro (quem espera há mais tempo);
    // demais — mais recentes primeiro.
    const asc = (a: Conversation, b: Conversation) => a.lastMessageAt.getTime() - b.lastMessageAt.getTime();
    const desc = (a: Conversation, b: Conversation) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
    out.new.sort(asc);
    out.unread.sort(asc);
    out.followup.sort(asc);
    out.live.sort(desc);
    out.support.sort(desc);
    out.finished.sort(desc);
    out.finished = out.finished.slice(0, FINISHED_LIMIT);
    return { out, graceLeft, manual };
  }, [conversations, now, q, contactNames, liveStageMap, hasActiveSupport, finishedAtByPhone, getManualLane]);

  // Etapa 3 — contadores no topo + atalhos de teclado.
  const searchRef = useRef<HTMLInputElement>(null);
  const [expandSignal, setExpandSignal] = useState<Record<ChatLane, number>>({ new: 0, unread: 0, followup: 0, live: 0, support: 0, finished: 0 });
  const laneDomId = (lane: ChatLane) => `pos-wa-lane-${storeId}-${lane}`;
  const jumpToLane = (lane: ChatLane) => {
    setExpandSignal((s) => ({ ...s, [lane]: s[lane] + 1 }));
    requestAnimationFrame(() => {
      document.getElementById(laneDomId(lane))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      // Atalhos só valem com a tela de linhas em foco (sem diálogo aberto).
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && typing && target === searchRef.current) {
        onSearchChange("");
        searchRef.current?.blur();
        return;
      }
      if (typing) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < CHAT_LANE_ORDER.length) {
        e.preventDefault();
        jumpToLane(CHAT_LANE_ORDER[idx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, onSearchChange]);

  const totalActive = CHAT_LANE_ORDER.filter((l) => l !== "finished").reduce((n, l) => n + lanes.out[l].length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-1.5 border-b border-border/50 bg-background/60 px-2 py-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nome, telefone ou mensagem…  (atalho: /)"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-label="Contadores por linha">
          <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {totalActive} em atendimento
          </span>
          {CHAT_LANE_ORDER.map((lane, i) => {
            const meta = CHAT_LANE_META[lane];
            const n = lanes.out[lane].length;
            return (
              <button
                key={lane}
                type="button"
                onClick={() => jumpToLane(lane)}
                title={`${meta.title} — atalho ${i + 1}`}
                className={`flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold transition-colors hover:bg-muted ${n > 0 ? meta.tone : "text-muted-foreground/60"}`}
              >
                {LANE_ICON[lane]}
                <span className="uppercase tracking-wide">{meta.title}</span>
                <span className="rounded-full bg-current/10 px-1.5 text-current">{n}</span>
                <kbd className="ml-0.5 hidden rounded border border-border/60 px-1 text-[9px] font-mono text-muted-foreground md:inline">{i + 1}</kbd>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {CHAT_LANE_ORDER.map((lane) => {
          const items = lanes.out[lane];
          const meta = CHAT_LANE_META[lane];
          return (
            <LaneSection
              key={lane}
              id={laneDomId(lane)}
              expandSignal={expandSignal[lane]}
              storageKey={`pos-wa-lane-collapsed:${storeId}:${lane}`}
              title={meta.title}
              count={items.length}
              tone={meta.tone}
              icon={LANE_ICON[lane]}
              hint={meta.description}
            >
              {items.length === 0 ? (
                <p className="px-1 py-1.5 text-[11px] text-muted-foreground/70">Nenhuma conversa aqui.</p>
              ) : (
                <div className="flex snap-x gap-2 overflow-x-auto pb-1.5 pt-0.5">
                  {items.map((conv) => {
                    const key = conv.conversationKey || `${conv.phone}__${conv.whatsapp_number_id || "none"}`;
                    return (
                      <ConversationLaneCard
                        key={key}
                        conv={conv}
                        selected={selectedConversationKey === key}
                        photoUrl={contactPhotos[conv.phone]}
                        contactName={contactNames[conv.phone]}
                        attendantName={getAssignedName?.(key)}
                        igUsername={conv.whatsapp_number_id ? igUsernameById[conv.whatsapp_number_id] : null}
                        liveStage={liveStageMap[conv.phone] || null}
                        graceMsLeft={lanes.graceLeft.get(key)}
                        manualMark={lanes.manual.has(key)}
                        menu={onMoveLane && !conv.isGroup ? (
                          <TransferLaneMenu
                            variant="icon"
                            currentLane={lane}
                            hasManualMark={lanes.manual.has(key)}
                            onMove={(l) => onMoveLane(conv, l)}
                            onFinish={onFinishLane && lane !== "finished" ? () => onFinishLane(conv) : undefined}
                            onClearManual={onClearManualLane ? () => onClearManualLane(conv) : undefined}
                          />
                        ) : null}
                        onFinish={onFinishLane && lane !== "finished" && !conv.isGroup ? () => onFinishLane(conv) : undefined}
                        onClick={() => onSelectConversation(conv.phone, conv.whatsapp_number_id)}
                      />
                    );
                  })}
                </div>
              )}
            </LaneSection>
          );
        })}
      </div>
    </div>
  );
}
