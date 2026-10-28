import { describe, it, expect, afterEach, vi } from "vitest";
import { inspectAustpayTransaction, matchAustpayRefund, submitAustpayRefund } from "./austpay";

const src = { id: "sale", austpayTransactionId: "transaction", austpayReferenceIds: ["order"], total: 359.99 };
const tx = { id: "transaction", currency: "BRL", payment_method: "CREDIT_CARD", status: "APPROVED", approved_amount: 35999, refunded_amount: 0, approved_at: "2026-10-27T20:04:47Z", refunds: [] };
afterEach(() => vi.unstubAllGlobals());
describe("AustPay integral seguro", () => {
  it("Adriana: integral é exatamente 35999 centavos", () => {
    expect(inspectAustpayTransaction(tx, src, 359.99)).toMatchObject({ ok: true, remaining: 359.99 });
  });
  it("parcial não é liberado nesta fase", () => {
    expect(inspectAustpayTransaction(tx, src, 100).ok).toBe(false);
  });
  it("autorizado não é captura", () => {
    expect(inspectAustpayTransaction({ ...tx, status: "AUTHORIZED" }, src, null).ok).toBe(false);
  });
  it("histórico ausente bloqueia", () => {
    expect(inspectAustpayTransaction({ ...tx, refunds: undefined }, src, null).ok).toBe(false);
  });
  it.each(["PENDING", "PROCESSING", "TIMEOUT", "COMPLETED", "UNKNOWN"])("estorno anterior %s bloqueia", status => {
    expect(inspectAustpayTransaction({ ...tx, refunds: [{ status }] }, src, null).ok).toBe(false);
  });
  it("identidade de outra compra bloqueia", () => {
    expect(inspectAustpayTransaction({ ...tx, external_reference: "other" }, src, null).ok).toBe(false);
  });
  it("Cappta liquidada bloqueia integral", () => {
    expect(inspectAustpayTransaction({ ...tx, provider: "CAPPTA", ledger_entries: [{ type: "TRANSACTION", settled: true }] }, src, null).ok).toBe(false);
  });
  it("valor de outra compra não é aceito", () => {
    expect(inspectAustpayTransaction({ ...tx, approved_amount: 45999 }, src, null).ok).toBe(false);
  });
  it("conclusão exige registro exato e valor devolvido", async () => {
    const row = { id: "local", payment_id: tx.id, amount: 359.99, reason: "cancelamento_antes_envio" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...tx, status: "REFUNDED", refunded_amount: 35999, refunds: [{ id: "refund", transaction_id: tx.id, status: "COMPLETED", amount: 35999, description: "BCREF:local" }] }))));
    const result = await submitAustpayRefund({ apiKey: "test", merchantId: "m1", provider: null, env: "production", baseUrl: "https://example.test" }, row);
    expect(result.kind).toBe("done");
  });
  it("mesmo valor sem código exato não comprova estorno", () => {
    expect(matchAustpayRefund({ ...tx, refunds: [{ id: "r", transaction_id: tx.id, amount: 35999, description: "other" }] }, { id: "local", payment_id: tx.id, amount: 359.99 })).toBeNull();
  });
  it("timeout envia uma única solicitação e mantém verificar", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("timeout")); vi.stubGlobal("fetch", fetch);
    const result = await submitAustpayRefund({ apiKey: "test", merchantId: "m1", provider: null, env: "production", baseUrl: "https://example.test" }, { id: "local", payment_id: tx.id, amount: 359.99, reason: "cancelamento_antes_envio" });
    expect(result.kind).toBe("verificar"); expect(fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.refund_amount).toBe(35999); expect(payload.refund_reason).toBe("CUSTOMER_REQUEST");
  });
  it("sucesso HTTP pendente não vira comprovante", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...tx, status: "PENDING_REFUND" })));
    vi.stubGlobal("fetch", fetch);
    const result = await submitAustpayRefund({ apiKey: "test", merchantId: "m1", provider: null, env: "production", baseUrl: "https://example.test" }, { id: "local", payment_id: tx.id, amount: 359.99, reason: "cancelamento_antes_envio" });
    expect(result.kind).toBe("verificar"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("resposta 409 mantém trava sem repetir", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "conflict" }), { status: 409 })); vi.stubGlobal("fetch", fetch);
    const result = await submitAustpayRefund({ apiKey: "test", merchantId: "m1", provider: null, env: "production", baseUrl: "https://example.test" }, { id: "local", payment_id: tx.id, amount: 359.99, reason: "cancelamento_antes_envio" });
    expect(result.kind).toBe("verificar"); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
import { describe as d2, it as i2, expect as e2, vi as v2 } from "vitest";
d2("AustPay rota do estabelecimento", () => {
  i2("descobre o merchant da transação e estorna pela rota dele", async () => {
    const calls: string[] = [];
    v2.stubGlobal("fetch", v2.fn(async (url: string) => {
      calls.push(url);
      if (calls.length === 1) return new Response(JSON.stringify({ id: "tx", company_id: "6b56" }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "x" } }), { status: 400 });
    }));
    await submitAustpayRefund({ apiKey: "t", merchantId: null, provider: null, env: "production", baseUrl: "https://e.t" } as any, { id: "l", payment_id: "tx", amount: 1, reason: "r" });
    e2(calls[1]).toBe("https://e.t/v1/merchants/6b56/transactions/tx/refunds");
    v2.unstubAllGlobals();
  });
});
