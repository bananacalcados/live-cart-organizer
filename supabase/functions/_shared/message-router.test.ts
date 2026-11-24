import { assertEquals } from "jsr:@std/assert@1";
import { routeMessage, type RouteResult } from "./message-router.ts";

const BEFORE_CONCIERGE_REMOVAL = "fe356350b9da81fa46bb3a6083600359173c2024";
const ROUTER_PATH = "supabase/functions/_shared/message-router.ts";

type MockOptions = { humanRecent?: boolean; aiPaused?: boolean };

function mockSupabase({ humanRecent = false, aiPaused = false }: MockOptions) {
  const now = new Date().toISOString();
  const client = {
    rpc(name: string) {
      if (name !== "check_order_ai_paused") throw new Error(`RPC inesperada: ${name}`);
      return Promise.resolve({ data: aiPaused ? [{ ai_paused: true }] : [], error: null });
    },
    from(table: string) {
      let selected = "";
      const query = {
        select(columns: string) { selected = columns; return query; },
        eq() { return query; }, neq() { return query; }, in() { return query; },
        gt() { return query; }, like() { return query; }, contains() { return query; },
        order() { return query; }, limit() { return query; },
        maybeSingle() { return Promise.resolve(query.result(true)); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(query.result(false)).then(resolve, reject);
        },
        result(single: boolean) {
          if (table === "whatsapp_messages" && humanRecent && selected.includes("message")) {
            if (selected === "id, created_at") return { data: [], error: null };
            return {
              data: [{ id: "human-1", message: "Vou verificar para você", created_at: now }],
              error: null,
            };
          }
          return { data: single ? null : [], error: null };
        },
      };
      return query;
    },
  };
  return client;
}

async function loadPreviousRouter() {
  const command = new Deno.Command("git", {
    args: ["show", `${BEFORE_CONCIERGE_REMOVAL}:${ROUTER_PATH}`],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
  const previousPath = await Deno.makeTempFile({
    dir: "supabase/functions/_shared",
    prefix: ".message-router-before-",
    suffix: ".ts",
  });
  await Deno.writeFile(previousPath, output.stdout);
  try {
    return (await import(`./${previousPath.split("/").pop()}?before`)).routeMessage as typeof routeMessage;
  } finally {
    await Deno.remove(previousPath);
  }
}

const scenarios: Array<{ name: string; text: string; options: MockOptions; expected: RouteResult }> = [];
for (const [label, text] of [["rastreio", "cadê meu pedido?"], ["troca", "quero fazer uma troca"], ["devolução", "quero devolução"]]) {
  scenarios.push(
    { name: `${label}, sem humano e sem pausa`, text, options: {}, expected: { agent: "legacy", reason: "concierge_not_available" } },
    { name: `${label}, com humano recente`, text, options: { humanRecent: true }, expected: { agent: "none", reason: "operator_cooldown" } },
    { name: `${label}, com IA pausada`, text, options: { aiPaused: true }, expected: { agent: "none", reason: "ai_paused" } },
  );
}

Deno.test("roteador sem concierge mantém exatamente as decisões do modo desligado", async () => {
  const previousRouteMessage = await loadPreviousRouter();
  for (const scenario of scenarios) {
    const input = { phone: "5533999990000", messageText: scenario.text, isGroup: false };
    const before = await previousRouteMessage(mockSupabase(scenario.options) as never, input);
    const after = await routeMessage(mockSupabase(scenario.options) as never, input);
    assertEquals(after, before, scenario.name);
    assertEquals(after, scenario.expected, scenario.name);
  }
});
