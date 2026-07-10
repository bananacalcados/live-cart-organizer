import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuthReady() {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let readyFallback: number | undefined;

    // onAuthStateChange fires INITIAL_SESSION with the persisted session
    // almost immediately (no network wait), plus SIGNED_IN / TOKEN_REFRESHED /
    // SIGNED_OUT afterwards. Do not call getSession() here: auth methods share
    // the same browser lock, and a slow/stale getSession can block password
    // login from resolving on production.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      if (readyFallback) window.clearTimeout(readyFallback);
      setSession(nextSession);
      setIsReady(true);
    });

    // Safety fallback only marks the hook as ready; it intentionally avoids any
    // Supabase auth call so login cannot be held behind a pending session read.
    readyFallback = window.setTimeout(() => {
      if (!mounted) return;
      setIsReady(true);
    }, 4000);

    return () => {
      mounted = false;
      if (readyFallback) window.clearTimeout(readyFallback);
      subscription.unsubscribe();
    };
  }, []);


  return {
    session,
    isReady,
    user: session?.user ?? null,
  };
}
