import { describe, expect, it } from "vitest";
import { supportAiFailureAlert } from "@/lib/exchangeDesk/supportHealth";

describe("alerta de falhas da IA em uma hora", () => {
  it("não alerta sem chamadas", () => expect(supportAiFailureAlert(0, 0)).toBe(false));
  it("10% exato não passa do limite", () => expect(supportAiFailureAlert(10, 1)).toBe(false));
  it("acima de 10% alerta", () => expect(supportAiFailureAlert(100, 11)).toBe(true));
  it("uma falha em duas chamadas alerta", () => expect(supportAiFailureAlert(2, 1)).toBe(true));
});
