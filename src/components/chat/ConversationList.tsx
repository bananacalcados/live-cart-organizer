import { useState } from "react";
import { Search, Phone, Users, MessageCircle, Filter, Wifi, Link2, CheckSquare, Square, PhoneOff, HeadphonesIcon } from "lucide-react";
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
import { STAGES } from "@/types/order";
import { WhatsAppNumber } from "@/stores/whatsappNumberStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  /** Optional: function to check if a phone has active support tickets */
  hasActiveSupport?: (phone: string) => boolean;
  /** Optional: whether support filter is active */
  supportFilterActive?: boolean;
  /** Optional: toggle support filter */
  onSupportFilterToggle?: () => void;
  /** Optional: count of conversations with active support */
  supportCount?: number;
}

const STATUS_TABS: { value: ConversationStatusFilter; label: string; shortLabel: string }[] = [
  { value: 'all', label: 'Todas', shortLabel: 'Todas' },
  { value: 'not_started', label: 'Não Iniciadas', shortLabel: 'Novas' },
  { value: 'awaiting_reply', label: 'Aguardando Resposta', shortLabel: 'Aguard.' },
  { value: 'awaiting_customer', label: 'Follow Up', shortLabel: 'Follow Up 🔄' },
  { value: 'awaiting_payment', label: 'Aguardando Pagamento', shortLabel: 'Pgto 💰' },
  { value: 'finished', label: 'Finalizadas', shortLabel: 'Finaliz.' },
  { value: 'archived', label: 'Arquivadas', shortLabel: 'Arquiv. 📦' },
];

