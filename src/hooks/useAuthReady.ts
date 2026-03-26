import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuthReady() {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let initialResolved = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted || !initialResolved) return;
      setSession(nextSession);
    });

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return;
      initialResolved = true;
      setSession(initialSession);
      setIsReady(true);
    });

    const timeout = window.setTimeout(() => {
      if (!mounted || initialResolved) return;
      initialResolved = true;
      setSession(null);
      setIsReady(true);
    }, 10000);

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    isReady,
    user: session?.user ?? null,
  };
}
