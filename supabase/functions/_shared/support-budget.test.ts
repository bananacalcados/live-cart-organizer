import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { budgetGateway } from "./support-budget-gateway.ts";
import { budgetAllows, requestTokenReservation } from "./support-cost.ts";
import { realError, withRealError } from "./support-ai.ts";
import { runSupportAiWithRetry, type SupportAiAttempt } from "./support-ai-retry.ts";
Deno.env.set("INTERNAL_FN_SECRET", "teste-falso"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "teste-falso");
const { notifyBudget } = await import("./support-guard.ts");

Deno.test("reserva recusada por teto grava o motivo real na tentativa", async () => {
  const sb = { rpc: async () => ({ data: { allowed: false, reason: "teto_diario", used: 1860000, reserved: 0, budget: 2000000 }, error: null }) };
  const guarded = budgetGateway(sb, { id: "x", phone: "1", number: null }, "triagem");
  const cfg = { apiKey: "k", baseURL: "u", timeoutMs: 1, guardedFetch: guarded };
  const attempts: SupportAiAttempt[] = [];
  await runSupportAiWithRetry({
    primaryModel: "a", alternateModel: "b", onAttempt: (a) => { attempts.push(a); },
    run: async () => {
      try { await guarded("https://x", { body: JSON.stringify({ model: "a" }) }); } catch { /* SDK engole */ }
      throw withRealError(cfg, new Error("No output generated. Check the stream for errors."));
    },
  }).catch(() => {});
  assertEquals(attempts.length, 1); // recusa de teto não repete
  assert(attempts[0].error!.startsWith("reserva_recusada: teto_diario: usado 1860000 (+0 reservado) de 2000000"), attempts[0].error);
  assert(realError(cfg, new Error("x")).includes("teto_diario"));
});

Deno.test("reserva proporcional não barra chamada pequena com saldo suficiente", () => {
  const body = JSON.stringify({ model: "m", input: "a".repeat(9000) });
  const r = requestTokenReservation(body);
  assert(r < 25000, `reserva ${r}`);
  assertEquals(budgetAllows(1_960_000, 0, r), true); // sobra 40 mil: antes reservava ~140 mil e barrava
});

Deno.test("alerta de 80% dispara uma vez por dia", async () => {
  let claimed = false; const sent: string[] = [];
  const sb = {
    rpc: async (name: string) => {
      if (name === "support_budget_alert_claim") { const ok = !claimed; claimed = true; return { data: ok }; }
      return { data: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { provider: "uazapi", is_active: true } }) }) }) }),
    functions: { invoke: async (_f: string, o: any) => { sent.push(o.body.message); return { data: { success: true } }; } },
  };
  const s = { budget_used: 1_650_000, budget_limit: 2_000_000, alert_phone: "5533", alert_whatsapp_number_id: "n" };
  const a = await notifyBudget(sb, s); const b = await notifyBudget(sb, s);
  assertEquals(a, { level: 80, sent: true }); assertEquals(b, { level: 80, sent: false });
  assertEquals(sent.length, 1); assert(sent[0].includes("83%"));
});
