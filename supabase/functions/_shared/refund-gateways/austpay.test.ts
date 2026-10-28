import { describe, it, expect, afterEach, vi } from "vitest";
import { inspectAustpayTransaction, matchAustpayRefund, submitAustpayRefund } from "./austpay";

const src = { id: "sale", austpayTransactionId: "transaction", austpayReferenceIds: ["order"], total: 359.99 };
const tx = { id: "transaction", currency: "BRL", payment_method: "CREDIT_CARD", status: "APPROVED", approved_amount: 35999, refunded_amount: 0, approved_at: "2026-10-27T20:04:47Z", refunds: [], ledger_entries: [{type:"TRANSACTION",payment_date:"2099-01-01"}] };
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
    expect(payload).not.toHaveProperty("refund_amount"); expect(payload.refund_reason).toBe("CUSTOMER_REQUEST");
  });
  it("sucesso HTTP pendente não vira comprovante", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...tx, status: "PENDING_REFUND" })));
    vi.stubGlobal("fetch", fetch);
    const result = await submitAustpayRefund({ apiKey: "test", merchantId: "m1", provider: null, env: "production", baseUrl: "https://example.test" }, { id: "local", payment_id: tx.id, amount: 359.99, reason: "cancelamento_antes_envio" });
    expect(result.kind).toBe("verificar"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("resposta 409 falha sem repetir", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "conflict" }), { status: 409 })); vi.stubGlobal("fetch", fetch);
    const result = await submitAustpayRefund({ apiKey: "test", merchantId: "m1", provider: null, env: "production", baseUrl: "https://example.test" }, { id: "local", payment_id: tx.id, amount: 359.99, reason: "cancelamento_antes_envio" });
    expect(result.kind).toBe("failed"); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe("rota direta e mensagens",()=>{
 it("usa somente rota direta mesmo com merchant configurado",async()=>{
  const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:"PENDING_REFUND"})));vi.stubGlobal("fetch",f);
  await submitAustpayRefund({apiKey:"test",merchantId:"merchant",provider:null,env:"production",baseUrl:"https://example.test"},{id:"local",payment_id:"transaction",reason:"outro"});
  expect(f.mock.calls[0][0]).toBe("https://example.test/v1/transactions/transaction/refunds");
  expect(JSON.parse(f.mock.calls[0][1].body).metadata).toEqual({refund_source:"erp",refund_row_id:"local"});expect(f).toHaveBeenCalledTimes(1);
 });
 it.each([[400,"This transaction can no longer be refunded because settlement is already in progress.","liquidação"],[403,"forbidden","transaction.refund"],[409,"conflict","status/limite"]])("HTTP %s claro",async(status,issue,message)=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({details:{issues:[{value:issue}]}}),{status:Number(status)})));
  const r=await submitAustpayRefund({apiKey:"test",merchantId:null,provider:null,env:"production",baseUrl:"https://example.test"},{id:"local",payment_id:"transaction",reason:"outro"});
  expect(r.kind).toBe("failed");expect(r.error).toContain(message);
 });
});
