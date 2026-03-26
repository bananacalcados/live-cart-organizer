import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthReady } from "@/hooks/useAuthReady";

const permissionCache = new Map<string, { modules: string[]; ts: number }>();
const CACHE_TTL = 60_000;

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredModule?: string | string[];
}

export function ProtectedRoute({ children, requiredModule }: ProtectedRouteProps) {
  const { session, isReady } = useAuthReady();
  const [hasAccess, setHasAccess] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!isReady) return;

    if (!session || !requiredModule) {
      if (session && !requiredModule) setHasAccess(true);
      return;
    }

    const userId = session.user.id;
    const modulesToCheck = Array.isArray(requiredModule) ? requiredModule : [requiredModule];

    const cached = permissionCache.get(userId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setHasAccess(modulesToCheck.some((m) => cached.modules.includes(m)));
      return;
    }

    let cancelled = false;

    const checkAccess = async (attempt = 1) => {
      try {
        const result = await Promise.race([
          import("@/integrations/supabase/client").then(({ supabase }) =>
            supabase.rpc("get_user_allowed_modules", { p_user_id: userId })
          ),
          new Promise<{ data: null; error: Error }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: new Error("timeout") }), 8000)
          ),
        ]);

        if (cancelled) return;

        if (result.error || !result.data) {
          if (attempt < 3) {
            setTimeout(() => {
              if (!cancelled) checkAccess(attempt + 1);
            }, 1500 * attempt);
            return;
          }
          setHasAccess(false);
          return;
        }

        const modules = result.data as string[];
        permissionCache.set(userId, { modules, ts: Date.now() });
        setHasAccess(modulesToCheck.some((m) => modules.includes(m)));
      } catch {
        if (cancelled) return;
        if (attempt < 3) {
          setTimeout(() => {
            if (!cancelled) checkAccess(attempt + 1);
          }, 1500 * attempt);
          return;
        }
        setHasAccess(false);
      }
    };

    checkAccess();

    return () => {
      cancelled = true;
    };
  }, [isReady, session, requiredModule]);

  if (!isReady) {
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

