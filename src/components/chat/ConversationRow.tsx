import { memo } from "react";
import { Users, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Conversation } from "./ChatTypes";

export const formatConversationTime = (date: Date) => {
  if (isToday(date)) return format(date, "HH:mm", { locale: ptBR });
  if (isYesterday(date)) return "Ontem";
  return format(date, "dd/MM", { locale: ptBR });
};

export const getInitials = (name?: string) => {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
};

interface ConversationRowProps {
  conv: Conversation;
  photo?: string;
  fallbackName?: string;
  selected: boolean;
  selectMode: boolean;
  checked: boolean;
  liveStage?: { stageTitle: string; eventName?: string } | null;
  cashbackAvailable?: number;
  attendant?: string | null;
  igUser?: string | null;
  onSelect: (conv: Conversation) => void;
  onToggle: (phone: string) => void;
}

/**
 * Linha da lista clássica de conversas. Memoizada: só é redesenhada quando os
 * dados DESTA conversa mudam (a lista-mãe preserva a identidade dos objetos que
 * não mudaram), e não a cada render da tela do WhatsApp.
 */
export const ConversationRow = memo(function ConversationRow({
  conv,
  photo,
  fallbackName,
  selected,
  selectMode,
  checked,
  liveStage,
  cashbackAvailable,
  attendant,
  igUser,
  onSelect,
  onToggle,
}: ConversationRowProps) {
  const displayName = conv.customerName || fallbackName;
  return (
    <button
      onClick={() => onSelect(conv)}
      className={cn(
        "w-full px-3 py-3 flex items-center gap-3 hover:bg-[#dde2e7] dark:hover:bg-[#202c33] transition-colors text-left border-b border-[#cfd6dc]/60 dark:border-[#1f2c34]",
        conv.hasUnansweredMessage && "animate-pulse bg-[#c7e9c0]/40 dark:bg-[#005c4b]/20",
        selected && "bg-[#cfd6dc] dark:bg-[#2a3942]",
        selectMode && checked && "bg-[#00a884]/15",
      )}
    >
      {selectMode && (
        <Checkbox
          checked={checked}
          className="h-4 w-4 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={() => onToggle(conv.phone)}
        />
      )}

      <Avatar className="h-12 w-12 flex-shrink-0">
        {photo ? <AvatarImage src={photo} /> : null}
        <AvatarFallback className={cn("text-white text-sm font-bold", conv.isGroup ? "bg-[#00a884]" : "bg-[#9aa6ad] text-white")}>
          {conv.isGroup ? <Users className="h-6 w-6" /> : getInitials(conv.customerName)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1 min-w-0">
              <span className="font-medium text-[15px] text-[#0b1419] dark:text-[#e9edef] truncate">
                {displayName || conv.phone}
              </span>
              {conv.hasOtherInstances && (
                <span className="text-[9px] text-orange-500 flex-shrink-0" title={conv.otherInstanceLabels?.join(", ") || "Outra instância"}>
                  🔗 {conv.otherInstanceLabels?.length ? `+${conv.otherInstanceLabels.length}` : ""}
                </span>
              )}
              {!!cashbackAvailable && cashbackAvailable > 0 && (
                <span
                  className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-400/40"
                  title={`Cashback disponível: R$ ${cashbackAvailable.toFixed(2).replace(".", ",")}`}
                >
                  💰 R$ {cashbackAvailable.toFixed(2).replace(".", ",")}
                </span>
              )}
            </div>

            {displayName && (
              <span className="text-[11px] text-[#475360] dark:text-[#667781] truncate">{conv.phone}</span>
            )}
            {liveStage && (
              <span className="mt-0.5 inline-flex items-center gap-1 self-start px-1.5 py-[1px] rounded text-[9px] font-semibold bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-400 border border-fuchsia-400/40">
                <Radio className="h-2.5 w-2.5" />
                LIVE · {liveStage.stageTitle}
                {liveStage.eventName ? ` · ${liveStage.eventName}` : ""}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <span className={cn("text-xs", conv.hasUnansweredMessage ? "text-[#00a884] font-medium" : "text-[#475360] dark:text-[#667781]")}>
              {formatConversationTime(conv.lastMessageAt)}
            </span>
            {attendant && (
              <span
                className="inline-flex items-center gap-0.5 max-w-[110px] px-1.5 py-[1px] rounded-full text-[9px] font-semibold bg-[#00a884]/15 text-[#017561] dark:text-[#25d366] border border-[#00a884]/30 truncate"
                title={`Atendente: ${attendant}`}
              >
                👤 <span className="truncate">{attendant}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[#475360] dark:text-[#8696a0] truncate flex-1">{conv.lastMessage}</p>
          <div className="flex items-center gap-1 flex-shrink-0">
            {conv.isAiTransferred && (
              <Badge className="text-[8px] px-1 py-0 leading-tight bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-400/40 hover:bg-orange-500/30">
                🤖 IA transferiu
              </Badge>
            )}
            {conv.channel === "instagram" && (
              <Badge
                className="text-[8px] px-1 py-0 leading-tight bg-pink-500/20 text-pink-600 dark:text-pink-400 border-pink-400/30 hover:bg-pink-500/30 max-w-[130px] truncate"
                title={igUser ? `Instagram @${igUser}` : "Instagram"}
              >
                📷 {igUser ? `@${igUser}` : "Instagram"}
              </Badge>
            )}
            {conv.channel === "messenger" && (
              <Badge className="text-[8px] px-1 py-0 leading-tight bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-400/30 hover:bg-blue-500/30">
                💬 Messenger
              </Badge>
            )}
            {!conv.channel && (conv.instanceLabel || conv.isGroup) && (
              <Badge
                variant="outline"
                className={cn("text-[8px] px-1 py-0 leading-tight", conv.whatsapp_number_id ? "text-blue-600 border-blue-400" : "text-green-600 border-green-400")}
              >
                {conv.instanceLabel || "WhatsApp"}
              </Badge>
            )}
            {conv.unreadCount > 0 && (
              <span className="h-5 min-w-5 px-1 rounded-full bg-[#00a884] text-white text-xs flex items-center justify-center font-bold">
                {conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
});
