import { Users, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useTeamIdentity } from '@/hooks/chat/useTeamIdentity';
import { useTeamChatPresence } from '@/hooks/chat/useTeamChatPresence';
import { useTeamChatUnread } from '@/hooks/chat/useTeamChatUnread';

interface Props {
  isActive: boolean;
  onClick: () => void;
}

const fmtTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm', { locale: ptBR });
  if (isYesterday(d)) return 'Ontem';
  return format(d, 'dd/MM', { locale: ptBR });
};

const previewOf = (msg: { message: string; message_type: string } | null) => {
  if (!msg) return 'Nenhuma mensagem ainda';
  if (msg.message_type === 'image') return '📷 Foto';
  if (msg.message_type === 'audio') return '🎵 Áudio';
  if (msg.message_type === 'poll') return `📊 ${msg.message}`;
  return msg.message;
};

export function TeamChatPinnedItem({ isActive, onClick }: Props) {
  const { senderName, userId } = useTeamIdentity();
  const { count: onlineCount } = useTeamChatPresence(senderName, userId);
  const { lastMessage, unreadCount } = useTeamChatUnread(senderName, isActive);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full px-3 py-3 flex items-center gap-3 text-left transition-colors border-b-2',
        'bg-gradient-to-r from-primary/10 via-primary/5 to-transparent',
        'border-primary/40 hover:from-primary/20 hover:via-primary/10',
        isActive && 'from-primary/25 via-primary/15 ring-1 ring-primary/40',
      )}
    >
      <div className="relative h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 shadow-md">
        <Users className="h-6 w-6" />
        {onlineCount > 0 && (
          <span className="absolute -bottom-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white dark:border-[#111b21]">
            {onlineCount}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-extrabold text-[15px] tracking-wide text-primary uppercase truncate">
            Chat de Equipe
          </span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {fmtTime(lastMessage?.created_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground truncate flex-1">
            {lastMessage?.sender_name && (
              <span className="font-semibold text-foreground/80">{lastMessage.sender_name}: </span>
            )}
            {previewOf(lastMessage)}
          </p>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onlineCount > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">
                <Circle className="h-1.5 w-1.5 fill-current" />
                {onlineCount} online
              </span>
            )}
            {unreadCount > 0 && (
              <span className="h-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                {unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
