import { supabase } from "@/integrations/supabase/client";

/**
 * Cabeçalhos para chamadas diretas (fetch) a edge functions internas.
 * Envia o token do usuário logado — funções internas exigem sessão válida.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
