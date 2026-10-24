import { describe, expect, it } from "vitest";
import { selfserviceCashbackRate, selfserviceCashbackAmount } from "../../supabase/functions/_shared/selfservice-cashback-rule";

describe("cashback do autoatendimento", () => {
  const sent = "2026-10-24T01:00:00.000Z";
  it("concede 10% antes de 20 minutos", () => expect(selfserviceCashbackRate(sent, "2026-10-24T01:19:59.999Z")).toBe(10));
  it("inclui o limite exato de 20 minutos", () => expect(selfserviceCashbackRate(sent, "2026-10-24T01:20:00.000Z")).toBe(10));
  it("concede 5% após 20 minutos", () => expect(selfserviceCashbackRate(sent, "2026-10-24T01:20:00.001Z")).toBe(5));
  it("não inventa bônus sem envio comprovado", () => expect(selfserviceCashbackRate(null, sent)).toBe(5));
  it("não inventa bônus sem horário do pagamento", () => expect(selfserviceCashbackRate(sent, null)).toBe(5));
  it("calcula 10% sobre R$379,99 efetivamente pagos", () => expect(selfserviceCashbackAmount(379.99, 10)).toBe(38));
  it("calcula 5% sobre R$379,99 efetivamente pagos", () => expect(selfserviceCashbackAmount(379.99, 5)).toBe(19));
});