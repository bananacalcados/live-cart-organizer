import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuthReady() {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let initialSessionReceived = false;

    // INITIAL_SESSION is the source of truth for the persisted browser session.
    // Never mark auth as ready on a timer with a null session: on slower devices
    // that race redirected valid users back to /login before hydration finished.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      initialSessionReceived = true;
      setSession(nextSession);
      setIsReady(true);
    });

    // Some browser/privacy combinations do not emit INITIAL_SESSION reliably.
    // Read local auth state only as a delayed fallback, without declaring the
    // user signed out until that read has actually completed.
    const fallback = window.setTimeout(async () => {
      if (!mounted || initialSessionReceived) return;
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted || initialSessionReceived) return;
        setSession(data.session);
      } finally {
        if (mounted && !initialSessionReceived) setIsReady(true);
      }
    }, 2500);

    return () => {
      mounted = false;
      window.clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, []);


  return {
    session,
    isReady,
    user: session?.user ?? null,
  };
}
