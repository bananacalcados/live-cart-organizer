// Extrai a mensagem real do corpo quando uma Edge Function responde com 4xx/5xx.
// O supabase-js lança FunctionsHttpError com `context` (Response) — precisamos lê-lo.
export async function extractEdgeError(err: any, fallback = "Erro desconhecido"): Promise<string> {
  try {
    const ctx = err?.context;
    if (ctx && typeof ctx.text === "function") {
      const txt = await ctx.text();
      try {
        const j = JSON.parse(txt);
        return j?.error || j?.message || j?.rejection_message || txt || fallback;
      } catch {
        return txt || fallback;
      }
    }
  } catch { /* ignore */ }
  return err?.message || fallback;
}
