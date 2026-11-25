import { requestTokenReservation, reserveRefusalReason } from "./support-cost.ts";

// Each actual HTTP request, including SDK retries/tool continuations, needs an atomic reservation.
// NUNCA pausa a IA: erro de provedor é por chamada; a pausa geral (10 min) só vem de support_ai_outage_record.
export type BudgetFetch = typeof fetch & { lastError: () => string | null };

/** Lê um evento SSE (OpenAI Responses ou Anthropic Messages): uso de tokens, recusa de conteúdo e falha transitória. */
export function inspectSseEvent(e: any, acc: { input: number | null; output: number | null; refused: boolean; failed: string | null }) {
  const type = String(e?.type ?? "");
  if (e?.response?.usage) { acc.input = e.response.usage.input_tokens ?? acc.input; acc.output = e.response.usage.output_tokens ?? acc.output; }
  if (type === "message_start" && e.message?.usage) {
    const u = e.message.usage; acc.input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    acc.output = u.output_tokens ?? acc.output;
  }
  if (type === "message_delta" && e.usage?.output_tokens != null) acc.output = e.usage.output_tokens;
  if (/refusal/.test(type) || e?.delta?.stop_reason === "refusal") acc.refused = true;
  if (type === "response.failed" || type === "error" || type === "response.incomplete") {
    acc.failed = String(e?.response?.error?.message ?? e?.error?.message ?? e?.response?.incomplete_details?.reason ?? type).slice(0, 200);
  }
}

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
        return response;
      }
      if (!response.body) { lastError = "ia_sem_stream"; await settle(null, null, false, "ia_sem_stream", run); throw new Error("ia_sem_stream"); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      const acc = { input: null as number | null, output: null as number | null, refused: false, failed: null as string | null };
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              const err = acc.refused ? "recusa_de_conteudo" : acc.failed ? `stream_falhou: ${acc.failed}` : null;
              if (err) lastError = err;
              await settle(acc.input, acc.output, !err, err, run);
              controller.close(); return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
            for (const line of lines) if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try { inspectSseEvent(JSON.parse(line.slice(6)), acc); } catch { /* incomplete SSE is retained */ }
            }
            controller.enqueue(chunk.value);
          } catch (e) { lastError = "stream_interrompido"; await settle(null, null, false, "stream_interrompido", run); controller.error(e); }
        },
        async cancel(reason) { await reader.cancel(reason); await settle(null, null, false, "stream_cancelado", run); },
      });
      return new Response(stream, { status: response.status, headers: response.headers });
    } catch (e) { lastError ??= `rede: ${String((e as Error).message)}`.slice(0, 400); await settle(null, null, false, String((e as Error).message).slice(0, 400), null); throw e; }
  };
  return Object.assign(fn, { lastError: () => lastError }) as BudgetFetch;
}
