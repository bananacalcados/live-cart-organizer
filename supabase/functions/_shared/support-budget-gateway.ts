import { requestTokenReservation, reserveRefusalReason } from "./support-cost.ts";

// Each actual HTTP request, including SDK retries/tool continuations, needs an atomic reservation.
export type BudgetFetch = typeof fetch & { lastError: () => string | null };
// The SDK hides the real cause behind "No output generated"; keep the last refusal/HTTP error to log it.
export function budgetGateway(sb: any, meta: { id: string; phone: string; number: string | null }, kind: string): BudgetFetch {
  let lastError: string | null = null;
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = String(init?.body ?? "{}");
    const parsed = JSON.parse(body);
    const { data: reserve, error } = await sb.rpc("support_cost_reserve", { p_suggestion: meta.id, p_phone: meta.phone, p_number: meta.number, p_kind: kind, p_model: parsed.model, p_tokens: requestTokenReservation(body) });
    if (error || !reserve?.allowed) { lastError = `reserva_recusada: ${reserveRefusalReason(reserve, error?.message)}`.slice(0, 400); throw new Error(lastError); }
    const settle = (i: number | null, o: number | null, ok: boolean, message: string | null, run: string | null) => sb.rpc("support_cost_settle", { p_id: reserve.id, p_input: i, p_output: o, p_ok: ok, p_error: message, p_run: run });
    try {
      const response = await fetch(input, init);
      const run = response.headers.get("X-Lovable-AIG-Run-ID");
      if (!response.ok) {
        const payload = await response.clone().json().catch(() => ({}));
        const message = String(payload.message ?? payload.error?.message ?? `IA: ${response.status}`).slice(0, 400);
        lastError = `HTTP ${response.status}: ${message}`.slice(0, 400);
        await settle(0, 0, false, message, run);
        if ([402, 403, 404, 429].includes(response.status) || response.status >= 500) {
          // 429/5xx are transient: pause with an expiry so the agent resumes by itself; 402/403/404 stay until fixed.
          const until = response.status === 429 ? new Date(Date.now() + Math.max(300000, Number(response.headers.get("Retry-After") ?? 0) * 1000)).toISOString()
            : response.status >= 500 ? new Date(Date.now() + 900000).toISOString() : null;
          await sb.rpc("support_cost_pause", { p_reason: message, p_until: until });
        }
        return response;
      }
      if (!response.body) { await settle(null, null, false, "ia_sem_stream", run); throw new Error("ia_sem_stream"); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let usage: any = null; let refused = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              await settle(usage?.input_tokens ?? null, usage?.output_tokens ?? null, !refused, refused ? "recusa_do_provedor" : null, run);
              if (refused) await sb.rpc("support_cost_pause", { p_reason: "recusa_do_provedor", p_until: null });
              controller.close(); return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
            for (const line of lines) if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try { const e = JSON.parse(line.slice(6)); if (e.response?.usage) usage = e.response.usage; if (/refusal|denied|response.failed/.test(e.type ?? "")) refused = true; } catch { /* incomplete SSE is retained */ }
            }
            controller.enqueue(chunk.value);
          } catch (e) { await settle(null, null, false, "stream_interrompido", run); controller.error(e); }
        },
        async cancel(reason) { await reader.cancel(reason); await settle(null, null, false, "stream_cancelado", run); },
      });
      return new Response(stream, { status: response.status, headers: response.headers });
    } catch (e) { lastError ??= `rede: ${String((e as Error).message)}`.slice(0, 400); await settle(null, null, false, String((e as Error).message).slice(0, 400), null); throw e; }
  };
  return Object.assign(fn, { lastError: () => lastError }) as BudgetFetch;
}