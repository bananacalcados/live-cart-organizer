import { Search, Phone, Users, MessageCircle, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Conversation, ChatFilter, StageFilter } from "./ChatTypes";
import { STAGES } from "@/types/order";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface ConversationListProps {
  conversations: Conversation[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectConversation: (phone: string) => void;
  chatFilter: ChatFilter;
  onChatFilterChange: (filter: ChatFilter) => void;
  stageFilter: StageFilter;
  onStageFilterChange: (stage: StageFilter) => void;
}

export function ConversationList({
  conversations,
  searchQuery,
  onSearchChange,
  onSelectConversation,
  chatFilter,
  onChatFilterChange,
  stageFilter,
  onStageFilterChange,
}: ConversationListProps) {
  const formatConversationTime = (date: Date) => {
    if (isToday(date)) {
      return format(date, 'HH:mm', { locale: ptBR });
    }
    if (isYesterday(date)) {
      return 'Ontem';
    }
    return format(date, 'dd/MM', { locale: ptBR });
  };

  // Apply filters
  const filteredConversations = conversations
    .filter(c => {
      // Chat type filter
      if (chatFilter === 'contacts' && c.isGroup) return false;
      if (chatFilter === 'groups' && !c.isGroup) return false;
      return true;
    })
    .filter(c => {
      // Stage filter
      if (stageFilter !== 'all' && c.stage !== stageFilter) return false;
      return true;
    })
    .filter(c =>
      c.phone.includes(searchQuery) ||
      c.customerName?.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const contactsCount = conversations.filter(c => !c.isGroup).length;
  const groupsCount = conversations.filter(c => c.isGroup).length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversas..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        
        {/* Filters */}
        <div className="flex gap-2">
          <Tabs value={chatFilter} onValueChange={(v) => onChatFilterChange(v as ChatFilter)} className="flex-1">
            <TabsList className="w-full h-8">
              <TabsTrigger value="all" className="flex-1 text-xs h-7">
                Todas
              </TabsTrigger>
              <TabsTrigger value="contacts" className="flex-1 text-xs h-7">
                <Phone className="h-3 w-3 mr-1" />
                {contactsCount}
              </TabsTrigger>
              <TabsTrigger value="groups" className="flex-1 text-xs h-7">
                <Users className="h-3 w-3 mr-1" />
                {groupsCount}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Stage filter */}
        <Select value={stageFilter} onValueChange={onStageFilterChange}>
          <SelectTrigger className="h-8 text-xs">
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

      {/* Conversations */}
      <ScrollArea className="flex-1">
        {filteredConversations.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredConversations.map((conv) => (
              <button
                key={conv.phone}
                onClick={() => onSelectConversation(conv.phone)}
                className={cn(
                  "w-full p-3 flex items-start gap-3 hover:bg-secondary/50 transition-colors text-left",
                  conv.hasUnansweredMessage && "bg-yellow-100 dark:bg-yellow-900/30 hover:bg-yellow-200 dark:hover:bg-yellow-900/50"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full flex-shrink-0",
                  conv.isGroup ? "bg-blue-500/20 text-blue-500" : "bg-stage-paid/20 text-stage-paid"
                )}>
                  {conv.isGroup ? (
                    <Users className="h-5 w-5" />
                  ) : (
                    <Phone className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm truncate">
                      {conv.customerName || conv.phone}
                    </span>
                    <span className={cn(
                      "text-xs",
                      conv.hasUnansweredMessage ? "text-yellow-600 dark:text-yellow-400 font-medium" : "text-muted-foreground"
                    )}>
                      {formatConversationTime(conv.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground truncate flex-1">
                      {conv.lastMessage}
                    </p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {conv.customerTags?.slice(0, 2).map(tag => (
                        <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                          {tag}
                        </Badge>
                      ))}
                      {conv.unreadCount > 0 && (
                        <span className="h-5 min-w-5 px-1 rounded-full bg-stage-paid text-white text-xs flex items-center justify-center">
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
