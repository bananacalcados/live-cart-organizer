import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface PresenceMember {
  name: string;
  userId?: string;
  online_at: string;
}

/** Tracks real-time presence on the team chat. */
export function useTeamChatPresence(senderName: string, userId?: string | null) {
  const [members, setMembers] = useState<PresenceMember[]>([]);

  useEffect(() => {
    if (!senderName) return;
    const channel = supabase.channel('team-chat-presence', {
      config: { presence: { key: userId || senderName } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceMember>();
        const flat: PresenceMember[] = [];
        const seen = new Set<string>();
        for (const key of Object.keys(state)) {
          for (const m of state[key]) {
            const id = m.userId || m.name;
            if (seen.has(id)) continue;
            seen.add(id);
            flat.push(m);
          }
        }
        setMembers(flat);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ name: senderName, userId: userId || null, online_at: new Date().toISOString() });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [senderName, userId]);

  return { members, count: members.length };
}
