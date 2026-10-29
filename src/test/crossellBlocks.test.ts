import { describe, it, expect, vi } from "vitest";
import { sampleCrossellDelay, crossellNextAt, metaCrossellWindow, validateCrossellBlocks, type CrossellBlock } from "../../supabase/functions/_shared/crossell-blocks";
const text: CrossellBlock = { id: "1", kind: "text", text: "Oferta", media: [], buttons: [] };
describe("envio manual de Crossell", () => {
  it("intervalo mínimo é 4.000 ms", () => expect(sampleCrossellDelay(() => 0)).toBe(4000));
  it("intervalo máximo é 15.000 ms", () => expect(sampleCrossellDelay(() => 0.999999)).toBe(15000));
  it("sorteia independentemente a cada transição", () => {
    const random = vi.fn().mockReturnValueOnce(0.7).mockReturnValueOnce(0.1);
    expect(sampleCrossellDelay(random)).toBe(11700);
    expect(sampleCrossellDelay(random)).toBe(5100);
    expect(random).toHaveBeenCalledTimes(2);
  });
  it("retomar preserva o horário sorteado sem novo sorteio", () => {
    const random = vi.fn();
    expect(crossellNextAt(1000, "2026-10-29T17:00:00Z", random)).toBe("2026-10-29T17:00:00Z");
    expect(random).not.toHaveBeenCalled();
  });
  it("Meta exige mensagem recebida há menos de 24h, não compra recente", () => {
    const now = Date.parse("2026-10-29T17:00:00Z");
    expect(metaCrossellWindow(null, now)).toBe(false);
    expect(metaCrossellWindow("2026-10-28T17:00:00Z", now)).toBe(false);
    expect(metaCrossellWindow("2026-10-28T17:00:01Z", now)).toBe(true);
  });
  it("aceita texto em ambas instâncias e recusa troca para outro provider", () => {
    expect(validateCrossellBlocks([text], "uazapi")).toBeNull();
    expect(validateCrossellBlocks([text], "meta")).toBeNull();
    expect(validateCrossellBlocks([text], "instagram")).not.toBeNull();
  });
  it("recusa botões excedentes sem cortar silenciosamente", () => {
    expect(validateCrossellBlocks([{ ...text, kind: "buttons", buttons: Array.from({ length: 4 }, (_, i) => ({ title: `${i}`, interest: true })) }], "meta")).not.toBeNull();
  });
});