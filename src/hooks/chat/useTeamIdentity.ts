import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Resolves the current user's display name for the team chat. */
export function useTeamIdentity() {
  const [senderName, setSenderName] = useState<string>('');
  const [userId, setUserId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          if (cancelled) return;
          setUserId(user.id);
          try {
            const { data: profileById } = await supabase
              .from('user_profiles')
              .select('display_name')
              .eq('user_id', user.id)
              .maybeSingle();
            if (profileById?.display_name) {
              if (!cancelled) {
                setSenderName(profileById.display_name);
                localStorage.setItem('team_chat_name', profileById.display_name);
                setIsReady(true);
              }
              return;
            }
          } catch { /* ignore */ }
          const emailName = (user.email || '').split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const name = user.user_metadata?.full_name || user.user_metadata?.name || emailName;
          if (!cancelled) {
            setSenderName(name);
            localStorage.setItem('team_chat_name', name);
            setIsReady(true);
          }
        } else {
          const stored = localStorage.getItem('team_chat_name');
          if (!cancelled) {
            if (stored) setSenderName(stored);
            setIsReady(true);
          }
        }
      } catch {
        if (!cancelled) setIsReady(true);
      }
    };
    detect();
    return () => { cancelled = true; };
  }, []);

  return { senderName, userId, isReady };
}