export function ConversationList({
  conversations,
  searchQuery,
  onSearchChange,
  onSelectConversation,
  chatFilter,
  onChatFilterChange,
  stageFilter,
  onStageFilterChange,
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
  hasActiveSupport,
  supportFilterActive,
  onSupportFilterToggle,
  supportCount,
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

  // Apply filters
  const filteredConversations = conversations
    .filter(c => {
      if (chatFilter === 'contacts' && c.isGroup) return false;
      if (chatFilter === 'groups' && !c.isGroup) return false;
      return true;
    })
    .filter(c => {
      if (stageFilter !== 'all' && c.stage !== stageFilter) return false;
      return true;
    })
    .filter(c => {
      if (instanceFilter === 'all') return true;
      // When filtering by a specific instance ID, match that ID exactly
      // Also include NULL messages only under 'all' tab, not under specific instances
      return c.whatsapp_number_id === instanceFilter;
    })
    .filter(c => {
      if (statusFilter === 'all') {
        // "Todas" hides archived and finished conversations
        return !c.isArchived && !c.isFinished;
      }
      if (statusFilter === 'archived') return c.isArchived;
      if (statusFilter === 'awaiting_payment') return c.isAwaitingPayment && !c.isArchived;
      if (statusFilter === 'finished') return c.isFinished && !c.isArchived;
      if (c.isFinished || c.isArchived) return false;
      return c.conversationStatus === statusFilter;
    })
    .filter(c => {
      // Support filter
      if (supportFilterActive && hasActiveSupport) {
        return hasActiveSupport(c.phone);
      }
      return true;
    })
    .filter(c => {
      const cleanedQuery = searchQuery.replace(/\D/g, '');
      const nameMatch = c.customerName?.toLowerCase().includes(searchQuery.toLowerCase());
      const phoneMatch = cleanedQuery.length > 0 ? c.phone.includes(cleanedQuery) : false;
      return nameMatch || phoneMatch || (searchQuery === '');
    });

  const contactsCount = conversations.filter(c => !c.isGroup).length;
  const groupsCount = conversations.filter(c => c.isGroup).length;

  // Count per status
  const statusCounts: Record<ConversationStatusFilter, number> = {
    all: conversations.filter(c => !c.isArchived && !c.isFinished).length,
    not_started: conversations.filter(c => !c.isFinished && !c.isArchived && c.conversationStatus === 'not_started').length,
    awaiting_reply: conversations.filter(c => !c.isFinished && !c.isArchived && c.conversationStatus === 'awaiting_reply').length,
    awaiting_customer: conversations.filter(c => !c.isFinished && !c.isArchived && c.conversationStatus === 'awaiting_customer').length,
    awaiting_payment: conversations.filter(c => c.isAwaitingPayment && !c.isArchived).length,
    finished: conversations.filter(c => c.isFinished && !c.isArchived).length,
    archived: conversations.filter(c => c.isArchived).length,
  };

  // Count per instance (for tabs)
  const instanceCounts: Record<string, number> = { all: conversations.filter(c => !c.isArchived).length };
  for (const c of conversations.filter(c => !c.isArchived)) {
    if (c.whatsapp_number_id) {
      instanceCounts[c.whatsapp_number_id] = (instanceCounts[c.whatsapp_number_id] || 0) + 1;
    }
    // Don't count NULL as a separate "zapi" bucket - those are orphan messages
  }

  // Build instance tabs
  const instanceTabs: { value: string; label: string; count: number }[] = [
    { value: 'all', label: 'Todas', count: instanceCounts['all'] || 0 },
  ];
  // Add individual number tabs
  for (const num of metaNumbers) {
    const count = instanceCounts[num.id] || 0;
    instanceTabs.push({ value: num.id, label: num.label, count });
  }

  const togglePhone = (phone: string) => {
    setSelectedPhones(prev => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedPhones.size === filteredConversations.length) {
      setSelectedPhones(new Set());
    } else {
      setSelectedPhones(new Set(filteredConversations.map(c => c.phone)));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedPhones(new Set());
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white dark:bg-[#111b21]">{/* Search */}
      <div className="p-2 border-b border-[#e9edef] dark:border-[#313d45] space-y-2 flex-shrink-0 bg-white dark:bg-[#111b21]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#54656f]" />
          <Input
            placeholder="Buscar conversas..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 bg-[#f0f2f5] dark:bg-[#202c33] border-0 rounded-lg"
          />
        </div>

        {/* Instance filter tabs (above status tabs) */}
        {instanceTabs.length > 1 && (
          <div className="flex gap-1 overflow-x-auto pb-1">
            {instanceTabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => onInstanceFilterChange(tab.value)}
                className={cn(
                  "px-2 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0 flex items-center gap-1",
                  instanceFilter === tab.value
                    ? "bg-[#075e54] text-white"
                    : "bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]"
                )}
              >
                <Wifi className="h-3 w-3" />
                {tab.label}
                <span className={cn(
                  "text-[9px] px-1 rounded-full",
                  instanceFilter === tab.value ? "bg-white/20" : "bg-black/10 dark:bg-white/10"
                )}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Status filter tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => onStatusFilterChange(tab.value)}
              className={cn(
                "px-2 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0",
                statusFilter === tab.value
                  ? "bg-[#00a884] text-white"
                  : "bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]"
              )}
            >
              {tab.shortLabel}
              {statusCounts[tab.value] > 0 && (
                <span className="ml-1 text-[9px] opacity-80">({statusCounts[tab.value]})</span>
              )}
            </button>
          ))}
        </div>
        
        {/* Chat type filter */}
        <div className="flex gap-1">
          {(['all', 'contacts', 'groups'] as const).map(f => (
            <button
              key={f}
              onClick={() => onChatFilterChange(f)}
              className={cn(
                "flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors",
                chatFilter === f
                  ? "bg-[#00a884]/20 text-[#00a884]"
                  : "bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0]"
              )}
            >
              {f === 'all' ? 'Todas' : f === 'contacts' ? (
                <span className="flex items-center justify-center gap-1"><Phone className="h-3 w-3" />{contactsCount}</span>
              ) : (
                <span className="flex items-center justify-center gap-1"><Users className="h-3 w-3" />{groupsCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Support filter */}
        {onSupportFilterToggle && (
          <button
            onClick={onSupportFilterToggle}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-medium transition-colors",
              supportFilterActive
                ? "bg-orange-500/20 text-orange-400"
                : "bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]"
            )}
          >
            <HeadphonesIcon className="h-3 w-3" />
            Suporte Ativo
            {(supportCount || 0) > 0 && (
              <span className="ml-auto text-[9px] opacity-80">({supportCount})</span>
            )}
          </button>
        )}

        {/* Stage filter */}
        <Select value={stageFilter} onValueChange={onStageFilterChange}>
          <SelectTrigger className="h-8 text-xs bg-[#f0f2f5] dark:bg-[#202c33] border-0">
            <Filter className="h-3 w-3 mr-2" />
            <SelectValue placeholder="Filtrar por etapa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etapas</SelectItem>
            {STAGES.map(stage => (
              <SelectItem key={stage.id} value={stage.id}>
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", stage.color)} />
                  {stage.title}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar */}
      {onBulkFinish && (
        <div className="px-2 py-1.5 border-b border-[#e9edef] dark:border-[#313d45] flex items-center gap-2 flex-shrink-0 bg-white dark:bg-[#111b21]">
          {selectMode ? (
            <>
              <Checkbox
                checked={selectedPhones.size === filteredConversations.length && filteredConversations.length > 0}
                onCheckedChange={toggleAll}
                className="h-4 w-4"
              />
              <span className="text-[11px] text-muted-foreground flex-1">
                {selectedPhones.size} selecionada{selectedPhones.size !== 1 ? 's' : ''}
              </span>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-[11px] gap-1"
                disabled={selectedPhones.size === 0}
                onClick={() => {
                  onBulkFinish(Array.from(selectedPhones));
                  exitSelectMode();
                }}
              >
                <PhoneOff className="h-3 w-3" />
                Finalizar ({selectedPhones.size})
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={exitSelectMode}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] gap-1 text-muted-foreground"
              onClick={() => setSelectMode(true)}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              Selecionar
            </Button>
          )}
        </div>
      )}

      {/* Conversations */}
      <ScrollArea className="flex-1" style={{ minHeight: 0 }}>
        {filteredConversations.length === 0 ? (
          <div className="p-8 text-center text-[#667781]">
            <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <div>
            {filteredConversations.map((conv) => (
              <button
                key={conv.conversationKey || conv.phone}
                onClick={() => {
                  if (selectMode) {
                    togglePhone(conv.phone);
                  } else {
                    onSelectConversation(conv.phone, conv.whatsapp_number_id);
                  }
                }}
                className={cn(
                  "w-full px-3 py-3 flex items-center gap-3 hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-colors text-left border-b border-[#e9edef] dark:border-[#313d45]",
                  conv.hasUnansweredMessage && "bg-[#d9fdd3]/30 dark:bg-[#005c4b]/20",
                  (selectedConversationKey ? selectedConversationKey === conv.conversationKey : selectedPhone === conv.phone) && "bg-[#f0f2f5] dark:bg-[#2a3942]",
                  selectMode && selectedPhones.has(conv.phone) && "bg-[#00a884]/10"
                )}
              >
                {/* Checkbox in select mode */}
                {selectMode && (
                  <Checkbox
                    checked={selectedPhones.has(conv.phone)}
                    className="h-4 w-4 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={() => togglePhone(conv.phone)}
                  />
                )}

                {/* Avatar with photo */}
                <Avatar className="h-12 w-12 flex-shrink-0">
                  {contactPhotos[conv.phone] ? (
                    <AvatarImage src={contactPhotos[conv.phone]} />
                  ) : null}
                  <AvatarFallback className={cn(
                    "text-white text-sm font-bold",
                    conv.isGroup ? "bg-[#00a884]" : "bg-[#dfe5e7] text-[#54656f]"
                  )}>
                    {conv.isGroup ? (
                      <Users className="h-6 w-6" />
                    ) : (
                      getInitials(conv.customerName)
                    )}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="font-medium text-[15px] text-[#111b21] dark:text-[#e9edef] truncate">
                          {conv.customerName || contactNames[conv.phone] || conv.phone}
                        </span>
                        {conv.hasOtherInstances && (
                          <span className="text-[9px] text-orange-400 flex-shrink-0" title={conv.otherInstanceLabels?.join(', ') || 'Outra instância'}>
                            🔗 {conv.otherInstanceLabels?.length ? `+${conv.otherInstanceLabels.length}` : ''}
                          </span>
                        )}
                      </div>
                      {(conv.customerName || contactNames[conv.phone]) && (
                        <span className="text-[11px] text-[#667781] truncate">{conv.phone}</span>
                      )}
                    </div>
                    <span className={cn(
                      "text-xs flex-shrink-0",
                      conv.hasUnansweredMessage ? "text-[#00a884] font-medium" : "text-[#667781]"
                    )}>
                      {formatConversationTime(conv.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-[#667781] truncate flex-1">
                      {conv.lastMessage}
                    </p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {conv.instanceLabel && (
                        <Badge variant="outline" className={cn(
                          "text-[8px] px-1 py-0 leading-tight",
                          conv.whatsapp_number_id 
                            ? "text-blue-500 border-blue-300" 
                            : "text-green-500 border-green-300"
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
  );
}
