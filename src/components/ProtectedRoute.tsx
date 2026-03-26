import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

// Simple in-memory cache for module permissions per user
const permissionCache = new Map<string, { modules: string[]; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredModule?: string | string[];
}

export function ProtectedRoute({ children, requiredModule }: ProtectedRouteProps) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [hasAccess, setHasAccess] = useState<boolean | undefined>(undefined);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // IMPORTANT: Set up the listener FIRST, then call getSession.
    // The listener handles ongoing changes; getSession restores the initial session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      // Only update after initial session is resolved to avoid race conditions
      if (isReady) {
        setSession(sess);
      }
    });

    // getSession restores from storage — this is the source of truth for initial load
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setIsReady(true);
    });

    // Fallback timeout in case getSession hangs
    const timeout = setTimeout(() => {
      setIsReady((prev) => {
        if (!prev) {
          setSession(null);
          return true;
        }
        return prev;
      });
    }, 10000);

    return () => { clearTimeout(timeout); subscription.unsubscribe(); };
  }, []);

  // Once ready, listen to auth changes normally
  useEffect(() => {
    if (!isReady) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => subscription.unsubscribe();
  }, [isReady]);

  useEffect(() => {
    if (!session || !requiredModule) {
      if (session && !requiredModule) setHasAccess(true);
      return;
    }

    const userId = session.user.id;
    const modulesToCheck = Array.isArray(requiredModule) ? requiredModule : [requiredModule];

    // Check cache first
    const cached = permissionCache.get(userId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setHasAccess(modulesToCheck.some(m => cached.modules.includes(m)));
      return;
    }

    let cancelled = false;

    const checkAccess = async (attempt = 1) => {
      try {
        const result = await Promise.race([
          supabase.rpc("get_user_allowed_modules", { p_user_id: userId }),
          new Promise<{ data: null; error: Error }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: new Error('timeout') }), 8000)
          ),
        ]);

        if (cancelled) return;

        if (result.error || !result.data) {
          // Retry up to 2 times on failure
          if (attempt < 3) {
            setTimeout(() => { if (!cancelled) checkAccess(attempt + 1); }, 1500 * attempt);
            return;
          }
          setHasAccess(false);
          return;
        }

        const modules = result.data as string[];
        permissionCache.set(userId, { modules, ts: Date.now() });
        setHasAccess(modulesToCheck.some(m => modules.includes(m)));
      } catch {
        if (cancelled) return;
        if (attempt < 3) {
          setTimeout(() => { if (!cancelled) checkAccess(attempt + 1); }, 1500 * attempt);
          return;
        }
        setHasAccess(false);
      }
    };

    checkAccess();

    return () => { cancelled = true; };
  }, [session, requiredModule]);

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  if (requiredModule && hasAccess === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (requiredModule && hasAccess === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-foreground">Acesso Negado</h2>
          <p className="text-muted-foreground">Você não tem permissão para acessar este módulo.</p>
          <a href="/" className="text-primary underline">Voltar ao início</a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
