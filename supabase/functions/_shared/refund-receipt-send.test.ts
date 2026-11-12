import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { executeReceiptSend, type ReceiptSendPlan } from "./refund-receipt-send.ts";

const plan: ReceiptSendPlan = {
  ok: true, refund: { id: "refund-1", receipt_path: "doc.pdf" }, phone: "5551999998888", phoneMasked: "5551*****8888",
  instance: { id: "instance-1", provider: "uazapi", label: "Whats Pérola" }, fileName: "comprovante.pdf", message: "mensagem",
};

Deno.test("claim recusado não chama o WhatsApp nem gera link: impede duplicidade", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls++; return new Response("{}"); };
  const calls: string[] = [];
  const sb = { rpc: async (name: string) => { calls.push(name); return { data: false, error: null }; } };
  try {
    const result = await executeReceiptSend(sb, plan, "mensagem", null, "Sistema", { automatic: true });
    assertFalse(result.ok);
    assertEquals(fetchCalls, 0);
    assertEquals(calls, ["refund_receipt_claim"]);
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test("falha do WhatsApp fica registrada e não marca comprovante como enviado", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "recusado" }), { status: 500 });
  const failures: any[] = [];
  let history = 0;
  const sb = {
    rpc: async (name: string, args: any) => {
      if (name === "refund_receipt_claim") return { data: true, error: null };
      if (name === "refund_receipt_send_failed") failures.push(args);
      return { data: null, error: null };
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://example.invalid/doc.pdf" } }) }) },
    from: () => ({ insert: async () => { history++; return { error: null }; } }),
  };
  try {
    const result = await executeReceiptSend(sb, plan, "mensagem", null, "Sistema", { automatic: true });
    assertFalse(result.ok);
    assert(result.error?.includes("recusado"));
    assertEquals(failures.length, 1);
    assertEquals(failures[0].p_automatic, true);
    assertEquals(history, 0);
  } finally { globalThis.fetch = originalFetch; }
});
