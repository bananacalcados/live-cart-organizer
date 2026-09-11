import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import {
  Search, MessageCircle, Wifi, CheckSquare, PhoneOff, Send,
  Radio, Bell, Bot, CheckCircle2, Archive, Megaphone, Eye, PackageCheck,
  Globe, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Conversation, ChatFilter, StageFilter, InstanceFilter, ConversationStatusFilter } from "./ChatTypes";
import { WhatsAppNumber } from "@/stores/whatsappNumberStore";
import { TeamChatPinnedItem } from "./TeamChatPinnedItem";
import { ConversationRow, formatConversationTime, getInitials } from "./ConversationRow";
import { useDebouncedSearchInput } from "@/hooks/useDebouncedSearchInput";

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
  /** Map whatsapp_number_id -> @username da conta de Instagram (para rotular DMs) */
  igUsernameById?: Record<string, string>;
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
  /** Cashback disponível por telefone (soma dos cupons ativos) para exibir badge ao lado do nome */
  cashbackMap?: Map<string, { totalAvailable: number }>;
}

// Defaults com identidade estável (um `= {}` inline criaria um objeto novo a cada
// render e anularia a memoização das linhas).
const EMPTY_RECORD: Record<string, never> = Object.freeze({}) as Record<string, never>;

/**
 * Lista clássica de conversas. Memoizada: a tela-mãe do WhatsApp redesenha por
 * muitos motivos (envio, dados do cliente, diálogos...) e a lista só precisa
 * acompanhar quando as conversas/filtros realmente mudam.
 */
