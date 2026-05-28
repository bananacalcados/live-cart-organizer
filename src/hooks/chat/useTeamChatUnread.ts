import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'team_chat_last_read_at';

interface LastMessageSnapshot {
  id: string;
  sender_name: string;
  message: string;
  message_type: string;
  created_at: string;
}

/**
 * Tracks the latest team-chat message + unread count vs localStorage read marker.
 * `senderName` is used so messages from the current user don't count as unread.
 */
export function useTeamChatUnread(senderName: string, isActive: boolean) {
  const [lastMessage, setLastMessage] = useState<LastMessageSnapshot | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasNewIncoming, setHasNewIncoming] = useState(false);

  const recompute = useCallback(async () => {
    const { data: latest } = await supabase
      .from('team_chat_messages')
      .select('id, sender_name, message, message_type, created_at')
      .eq('channel', 'general')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastMessage((latest as LastMessageSnapshot) || null);

    const lastRead = localStorage.getItem(STORAGE_KEY);
    let q = supabase
      .from('team_chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'general')
      .neq('sender_name', senderName || '__none__');
    if (lastRead) q = q.gt('created_at', lastRead);
    const { count } = await q;
    setUnreadCount(count || 0);
  }, [senderName]);

  useEffect(() => { recompute(); }, [recompute]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('team-chat-unread-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' }, (payload) => {
        const msg = payload.new as LastMessageSnapshot;
        if (msg.channel !== undefined && (payload.new as any).channel !== 'general') return;
        setLastMessage(msg);
        const isFromMe = msg.sender_name === senderName;
        if (!isFromMe) {
          if (isActive) {
            // Auto-mark as read
            localStorage.setItem(STORAGE_KEY, msg.created_at);
          } else {
            setUnreadCount(c => c + 1);
            setHasNewIncoming(true);
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [senderName, isActive]);

  const markAsRead = useCallback(() => {
    const stamp = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, stamp);
    setUnreadCount(0);
    setHasNewIncoming(false);
  }, []);

  return { lastMessage, unreadCount, hasNewIncoming, markAsRead, refresh: recompute };
}
