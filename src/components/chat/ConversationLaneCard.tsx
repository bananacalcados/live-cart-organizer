import type { ReactNode } from "react";
import { Users, Radio, Timer, Pin, CheckCircle2, Check } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Conversation } from "./ChatTypes";

interface ConversationLaneCardProps {
  conv: Conversation;
  selected?: boolean;
  photoUrl?: string;
  contactName?: string;
  attendantName?: string | null;
  igUsername?: string | null;
  liveStage?: { stageTitle: string; eventName?: string } | null;
  /** Milissegundos restantes na janela de 5 min (mostra contador). */
  graceMsLeft?: number;
  /** Conversa foi movida manualmente para esta linha. */
  manualMark?: boolean;
  /** Menu de ações (ex.: Transferir etapa), renderizado no canto do card. */
  menu?: ReactNode;
  /** Botão "Finalizar" no rodapé do card (oculto quando ausente). */
  onFinish?: () => void;
  onClick: () => void;
  /** Modo de seleção em massa: mostra caixa de marcar e o clique alterna a seleção. */
  selectable?: boolean;
  checked?: boolean;
  onToggleChecked?: () => void;
}

const formatTime = (date: Date) => {
  if (isToday(date)) return format(date, "HH:mm", { locale: ptBR });
  if (isYesterday(date)) return "Ontem";
  return format(date, "dd/MM", { locale: ptBR });
};

const getInitials = (name?: string) => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

/** Card compacto de conversa usado nas Linhas do WhatsApp do PDV (mesma linguagem visual da lista). */
export function ConversationLaneCard({
  conv,
  selected,
  photoUrl,
  contactName,
  attendantName,
  igUsername,
  liveStage,
  graceMsLeft,
  manualMark,
  menu,
  onFinish,
  onClick,
  selectable,
  checked,
  onToggleChecked,
}: ConversationLaneCardProps) {
  const name = conv.customerName || contactName || conv.phone;
  const showPhone = !!(conv.customerName || contactName);
  const graceMin = graceMsLeft && graceMsLeft > 0 ? Math.ceil(graceMsLeft / 60000) : 0;
  const activate = () => (selectable && onToggleChecked ? onToggleChecked() : onClick());

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      className={cn(
        "relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "w-[230px] shrink-0 snap-start rounded-lg border border-border/60 bg-card px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-muted/60",
        conv.hasUnansweredMessage && "border-[#00a884]/50 bg-[#c7e9c0]/30 dark:bg-[#005c4b]/20",
        selected && "ring-2 ring-[#00a884]",
        selectable && checked && "ring-2 ring-primary bg-primary/5",
      )}
    >
      {selectable && (
        <span
          aria-hidden
          className={cn(
            "absolute -left-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-background shadow",
            checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
          )}
        >
          {checked && <Check className="h-3 w-3" />}
        </span>
      )}
      <div className="flex items-start gap-2">
        <Avatar className="h-9 w-9 shrink-0">
          {photoUrl ? <AvatarImage src={photoUrl} /> : null}
          <AvatarFallback className={cn("text-xs font-bold text-white", conv.isGroup ? "bg-[#00a884]" : "bg-[#9aa6ad]")}>
            {conv.isGroup ? <Users className="h-4 w-4" /> : getInitials(conv.customerName || contactName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
            <span className="flex shrink-0 items-center gap-1">
              <span className={cn("text-[10px]", conv.hasUnansweredMessage ? "font-medium text-[#00a884]" : "text-muted-foreground")}>
                {formatTime(conv.lastMessageAt)}
              </span>
              {menu}
            </span>
          </div>
          {showPhone && <div className="truncate text-[10px] text-muted-foreground">{conv.phone}</div>}
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">{conv.lastMessage}</p>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {liveStage && (
          <span className="inline-flex items-center gap-1 rounded border border-fuchsia-400/40 bg-fuchsia-500/20 px-1.5 py-[1px] text-[9px] font-semibold text-fuchsia-700 dark:text-fuchsia-400">
            <Radio className="h-2.5 w-2.5" />
            {liveStage.stageTitle}
            {liveStage.eventName ? ` · ${liveStage.eventName}` : ""}
          </span>
        )}
        {conv.channel === "instagram" ? (
          <Badge className="h-4 border-pink-400/30 bg-pink-500/20 px-1 text-[8px] leading-tight text-pink-600 hover:bg-pink-500/30 dark:text-pink-400">
            📷 {igUsername ? `@${igUsername}` : "Instagram"}
          </Badge>
        ) : conv.channel === "messenger" ? (
          <Badge className="h-4 border-blue-400/30 bg-blue-500/20 px-1 text-[8px] leading-tight text-blue-600 hover:bg-blue-500/30 dark:text-blue-400">
            💬 Messenger
          </Badge>
        ) : (conv.instanceLabel || conv.isGroup) ? (
          <Badge
            variant="outline"
            className={cn("h-4 px-1 text-[8px] leading-tight", conv.whatsapp_number_id ? "border-blue-400 text-blue-600" : "border-green-400 text-green-600")}
          >
            {conv.instanceLabel || "WhatsApp"}
          </Badge>
        ) : null}
        {conv.isAiTransferred && (
          <Badge className="h-4 border-orange-400/40 bg-orange-500/20 px-1 text-[8px] leading-tight text-orange-600 hover:bg-orange-500/30 dark:text-orange-400">
            🤖 IA
          </Badge>
        )}
        {attendantName && (
          <span className="inline-flex max-w-[100px] items-center gap-0.5 truncate rounded-full border border-[#00a884]/30 bg-[#00a884]/15 px-1.5 py-[1px] text-[9px] font-semibold text-[#017561] dark:text-[#25d366]" title={`Atendente: ${attendantName}`}>
            👤 <span className="truncate">{attendantName}</span>
          </span>
        )}
        {graceMin > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-[1px] text-[9px] font-semibold text-sky-700 dark:text-sky-400" title="Vai para Follow Up se a cliente não responder">
            <Timer className="h-2.5 w-2.5" /> {graceMin} min
          </span>
        )}
        {manualMark && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-500/15 px-1.5 py-[1px] text-[9px] font-semibold text-indigo-700 dark:text-indigo-400" title="Movida manualmente para esta linha">
            <Pin className="h-2.5 w-2.5" /> manual
          </span>
        )}
        {conv.unreadCount > 0 && (
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[#00a884] px-1 text-[10px] font-bold text-white">
            {conv.unreadCount}
          </span>
        )}
      </div>
      {onFinish && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFinish();
          }}
          className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-border/60 bg-background/60 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-[#00a884]/50 hover:bg-[#00a884]/10 hover:text-[#017561] dark:hover:text-[#25d366]"
          title="Finalizar conversa"
        >
          <CheckCircle2 className="h-3 w-3" /> Finalizar conversa
        </button>
      )}
    </div>
  );
}