export const ConversationList = memo(function ConversationList({
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
  igUsernameById = EMPTY_RECORD,
  contactPhotos = EMPTY_RECORD,
  contactNames = EMPTY_RECORD,
  selectedPhone,
  selectedConversationKey,
  onBulkFinish,
  onBulkMessage,
  onBulkMarkRead,
  liveFilterActive,
  onLiveFilterToggle,
  liveCount,
  isLiveCustomer,
  liveStageMap = EMPTY_RECORD,
  teamChatActive,
  onTeamChatClick,
  productArrivedCount = 0,
  getAssignedName,
  cashbackMap,
}: ConversationListProps) {

  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [visibleLimit, setVisibleLimit] = useState(60);
  // Campo de busca com resposta imediata; o filtro (no pai) só roda após pausa.
  const [searchInput, setSearchInput] = useDebouncedSearchInput(searchQuery, onSearchChange, 250);
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

  const runGlobalSearch = async (term?: string) => {
    const q = (term ?? searchQuery).trim();
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

  // Apply filters — memoizado: uma única passagem, só recalcula quando a lista
  // ou algum filtro muda (antes: 5 passagens a cada render da tela).
  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim();
    const qLower = q.toLowerCase();
    const cleanedQuery = q.replace(/\D/g, '');
    return conversations.filter(c => {
      if (chatFilter === 'contacts' && c.isGroup) return false;
      if (chatFilter === 'groups' && !c.isGroup) return false;
      if (instanceFilter !== 'all' && c.whatsapp_number_id !== instanceFilter) return false;

      if (statusFilter === 'all') {
        if (c.isArchived || c.isFinished || c.isDispatchOnly) return false;
      } else if (statusFilter === 'dispatch') {
        if (!(c.isDispatchOnly && !c.isArchived)) return false;
      } else if (statusFilter === 'archived') {
        if (!c.isArchived) return false;
      } else if (statusFilter === 'awaiting_payment') {
        if (!(c.isAwaitingPayment && !c.isArchived)) return false;
      } else if (statusFilter === 'awaiting_product') {
        if (!(c.isAwaitingProduct && !c.isArchived)) return false;
      } else if (statusFilter === 'finished') {
        if (!(c.isFinished && !c.isArchived)) return false;
      } else if (statusFilter === 'ai_transferred') {
        if (!(c.isAiTransferred && !c.isFinished && !c.isArchived)) return false;
      } else {
        if (c.isFinished || c.isArchived || c.isDispatchOnly) return false;
        if (c.conversationStatus !== statusFilter) return false;
      }

      if (liveFilterActive && isLiveCustomer) {
        // Finalized/archived conversations must leave the live filter too.
        if (c.isFinished || c.isArchived) return false;
        if (!isLiveCustomer(c.phone)) return false;
      }

      if (q === '') return true;
      const nameMatch = !!c.customerName?.toLowerCase().includes(qLower);
      const phoneMatch = cleanedQuery.length > 0 ? c.phone.includes(cleanedQuery) : false;
      return nameMatch || phoneMatch;
    });
  }, [conversations, chatFilter, instanceFilter, statusFilter, liveFilterActive, isLiveCustomer, searchQuery]);

  // Contadores das abas/pílulas — uma única passagem, memoizada.
  const counts = useMemo(() => {
    let groupsCount = 0, newCount = 0, unreadCount = 0, followUpCount = 0, aiCount = 0,
      awaitingProductCount = 0, archivedCount = 0, dispatchCount = 0;
    const instanceCounts: Record<string, number> = { all: 0 };
    for (const c of conversations) {
      if (c.isArchived) { archivedCount++; continue; }
      if (c.isDispatchOnly) dispatchCount++;
      if (c.isAwaitingProduct) awaitingProductCount++;
      if (c.isGroup && !c.isFinished) groupsCount++;
      if (c.isAiTransferred && !c.isFinished) aiCount++;
      const open = !c.isFinished && !c.isDispatchOnly;
      if (open) {
        instanceCounts.all++;
        if (c.whatsapp_number_id) instanceCounts[c.whatsapp_number_id] = (instanceCounts[c.whatsapp_number_id] || 0) + 1;
        if (!c.isAwaitingProduct) {
          if (c.conversationStatus === 'not_started') newCount++;
          // "Não lidas" = conversas aguardando NOSSA resposta (chats, não mensagens).
          // Conversas em "espera de produto" ficam fora para não inflar as métricas.
          else if (c.conversationStatus === 'awaiting_reply') unreadCount++;
          else if (c.conversationStatus === 'awaiting_customer') followUpCount++;
        }
      }
    }
    return { groupsCount, newCount, unreadCount, followUpCount, aiCount, awaitingProductCount, archivedCount, dispatchCount, instanceCounts };
  }, [conversations]);
  const { groupsCount, newCount, unreadCount, followUpCount, aiCount, awaitingProductCount, archivedCount, dispatchCount, instanceCounts } = counts;

  // Instance tabs — count matches what 'all' filter renders (open conversations only)
  const instanceTabs = useMemo(() => {
    const tabs: { value: string; label: string; count: number }[] = [
      { value: 'all', label: 'Todas', count: instanceCounts['all'] || 0 },
    ];
    for (const num of metaNumbers) {
      tabs.push({ value: num.id, label: num.label, count: instanceCounts[num.id] || 0 });
    }
    return tabs;
  }, [instanceCounts, metaNumbers]);

  const togglePhone = useCallback((phone: string) => {
    setSelectedPhones(prev => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone); else next.add(phone);
      return next;
    });
  }, []);
  const toggleAll = () => {
    if (selectedPhones.size === filteredConversations.length) setSelectedPhones(new Set());
    else setSelectedPhones(new Set(filteredConversations.map(c => c.phone)));
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedPhones(new Set()); };

  // Callbacks ESTÁVEIS para as linhas memoizadas (a versão mais recente fica em ref).
  const rowLatestRef = useRef({ selectMode, onSelectConversation, togglePhone });
  rowLatestRef.current = { selectMode, onSelectConversation, togglePhone };
  const handleRowSelect = useCallback((conv: Conversation) => {
    const { selectMode: sm, onSelectConversation: sel, togglePhone: tp } = rowLatestRef.current;
    if (sm) tp(conv.phone);
    else sel(conv.phone, conv.whatsapp_number_id);
  }, []);

  // Reset visible window when filters change so users always start from the top
  useEffect(() => {
    setVisibleLimit(60);
  }, [chatFilter, statusFilter, instanceFilter, searchQuery, liveFilterActive]);

  const visibleConversations = useMemo(
    () => filteredConversations.slice(0, visibleLimit),
    [filteredConversations, visibleLimit],
  );
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
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runGlobalSearch(searchInput); }}
              className="pl-9 h-8 sm:h-9 bg-white/80 dark:bg-[#0b1419] border-0 rounded-full text-sm"
            />
          </div>
          {searchInput.trim().length >= 3 && (
            <button
              onClick={() => runGlobalSearch(searchInput)}
              disabled={globalLoading}
              className="mt-1.5 w-full flex items-center justify-center gap-1.5 rounded-full bg-[#075e54] text-white text-[11px] font-semibold py-1.5 hover:bg-[#064a42] disabled:opacity-60 transition-colors"
            >
              {globalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
              Buscar em todo o histórico (finalizadas e outras instâncias)
            </button>
          )}
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
          {/* Resultados da busca global no banco (todas as instâncias, inclusive finalizadas/arquivadas) */}
          {globalResults !== null && (
            <div className="border-b-2 border-[#075e54]/40">
              <div className="px-3 py-1.5 bg-[#075e54]/10 dark:bg-[#075e54]/20 flex items-center gap-1.5 text-[11px] font-bold text-[#075e54] dark:text-[#00a884]">
                <Globe className="h-3 w-3" />
                Histórico completo — {globalResults.length} resultado(s)
              </div>
              {globalResults.length === 0 ? (
                <div className="px-3 py-4 text-center text-[12px] text-[#3b4a52] dark:text-[#667781]">
                  Nenhuma conversa encontrada no histórico para este número/nome.
                </div>
              ) : (
                globalResults.map((r) => (
                  <button
                    key={`${r.phone}__${r.whatsapp_number_id || 'none'}`}
                    onClick={() => onSelectConversation(r.phone, r.whatsapp_number_id)}
                    className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-[#dde2e7] dark:hover:bg-[#202c33] transition-colors text-left border-b border-[#cfd6dc]/60 dark:border-[#1f2c34]"
                  >
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      {contactPhotos[r.phone] ? <AvatarImage src={contactPhotos[r.phone]} /> : null}
                      <AvatarFallback className="bg-[#9aa6ad] text-white text-xs font-bold">
                        {getInitials(r.sender_name || contactNames[r.phone] || r.phone)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="font-medium text-[14px] text-[#0b1419] dark:text-[#e9edef] truncate">
                          {r.sender_name || contactNames[r.phone] || r.phone}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#475360] dark:text-[#667781] truncate block">{r.phone}</span>
                      <div className="flex items-center gap-1 flex-wrap mt-0.5">
                        {r.instance_label && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[9px] font-semibold bg-[#075e54]/15 text-[#075e54] dark:text-[#00a884]">
                            <Wifi className="h-2.5 w-2.5" />{r.instance_label}
                          </span>
                        )}
                        {r.is_finished && (
                          <span className="px-1.5 py-[1px] rounded text-[9px] font-semibold bg-slate-400/25 text-slate-600 dark:text-slate-300">Finalizada</span>
                        )}
                        {r.is_archived && (
                          <span className="px-1.5 py-[1px] rounded text-[9px] font-semibold bg-amber-400/25 text-amber-700 dark:text-amber-400">Arquivada</span>
                        )}
                        <span className="px-1.5 py-[1px] rounded text-[9px] font-semibold bg-[#00a884]/15 text-[#00a884]">{r.message_count} msg</span>
                      </div>
                    </div>
                    {r.last_message_at && (
                      <span className="text-[10px] text-[#475360] dark:text-[#667781] flex-shrink-0 self-start">
                        {formatConversationTime(new Date(r.last_message_at))}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-[#3b4a52] dark:text-[#667781]">
              <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Nenhuma conversa encontrada</p>
            </div>
          ) : (
            <div>
              {visibleConversations.map((conv) => {
                const convKey = conv.conversationKey || `${conv.phone}__${conv.whatsapp_number_id || 'none'}`;
                return (
                  <ConversationRow
                    key={conv.conversationKey || conv.phone}
                    conv={conv}
                    photo={contactPhotos[conv.phone]}
                    fallbackName={contactNames[conv.phone]}
                    selected={selectedConversationKey ? selectedConversationKey === conv.conversationKey : selectedPhone === conv.phone}
                    selectMode={selectMode}
                    checked={selectMode && selectedPhones.has(conv.phone)}
                    liveStage={liveStageMap[conv.phone] || null}
                    cashbackAvailable={cashbackMap?.get(conv.phone)?.totalAvailable}
                    attendant={getAssignedName?.(convKey) ?? null}
                    igUser={conv.channel === 'instagram' && conv.whatsapp_number_id ? igUsernameById[conv.whatsapp_number_id] ?? null : null}
                    onSelect={handleRowSelect}
                    onToggle={togglePhone}
                  />
                );
              })}
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
});
