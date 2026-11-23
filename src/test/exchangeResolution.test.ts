import { describe, expect, it } from "vitest";
import { initialExchangeResolution } from "@/lib/pos/exchangeResolution";

describe("forma inicial de ressarcimento", () => {
  it("devolução sem escolha começa com estorno", () => {
    expect(initialExchangeResolution("devolucao")).toBe("estorno_financeiro");
    expect(initialExchangeResolution("devolucao", null)).toBe("estorno_financeiro");
  });

  it("troca sem escolha mantém o comportamento atual", () => {
    expect(initialExchangeResolution("troca")).toBe("estorno_financeiro");
  });

  it("voucher salvo é mantido, inclusive após converter troca em devolução", () => {
    expect(initialExchangeResolution("devolucao", "voucher")).toBe("voucher");
    expect(initialExchangeResolution("troca", "voucher")).toBe("voucher");
  });

  it("escolha salva de estorno é mantida", () => {
    expect(initialExchangeResolution("devolucao", "estorno_financeiro")).toBe("estorno_financeiro");
    expect(initialExchangeResolution("troca", "estorno_financeiro")).toBe("estorno_financeiro");
  });
});
