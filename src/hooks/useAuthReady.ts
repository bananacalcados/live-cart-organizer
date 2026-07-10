import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuthReady() {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    // onAuthStateChange fires INITIAL_SESSION with the persisted session
    // almost immediately (no network wait), plus SIGNED_IN / TOKEN_REFRESHED /
    // SIGNED_OUT afterwards. Driving readiness from here avoids depending on a
    // potentially slow getSession() (which may do a network token refresh) and
    // is self-correcting: state always reflects the latest known session.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setIsReady(true);
    });

    // Fallback in case the initial event is missed for any reason.
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return;
      setSession(initialSession);
      setIsReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);


  return {
    session,
    isReady,
    user: session?.user ?? null,
  };
}
