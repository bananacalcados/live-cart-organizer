import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search, Users, MessageCircle, Wifi, CheckSquare, PhoneOff, Send,
  Radio, Bell, Bot, CheckCircle2, Archive, Megaphone, Eye
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Conversation, ChatFilter, StageFilter, InstanceFilter, ConversationStatusFilter } from "./ChatTypes";
import { WhatsAppNumber } from "@/stores/whatsappNumberStore";
import { TeamChatPinnedItem } from "./TeamChatPinnedItem";

interface ConversationListProps {
  conversations: Conversation[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectConversation: (phone: string, whatsappNumberId?: string | null) => void;
  chatFilter: ChatFilter;
  onChatFilterChange: (filter: ChatFilter) => void;
  stageFilter: StageFilter;
  onStageFilterChange: (stage: StageFilter) => void;
  instanceFilter: InstanceFilter;
  onInstanceFilterChange: (filter: InstanceFilter) => void;
  statusFilter: ConversationStatusFilter;
  onStatusFilterChange: (filter: ConversationStatusFilter) => void;
  metaNumbers: WhatsAppNumber[];
  contactPhotos?: Record<string, string>;
  contactNames?: Record<string, string>;
  selectedPhone?: string | null;
  selectedConversationKey?: string | null;
  onBulkFinish?: (phones: string[]) => void;
  onBulkMessage?: (phones: string[]) => void;
  onBulkMarkRead?: (phones: string[]) => void;
  hasActiveSupport?: (phone: string) => boolean;
  supportFilterActive?: boolean;
  onSupportFilterToggle?: () => void;
  supportCount?: number;
  contactTagsMap?: Record<string, string[]>;
  selectedTagFilters?: string[];
  onSelectedTagFiltersChange?: (tags: string[]) => void;
  liveFilterActive?: boolean;
  onLiveFilterToggle?: () => void;
  liveCount?: number;
  isLiveCustomer?: (phone: string) => boolean;
  liveStageMap?: Record<string, { stageTitle: string; eventName?: string; color?: string }>;
  teamChatActive?: boolean;
  onTeamChatClick?: () => void;
}

export function ConversationList({
  conversations,
  searchQuery,
  onSearchChange,
  onSelectConversation,
  chatFilter,
  onChatFilterChange,
  instanceFilter,
  onInstanceFilterChange,
  statusFilter,
  onStatusFilterChange,
  metaNumbers,
  contactPhotos = {},
  contactNames = {},
  selectedPhone,
  selectedConversationKey,
  onBulkFinish,
  onBulkMessage,
  onBulkMarkRead,
  liveFilterActive,
  onLiveFilterToggle,
  liveCount,
  isLiveCustomer,
  liveStageMap = {},
  teamChatActive,
  onTeamChatClick,
}: ConversationListProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());

