import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search, Users, MessageCircle, Wifi, CheckSquare, PhoneOff, Send,
  Radio, Bell, Bot, CheckCircle2, Archive, Megaphone, Eye, PackageCheck,
  Globe, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  /** Number of arrived (restocked) product-wait notifications, drives the pulsing badge */
  productArrivedCount?: number;
  /** Resolves the attendant name handling a conversation, by conversation key */
  getAssignedName?: (conversationKey: string) => string | null;
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
  productArrivedCount = 0,
  getAssignedName,
}: ConversationListProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [visibleLimit, setVisibleLimit] = useState(60);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Busca global no banco (todas as instâncias, inclusive finalizadas/arquivadas)
  type GlobalResult = {
    phone: string;
    whatsapp_number_id: string | null;
    instance_label: string | null;
    sender_name: string | null;
    last_message: string | null;
    last_message_at: string | null;
    message_count: number;
    is_finished: boolean;
    is_archived: boolean;
  };
  const [globalResults, setGlobalResults] = useState<GlobalResult[] | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);

  const runGlobalSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 3) return;
    setGlobalLoading(true);
    try {
      const { data, error } = await supabase.rpc("search_all_conversations", { p_query: q });
      if (error) throw error;
      setGlobalResults((data || []) as GlobalResult[]);
    } catch (e) {
      console.error("Erro na busca global de conversas:", e);
      setGlobalResults([]);
    } finally {
      setGlobalLoading(false);
    }
  };

  // Limpa resultados globais ao trocar o termo de busca
  useEffect(() => {
    setGlobalResults(null);
  }, [searchQuery]);


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
      if (statusFilter === 'awaiting_product') return c.isAwaitingProduct && !c.isArchived;
      if (statusFilter === 'finished') return c.isFinished && !c.isArchived;
      if (statusFilter === 'ai_transferred') return c.isAiTransferred && !c.isFinished && !c.isArchived;
      if (c.isFinished || c.isArchived || c.isDispatchOnly) return false;
      return c.conversationStatus === statusFilter;
    })
    .filter(c => {
      if (liveFilterActive && isLiveCustomer) {
        // Finalized/archived conversations must leave the live filter too.
        if (c.isFinished || c.isArchived) return false;
        return isLiveCustomer(c.phone);
      }
      return true;
    })
    .filter(c => {
      const cleanedQuery = searchQuery.replace(/\D/g, '');
      const nameMatch = c.customerName?.toLowerCase().includes(searchQuery.toLowerCase());
      const phoneMatch = cleanedQuery.length > 0 ? c.phone.includes(cleanedQuery) : false;
      return nameMatch || phoneMatch || (searchQuery === '');
    });

  const groupsCount = conversations.filter(c => c.isGroup && !c.isArchived && !c.isFinished).length;
  const newCount = conversations.filter(c => !c.isFinished && !c.isArchived && !c.isDispatchOnly && !c.isAwaitingProduct && c.conversationStatus === 'not_started').length;
  // "Não lidas" = number of conversations awaiting our reply (chats, not messages).
  // `conversations` is already scoped to the store's accessible instances, so this
  // badge automatically reflects only the unread count for the current PDV.
  // Conversations marked as "waiting for product restock" are intentionally
  // excluded so they don't inflate the unanswered/open metrics.
  const unreadCount = conversations.filter(c =>
    !c.isFinished && !c.isArchived && !c.isDispatchOnly && !c.isAwaitingProduct && c.conversationStatus === 'awaiting_reply'
  ).length;

  // Rail counts
  const followUpCount = conversations.filter(c => !c.isFinished && !c.isArchived && !c.isDispatchOnly && !c.isAwaitingProduct && c.conversationStatus === 'awaiting_customer').length;
  const aiCount = conversations.filter(c => c.isAiTransferred && !c.isFinished && !c.isArchived).length;
  // "Espera Produtos": clients waiting for a restock note (kept out of open metrics).
  const awaitingProductCount = conversations.filter(c => c.isAwaitingProduct && !c.isArchived).length;
  // Finalizadas intentionally has no count badge — its purpose is to declutter
  // the chat list, not to track how many are finished.
  const archivedCount = conversations.filter(c => c.isArchived).length;
  const dispatchCount = conversations.filter(c => c.isDispatchOnly && !c.isArchived).length;

  // Instance tabs — count matches what 'all' filter renders (open conversations only)
  const openConvs = conversations.filter(c => !c.isArchived && !c.isFinished && !c.isDispatchOnly);
  const instanceCounts: Record<string, number> = { all: openConvs.length };
  for (const c of openConvs) {
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

  // Reset visible window when filters change so users always start from the top
  useEffect(() => {
    setVisibleLimit(60);
  }, [chatFilter, statusFilter, instanceFilter, searchQuery, liveFilterActive]);

  const visibleConversations = filteredConversations.slice(0, visibleLimit);
  const hasMore = filteredConversations.length > visibleConversations.length;

  // Infinite scroll sentinel
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleLimit((n) => n + 60);
      }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visibleLimit, filteredConversations.length]);


  // Native-style pill
  const Pill = ({ label, active, count, onClick, badge }: { label: string; active: boolean; count?: number; onClick: () => void; badge?: boolean }) => (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 flex-shrink-0",
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
        <RailBtn icon={CheckCircle2} label="Finalizadas" active={statusFilter === 'finished'} count={0} onClick={() => pickRailStatus('finished')} accent="bg-emerald-600 text-white" />
        <RailBtn icon={Archive} label="Arquivadas" active={statusFilter === 'archived'} count={archivedCount} onClick={() => pickRailStatus('archived')} accent="bg-zinc-500 text-white" />
        <RailBtn icon={Megaphone} label="Disparos" active={statusFilter === 'dispatch'} count={dispatchCount} onClick={() => pickRailStatus('dispatch')} accent="bg-violet-500 text-white" />
        <RailBtn icon={PackageCheck} label="Espera Produtos" active={statusFilter === 'awaiting_product'} count={productArrivedCount || awaitingProductCount} onClick={() => pickRailStatus('awaiting_product')} accent="bg-amber-500 text-white" />
      </div>

      {/* === Main column === */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* WhatsApp-style header */}
        <div className="px-3 pt-2 pb-1.5 sm:px-4 sm:pt-4 sm:pb-2 bg-[#d6dde2] dark:bg-[#1a2329] flex-shrink-0">
          <h1 className="text-base sm:text-[22px] font-bold text-[#1a2329] dark:text-white tracking-tight mb-1.5 sm:mb-3">
            WhatsApp
            <span className="ml-2 text-xs font-semibold text-[#00a884]">{instanceCounts['all'] || 0}</span>
          </h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3b4a52] dark:text-[#8696a0]" />
            <Input
              placeholder="Pesquisar"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 h-8 sm:h-9 bg-white/80 dark:bg-[#0b1419] border-0 rounded-full text-sm"
            />
          </div>
        </div>

        {/* Native filter pills — single scrollable row on mobile, wraps on desktop */}
        <div className="px-3 py-1.5 sm:py-2.5 bg-[#d6dde2] dark:bg-[#1a2329] flex gap-2 overflow-x-auto scrollbar-hide sm:flex-wrap sm:overflow-visible flex-shrink-0">
          <Pill label="Todas" active={allActive} onClick={() => pickNativePill('all', 'all')} />
          <Pill label="Novas" active={newActive} count={newCount} onClick={() => pickNativePill('not_started', 'all')} />
          <Pill label="Não lidas" active={unreadActive} count={unreadCount} badge={unreadCount > 0 && !unreadActive} onClick={() => pickNativePill('awaiting_reply', 'all')} />
          <Pill label="Grupos" active={groupsActive} count={groupsCount} onClick={() => pickNativePill('all', 'groups')} />
          <Pill label="Follow Up" active={statusFilter === 'awaiting_customer' && !liveFilterActive} count={followUpCount} onClick={() => pickRailStatus('awaiting_customer')} />
          <Pill label="Pedidos da Live" active={!!liveFilterActive} count={liveCount || 0} onClick={() => onLiveFilterToggle?.()} />
          <Pill label="IA Transferiu" active={statusFilter === 'ai_transferred' && !liveFilterActive} count={aiCount} badge={aiCount > 0 && statusFilter !== 'ai_transferred'} onClick={() => pickRailStatus('ai_transferred')} />
          <Pill label="Finalizadas" active={statusFilter === 'finished' && !liveFilterActive} onClick={() => pickRailStatus('finished')} />
          <Pill label="Arquivadas" active={statusFilter === 'archived' && !liveFilterActive} count={archivedCount} onClick={() => pickRailStatus('archived')} />
          <Pill label="Disparos" active={statusFilter === 'dispatch' && !liveFilterActive} count={dispatchCount} onClick={() => pickRailStatus('dispatch')} />
          <Pill label="Espera Produtos" active={statusFilter === 'awaiting_product' && !liveFilterActive} count={awaitingProductCount} badge={productArrivedCount > 0 && statusFilter !== 'awaiting_product'} onClick={() => pickRailStatus('awaiting_product')} />
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
                {onBulkMarkRead && (
                  <Button variant="secondary" size="sm" className="h-7 text-[11px] gap-1" disabled={selectedPhones.size === 0}
                    onClick={() => { onBulkMarkRead(Array.from(selectedPhones)); exitSelectMode(); }}>
                    <Eye className="h-3 w-3" />Marcar lida ({selectedPhones.size})
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
              {visibleConversations.map((conv) => (
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
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <span className={cn(
                          "text-xs",
                          conv.hasUnansweredMessage ? "text-[#00a884] font-medium" : "text-[#475360] dark:text-[#667781]"
                        )}>
                          {formatConversationTime(conv.lastMessageAt)}
                        </span>
                        {(() => {
                          const attendant = getAssignedName?.(conv.conversationKey || `${conv.phone}__${conv.whatsapp_number_id || 'none'}`);
                          if (!attendant) return null;
                          return (
                            <span
                              className="inline-flex items-center gap-0.5 max-w-[110px] px-1.5 py-[1px] rounded-full text-[9px] font-semibold bg-[#00a884]/15 text-[#017561] dark:text-[#25d366] border border-[#00a884]/30 truncate"
                              title={`Atendente: ${attendant}`}
                            >
                              👤 <span className="truncate">{attendant}</span>
                            </span>
                          );
                        })()}
                      </div>
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
                        {!conv.channel && (conv.instanceLabel || conv.isGroup) && (
                          <Badge variant="outline" className={cn(
                            "text-[8px] px-1 py-0 leading-tight",
                            conv.whatsapp_number_id ? "text-blue-600 border-blue-400" : "text-green-600 border-green-400"
                          )}>
                            {conv.instanceLabel || 'WhatsApp'}
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
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="py-4 text-center text-[11px] text-[#475360] dark:text-[#667781]"
                >
                  Carregando mais conversas… ({visibleConversations.length}/{filteredConversations.length})
                </div>
              )}
              {!hasMore && filteredConversations.length > 20 && (
                <div className="py-4 text-center text-[10px] text-[#475360]/60 dark:text-[#667781]/60">
                  Fim · {filteredConversations.length} conversas
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
