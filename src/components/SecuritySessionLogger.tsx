import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function SecuritySessionLogger() {
  useEffect(() => {
    let previousSession: string | null = null;
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((event,session) => {
      if (!session) { previousSession=null;return; }
      if (!['SIGNED_IN','INITIAL_SESSION'].includes(event)) return;
      if (previousSession===session.user.id) return;
      previousSession=session.user.id;
      // Defer outside the auth callback: invoking auth APIs inline can deadlock.
      const token=session.access_token;
      setTimeout(()=>{ void supabase.functions.invoke('security-auth-event',{ body:{ event:'login' },headers:{ Authorization:`Bearer ${token}` } }).catch(()=>{}); },0);
    });
    return ()=>subscription.unsubscribe();
  },[]);
  return null;
}