  const formatConversationTime = (date: Date) => {
    if (isToday(date)) return format(date, 'HH:mm', { locale: ptBR });
    if (isYesterday(date)) return 'Ontem';
    return format(date, 'dd/MM', { locale: ptBR });
  };

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  };

  // Helper: clear all "rail/live" specials when picking a native pill
  const pickNativePill = (status: ConversationStatusFilter, chat: ChatFilter) => {
    if (liveFilterActive && onLiveFilterToggle) onLiveFilterToggle();
    onStatusFilterChange(status);
    onChatFilterChange(chat);
  };

  // Helper for rail icon click — toggles status filter
  const pickRailStatus = (status: ConversationStatusFilter) => {
    if (liveFilterActive && onLiveFilterToggle) onLiveFilterToggle();
    if (chatFilter !== 'all') onChatFilterChange('all');
    onStatusFilterChange(statusFilter === status ? 'all' : status);
  };

  // Apply filters
  const filteredConversations = conversations
    .filter(c => {
      if (chatFilter === 'contacts' && c.isGroup) return false;
      if (chatFilter === 'groups' && !c.isGroup) return false;
      return true;
    })
    .filter(c => {
      if (instanceFilter === 'all') return true;
      return c.whatsapp_number_id === instanceFilter;
    })
    .filter(c => {
      if (statusFilter === 'all') {
        return !c.isArchived && !c.isFinished && !c.isDispatchOnly;
      }
      if (statusFilter === 'dispatch') return c.isDispatchOnly && !c.isArchived;
      if (statusFilter === 'archived') return c.isArchived;
      if (statusFilter === 'awaiting_payment') return c.isAwaitingPayment && !c.isArchived;
      if (statusFilter === 'finished') return c.isFinished && !c.isArchived;
      if (statusFilter === 'ai_transferred') return c.isAiTransferred && !c.isFinished && !c.isArchived;
      if (c.isFinished || c.isArchived || c.isDispatchOnly) return false;
      return c.conversationStatus === statusFilter;
    })
    .filter(c => {
      if (liveFilterActive && isLiveCustomer) return isLiveCustomer(c.phone);
      return true;
    })
    .filter(c => {
      const cleanedQuery = searchQuery.replace(/\D/g, '');
      const nameMatch = c.customerName?.toLowerCase().includes(searchQuery.toLowerCase());
      const phoneMatch = cleanedQuery.length > 0 ? c.phone.includes(cleanedQuery) : false;
      return nameMatch || phoneMatch || (searchQuery === '');
    });

  const groupsCount = conversations.filter(c => c.isGroup && !c.isArchived && !c.isFinished).length;
  const newCount = conversations.filter(c => !c.isFinished && !c.isArchived && !c.isDispatchOnly && c.conversationStatus === 'not_started').length;
  const unreadCount = conversations.reduce((sum, c) => {
    if (c.isFinished || c.isArchived || c.isDispatchOnly) return sum;
    if (c.conversationStatus !== 'awaiting_reply') return sum;
    return sum + (c.unreadCount || 0);
  }, 0);

  // Rail counts
  const followUpCount = conversations.filter(c => !c.isFinished && !c.isArchived && !c.isDispatchOnly && c.conversationStatus === 'awaiting_customer').length;
  const aiCount = conversations.filter(c => c.isAiTransferred && !c.isFinished && !c.isArchived).length;
  const finishedCount = conversations.filter(c => c.isFinished && !c.isArchived).length;
  const archivedCount = conversations.filter(c => c.isArchived).length;
  const dispatchCount = conversations.filter(c => c.isDispatchOnly && !c.isArchived).length;

  // Instance tabs
  const instanceCounts: Record<string, number> = { all: conversations.filter(c => !c.isArchived).length };
  for (const c of conversations.filter(c => !c.isArchived)) {
    if (c.whatsapp_number_id) {
      instanceCounts[c.whatsapp_number_id] = (instanceCounts[c.whatsapp_number_id] || 0) + 1;
    }
  }
  const instanceTabs: { value: string; label: string; count: number }[] = [
    { value: 'all', label: 'Todas', count: instanceCounts['all'] || 0 },
  ];
  for (const num of metaNumbers) {
    instanceTabs.push({ value: num.id, label: num.label, count: instanceCounts[num.id] || 0 });
  }

  const togglePhone = (phone: string) => {
    setSelectedPhones(prev => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone); else next.add(phone);
      return next;
    });
  };
  const toggleAll = () => {
    if (selectedPhones.size === filteredConversations.length) setSelectedPhones(new Set());
    else setSelectedPhones(new Set(filteredConversations.map(c => c.phone)));
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedPhones(new Set()); };

  // Native-style pill
  const Pill = ({ label, active, count, onClick, badge }: { label: string; active: boolean; count?: number; onClick: () => void; badge?: boolean }) => (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5",
        active
          ? "bg-[#00a884] text-white"
          : "bg-[#d6dde2] dark:bg-[#202c33] text-[#3b4a52] dark:text-[#8696a0] hover:bg-[#c3cdd4] dark:hover:bg-[#2a3942]"
      )}
    >
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className={cn(
          "text-[10px] px-1.5 py-0 rounded-full",
          active ? "bg-white/25" : (badge ? "bg-amber-500 text-white animate-pulse" : "bg-black/10 dark:bg-white/10")
        )}>{count}</span>
      )}
    </button>
  );

  // Rail icon button
  const RailBtn = ({ icon: Icon, label, active, count, onClick, accent }: {
    icon: typeof Bell; label: string; active: boolean; count: number; onClick: () => void; accent?: string;
  }) => (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "relative w-12 h-12 rounded-xl flex items-center justify-center transition-all group",
        active
          ? (accent || "bg-[#00a884] text-white shadow-lg")
          : "text-white/55 hover:bg-white/10 hover:text-white"
      )}
    >
      <Icon className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border border-[#0b1419]">
          {count > 99 ? '99+' : count}
        </span>
      )}
      <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-[#0b1419] text-white text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl">
        {label}
      </span>
    </button>
  );

  // Native pill state
  const allActive = statusFilter === 'all' && chatFilter !== 'groups' && !liveFilterActive;
  const newActive = statusFilter === 'not_started' && !liveFilterActive;
  const unreadActive = statusFilter === 'awaiting_reply' && !liveFilterActive;
  const groupsActive = chatFilter === 'groups';

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#e4e8eb] dark:bg-[#0b1419]">
      {/* === Dark Rail (left) === */}
      <div className="w-14 flex-shrink-0 bg-[#0b1419] flex flex-col items-center py-3 gap-1 border-r border-black/40">
        <RailBtn icon={Bell} label="Follow Up" active={statusFilter === 'awaiting_customer'} count={followUpCount} onClick={() => pickRailStatus('awaiting_customer')} accent="bg-blue-500 text-white" />
        <RailBtn icon={Radio} label="Pedidos da Live" active={!!liveFilterActive} count={liveCount || 0} onClick={() => onLiveFilterToggle?.()} accent="bg-fuchsia-500 text-white" />
        <RailBtn icon={Bot} label="IA Transferiu" active={statusFilter === 'ai_transferred'} count={aiCount} onClick={() => pickRailStatus('ai_transferred')} accent="bg-orange-500 text-white" />
        <RailBtn icon={CheckCircle2} label="Finalizadas" active={statusFilter === 'finished'} count={finishedCount} onClick={() => pickRailStatus('finished')} accent="bg-emerald-600 text-white" />
        <RailBtn icon={Archive} label="Arquivadas" active={statusFilter === 'archived'} count={archivedCount} onClick={() => pickRailStatus('archived')} accent="bg-zinc-500 text-white" />
        <RailBtn icon={Megaphone} label="Disparos" active={statusFilter === 'dispatch'} count={dispatchCount} onClick={() => pickRailStatus('dispatch')} accent="bg-violet-500 text-white" />
      </div>

      {/* === Main column === */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* WhatsApp-style header */}
        <div className="px-4 pt-4 pb-2 bg-[#d6dde2] dark:bg-[#1a2329] flex-shrink-0">
          <h1 className="text-[22px] font-bold text-[#1a2329] dark:text-white tracking-tight mb-3">
            WhatsApp
            <span className="ml-2 text-xs font-semibold text-[#00a884]">{instanceCounts['all'] || 0}</span>
          </h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3b4a52] dark:text-[#8696a0]" />
            <Input
              placeholder="Pesquisar"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 h-9 bg-white/80 dark:bg-[#0b1419] border-0 rounded-full text-sm"
            />
          </div>
        </div>

        {/* Native filter pills */}
        <div className="px-3 py-2.5 bg-[#d6dde2] dark:bg-[#1a2329] flex gap-2 overflow-x-auto flex-shrink-0">
          <Pill label="Todas" active={allActive} onClick={() => pickNativePill('all', 'all')} />
          <Pill label="Novas" active={newActive} count={newCount} onClick={() => pickNativePill('not_started', 'all')} />
          <Pill label="Não lidas" active={unreadActive} count={unreadCount} badge={unreadCount > 0 && !unreadActive} onClick={() => pickNativePill('awaiting_reply', 'all')} />
          <Pill label="Grupos" active={groupsActive} count={groupsCount} onClick={() => pickNativePill('all', 'groups')} />
        </div>

        {/* Instance tabs (only when multiple) */}
        {instanceTabs.length > 2 && (
          <div className="px-3 py-1.5 bg-[#dde2e7] dark:bg-[#111b21] flex gap-1 overflow-x-auto flex-shrink-0 border-b border-[#c3cdd4] dark:border-[#1f2c34]">
            {instanceTabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => onInstanceFilterChange(tab.value)}
                className={cn(
                  "px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors flex items-center gap-1 flex-shrink-0",
                  instanceFilter === tab.value
                    ? "bg-[#075e54] text-white"
                    : "bg-white/60 dark:bg-[#202c33] text-[#3b4a52] dark:text-[#8696a0] hover:bg-white"
                )}
              >
                <Wifi className="h-2.5 w-2.5" />
                {tab.label}
                <span className={cn("text-[9px] px-1 rounded-full", instanceFilter === tab.value ? "bg-white/20" : "bg-black/10 dark:bg-white/10")}>{tab.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Bulk action bar */}
        {onBulkFinish && (
          <div className="px-2 py-1.5 border-b border-[#c3cdd4] dark:border-[#1f2c34] flex items-center gap-2 flex-shrink-0 bg-[#dde2e7] dark:bg-[#111b21]">
            {selectMode ? (
              <>
                <Checkbox
                  checked={selectedPhones.size === filteredConversations.length && filteredConversations.length > 0}
                  onCheckedChange={toggleAll}
                  className="h-4 w-4"
                />
                <span className="text-[11px] text-[#3b4a52] dark:text-[#8696a0] flex-1">
                  {selectedPhones.size} selecionada{selectedPhones.size !== 1 ? 's' : ''}
                </span>
                {onBulkMessage && (
                  <Button variant="default" size="sm" className="h-7 text-[11px] gap-1" disabled={selectedPhones.size === 0}
                    onClick={() => onBulkMessage(Array.from(selectedPhones))}>
                    <Send className="h-3 w-3" />Enviar ({selectedPhones.size})
                  </Button>
                )}
                <Button variant="destructive" size="sm" className="h-7 text-[11px] gap-1" disabled={selectedPhones.size === 0}
                  onClick={() => { onBulkFinish(Array.from(selectedPhones)); exitSelectMode(); }}>
                  <PhoneOff className="h-3 w-3" />Finalizar ({selectedPhones.size})
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={exitSelectMode}>Cancelar</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 text-[#3b4a52] dark:text-[#8696a0]"
                onClick={() => setSelectMode(true)}>
                <CheckSquare className="h-3.5 w-3.5" />Selecionar
              </Button>
            )}
          </div>
        )}

        {/* Pinned Team Chat */}
        {onTeamChatClick && (
          <div className="flex-shrink-0 bg-[#e4e8eb] dark:bg-[#0b1419]">
            <TeamChatPinnedItem isActive={!!teamChatActive} onClick={onTeamChatClick} />
          </div>
        )}

        {/* Conversations */}
        <ScrollArea className="flex-1 bg-[#e4e8eb] dark:bg-[#0b1419]" style={{ minHeight: 0 }}>
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-[#3b4a52] dark:text-[#667781]">
              <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Nenhuma conversa encontrada</p>
            </div>
          ) : (
            <div>
              {filteredConversations.map((conv) => (
                <button
                  key={conv.conversationKey || conv.phone}
                  onClick={() => {
                    if (selectMode) togglePhone(conv.phone);
                    else onSelectConversation(conv.phone, conv.whatsapp_number_id);
                  }}
                  className={cn(
                    "w-full px-3 py-3 flex items-center gap-3 hover:bg-[#dde2e7] dark:hover:bg-[#202c33] transition-colors text-left border-b border-[#cfd6dc]/60 dark:border-[#1f2c34]",
                    conv.hasUnansweredMessage && "bg-[#c7e9c0]/40 dark:bg-[#005c4b]/20",
                    (selectedConversationKey ? selectedConversationKey === conv.conversationKey : selectedPhone === conv.phone) && "bg-[#cfd6dc] dark:bg-[#2a3942]",
                    selectMode && selectedPhones.has(conv.phone) && "bg-[#00a884]/15"
                  )}
                >
                  {selectMode && (
                    <Checkbox
                      checked={selectedPhones.has(conv.phone)}
                      className="h-4 w-4 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => togglePhone(conv.phone)}
                    />
                  )}

                  <Avatar className="h-12 w-12 flex-shrink-0">
                    {contactPhotos[conv.phone] ? <AvatarImage src={contactPhotos[conv.phone]} /> : null}
                    <AvatarFallback className={cn(
                      "text-white text-sm font-bold",
                      conv.isGroup ? "bg-[#00a884]" : "bg-[#9aa6ad] text-white"
                    )}>
                      {conv.isGroup ? <Users className="h-6 w-6" /> : getInitials(conv.customerName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-medium text-[15px] text-[#0b1419] dark:text-[#e9edef] truncate">
                            {conv.customerName || contactNames[conv.phone] || conv.phone}
                          </span>
                          {conv.hasOtherInstances && (
                            <span className="text-[9px] text-orange-500 flex-shrink-0" title={conv.otherInstanceLabels?.join(', ') || 'Outra instância'}>
                              🔗 {conv.otherInstanceLabels?.length ? `+${conv.otherInstanceLabels.length}` : ''}
                            </span>
                          )}
                        </div>
                        {(conv.customerName || contactNames[conv.phone]) && (
                          <span className="text-[11px] text-[#475360] dark:text-[#667781] truncate">{conv.phone}</span>
                        )}
                        {liveStageMap[conv.phone] && (
                          <span className="mt-0.5 inline-flex items-center gap-1 self-start px-1.5 py-[1px] rounded text-[9px] font-semibold bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-400 border border-fuchsia-400/40">
                            <Radio className="h-2.5 w-2.5" />
                            LIVE · {liveStageMap[conv.phone].stageTitle}
                            {liveStageMap[conv.phone].eventName ? ` · ${liveStageMap[conv.phone].eventName}` : ''}
                          </span>
                        )}
                      </div>
                      <span className={cn(
                        "text-xs flex-shrink-0",
                        conv.hasUnansweredMessage ? "text-[#00a884] font-medium" : "text-[#475360] dark:text-[#667781]"
                      )}>
                        {formatConversationTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-[#475360] dark:text-[#8696a0] truncate flex-1">
                        {conv.lastMessage}
                      </p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {conv.isAiTransferred && (
                          <Badge className="text-[8px] px-1 py-0 leading-tight bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-400/40 hover:bg-orange-500/30">
                            🤖 IA transferiu
                          </Badge>
                        )}
                        {conv.channel === 'instagram' && (
                          <Badge className="text-[8px] px-1 py-0 leading-tight bg-pink-500/20 text-pink-600 dark:text-pink-400 border-pink-400/30 hover:bg-pink-500/30">
                            📷 Instagram
                          </Badge>
                        )}
                        {conv.channel === 'messenger' && (
                          <Badge className="text-[8px] px-1 py-0 leading-tight bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-400/30 hover:bg-blue-500/30">
                            💬 Messenger
                          </Badge>
                        )}
                        {!conv.channel && conv.instanceLabel && (
                          <Badge variant="outline" className={cn(
                            "text-[8px] px-1 py-0 leading-tight",
                            conv.whatsapp_number_id ? "text-blue-600 border-blue-400" : "text-green-600 border-green-400"
                          )}>
                            {conv.instanceLabel}
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
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
