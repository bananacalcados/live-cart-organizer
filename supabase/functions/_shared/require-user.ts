// Guarda de autenticação para funções internas que rodam com service role.
// Aceita: (a) JWT de um usuário logado do app, ou (b) a própria service role key
// (chamadas servidor→servidor). Rejeita a anon key pública.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function requireUser(req: Request): Promise<{ ok: true; userId: string | null } | { ok: false; response: Response }> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  const deny = () => ({
    ok: false as const,
    response: new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  });

  const raw = req.headers.get("Authorization") || "";
  const token = raw.replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny();

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (serviceKey && token === serviceKey) return { ok: true, userId: null };

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (anonKey && token === anonKey) return deny();

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, anonKey || serviceKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return deny();
    return { ok: true, userId: data.user.id };
  } catch {
    return deny();
  }
}
