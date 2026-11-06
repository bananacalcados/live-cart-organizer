import { supabase } from "@/integrations/supabase/client";

/**
 * Garante que chamadas diretas (fetch) às funções do backend levem o token da
 * sessão logada. Várias telas antigas chamavam com só a chave pública, e as
 * funções travadas passaram a responder 401. Páginas públicas sem login
 * continuam iguais (sem sessão = nada muda).
 */
const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export function installEdgeAuthFetch() {
  if (typeof window === "undefined" || (window as any).__edgeAuthFetch) return;
  (window as any).__edgeAuthFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(BASE)) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const auth = headers.get("Authorization");
        if (!auth || auth === `Bearer ${ANON}`) {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (token) {
            headers.set("Authorization", `Bearer ${token}`);
            if (!headers.get("apikey")) headers.set("apikey", ANON);
            return orig(input, { ...(init ?? {}), headers });
          }
        }
      }
    } catch { /* segue a chamada original */ }
    return orig(input, init);
  };
}
