import { describe, it, expect } from "vitest";
import { firstReverseDeadline, reverseWhatsAppText } from "@/components/pos/POSWhatsAppReverseDialog";
describe("prazo da reversa reemitida", () => {
  const all = [
    { codigo_objeto: "AP1", valid_until: "2026-11-11", created_at: "2026-11-04T18:00:00Z" },
    { codigo_objeto: "AP2", valid_until: "2026-11-13", created_at: "2026-11-06T15:28:00Z" },
  ];
  it("usa o prazo do primeiro código", () => expect(firstReverseDeadline(all, all[1])).toBe("2026-11-11"));
  it("primeiro código mantém o próprio prazo", () => expect(firstReverseDeadline([all[1]], all[1])).toBe("2026-11-13"));
  it("mensagem reemitida não promete 7 dias a partir de hoje", () => {
    const t = reverseWhatsAppText("AP2", "troca", "11/11/2026", true);
    expect(t).toContain("até 11/11/2026"); expect(t).not.toContain("a partir de hoje");
  });
});
