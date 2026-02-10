import { useRef, useEffect, useState } from "react";
import { Send, Tag, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { EmojiPickerButton } from "../EmojiPickerButton";
import { Message, Conversation } from "./ChatTypes";
import { useCustomerStore } from "@/stores/customerStore";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ChatViewProps {
  messages: Message[];
  conversation: Conversation | null;
  newMessage: string;
  onNewMessageChange: (message: string) => void;
  onSendMessage: () => void;
  isSending: boolean;
}

const PREDEFINED_TAGS = [
  "VIP", "Novo", "Recorrente", "Atacado", "Influencer", "Problemático"
];

export function ChatView({
  messages,
  conversation,
  newMessage,
  onNewMessageChange,
  onSendMessage,
  isSending,
}: ChatViewProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [newTag, setNewTag] = useState("");
  const { addTagToCustomer, removeTagFromCustomer, customers } = useCustomerStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatMessageTime = (date: Date) => {
    return format(date, 'HH:mm', { locale: ptBR });
  };

  const customer = conversation?.customerId 
    ? customers.find(c => c.id === conversation.customerId)
    : null;
  const customerTags = customer?.tags || [];

  const handleAddTag = (tag: string) => {
    if (conversation?.customerId && tag.trim()) {
      addTagToCustomer(conversation.customerId, tag.trim());
      setNewTag("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    if (conversation?.customerId) {
      removeTagFromCustomer(conversation.customerId, tag);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Tags bar */}
      {conversation && !conversation.isGroup && (
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center gap-2 flex-wrap">
          <Tag className="h-3 w-3 text-muted-foreground" />
          {customerTags.map(tag => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1">
              {tag}
              <button onClick={() => handleRemoveTag(tag)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Tag
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start">
              <div className="space-y-2">
                <div className="flex gap-1">
                  <Input
                    placeholder="Nova tag..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    className="h-7 text-xs"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTag(newTag)}
                  />
                  <Button size="sm" className="h-7" onClick={() => handleAddTag(newTag)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {PREDEFINED_TAGS.filter(t => !customerTags.includes(t)).map(tag => (
                    <Badge 
                      key={tag} 
                      variant="outline" 
                      className="text-xs cursor-pointer hover:bg-secondary"
                      onClick={() => handleAddTag(tag)}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 p-3 bg-[#e5ddd5] dark:bg-[#0b141a]">
        <div className="space-y-2">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex",
                msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  msg.direction === 'outgoing'
                    ? 'bg-[#dcf8c6] dark:bg-[#005c4b] text-foreground'
                    : 'bg-white dark:bg-[#202c33] text-foreground'
                )}
              >
                {msg.media_url && msg.media_type?.includes('image') && (
                  <img src={msg.media_url} alt="" className="max-w-full rounded mb-1" />
                )}
                <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                <p className="text-[10px] text-muted-foreground text-right mt-1">
                  {formatMessageTime(new Date(msg.created_at))}
                </p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-2 border-t bg-[#f0f0f0] dark:bg-[#202c33] flex items-center gap-2">
        <EmojiPickerButton 
          onEmojiSelect={(emoji) => onNewMessageChange(newMessage + emoji)} 
        />
        <Input
          placeholder="Digite uma mensagem..."
          value={newMessage}
          onChange={(e) => onNewMessageChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSendMessage()}
          className="flex-1 bg-white dark:bg-[#2a3942]"
        />
        <Button
          size="icon"
          onClick={onSendMessage}
          disabled={!newMessage.trim() || isSending}
          className="bg-stage-paid hover:bg-stage-paid/90"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
