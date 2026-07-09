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

/**
 * Extrai o MOTIVO REAL de uma falha ao apagar/editar mensagem no provedor
 * (uazapi / z-api / wasender). O supabase-js coloca o corpo real dentro de
 * `error.context` (Response) quando o status é 4xx/5xx, e a nossa edge function
 * embrulha a resposta crua do provedor em `details`. Este helper "desembrulha"
 * tudo isso para uma frase legível para o lojista.
 */
export async function extractDeleteFailureReason(
  res: { error?: any; data?: any },
): Promise<string> {
  const pickFromDetails = (details: any): string | null => {
    if (!details) return null;
    if (typeof details === "string") return details;
    if (typeof details === "object") {
      // Provedores retornam a razão em campos variados.
      return (
        details.message ||
        details.error ||
        details.response ||
        details.reason ||
        details.status ||
        (() => {
          try {
            return JSON.stringify(details);
          } catch {
            return null;
          }
        })()
      );
    }
    return null;
  };

  // 1) Corpo já disponível em res.data (status 200 com { error, details }).
  if (res?.data && (res.data.error || res.data.details)) {
    const detail = pickFromDetails(res.data.details);
    return (detail || res.data.error || "Motivo não informado pelo WhatsApp").toString().slice(0, 300);
  }

  // 2) Erro HTTP 4xx/5xx — o corpo real está em error.context (Response).
  const ctx = res?.error?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const txt = await ctx.text();
      try {
        const j = JSON.parse(txt);
        const detail = pickFromDetails(j?.details);
        return (detail || j?.error || j?.message || txt || "Motivo não informado pelo WhatsApp")
          .toString()
          .slice(0, 300);
      } catch {
        return (txt || "Motivo não informado pelo WhatsApp").slice(0, 300);
      }
    } catch { /* ignore */ }
  }

  return (res?.error?.message || "Motivo não informado pelo WhatsApp").toString().slice(0, 300);
}
