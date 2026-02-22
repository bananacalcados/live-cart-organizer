import { useEffect, useState, useRef } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

// Simple in-memory cache for module permissions per user
const permissionCache = new Map<string, { modules: string[]; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredModule?: string;
}

export function ProtectedRoute({ children, requiredModule }: ProtectedRouteProps) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [hasAccess, setHasAccess] = useState<boolean | undefined>(undefined);
  const checkedRef = useRef(false);

  useEffect(() => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; setSession(null); }
    }, 10000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!settled || session) {
        settled = true;
        clearTimeout(timeout);
        setSession(session);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!settled || session) {
        settled = true;
        clearTimeout(timeout);
        setSession(session);
      }
    });

    return () => { clearTimeout(timeout); subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session || !requiredModule) {
      if (session && !requiredModule) setHasAccess(true);
      return;
    }

    const userId = session.user.id;

    // Check cache first
    const cached = permissionCache.get(userId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setHasAccess(cached.modules.includes(requiredModule));
      return;
    }

    if (checkedRef.current) return;
    checkedRef.current = true;

    const checkAccess = async () => {
      try {
        const result = await Promise.race([
          supabase.rpc("get_user_allowed_modules", { p_user_id: userId }),
          new Promise<{ data: null; error: Error }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: new Error('timeout') }), 8000)
          ),
        ]);

        if (result.error || !result.data) {
          setHasAccess(false);
          return;
        }

        const modules = result.data as string[];
        permissionCache.set(userId, { modules, ts: Date.now() });
        setHasAccess(modules.includes(requiredModule));
      } catch {
        setHasAccess(false);
      }
    };

    checkAccess();
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
