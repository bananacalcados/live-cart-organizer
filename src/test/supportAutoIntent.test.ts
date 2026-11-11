import { describe, it, expect } from "vitest";
import { classifyIntent, decide, shouldAutoSend } from "@/lib/supportAuto/intent";

describe("classificação de intenção", () => {
  it.each([
    ["Oi, quero trocar meu tênis", "troca"],
    ["queria trokar por outro número", "troca"],
    ["não serviu, ficou grande", "troca"],
    ["nao servio", "troca"],
    ["tem outra numeração?", "troca"],
    ["ficou muito apertado", "troca"],
    ["quero devolver", "devolucao"],
    ["quero fazer a devoluçao", "devolucao"],
    ["me arrependi da compra", "devolucao"],
    ["quero meu dinheiro de volta", "devolucao"],
    ["cadê meu reembolso", "devolucao"],
    ["quero cancelar o pedido", "devolucao"],
    ["quero trocar ou devolver, não sei", "indefinido"],
  ])("%s → %s", (txt, exp) => expect(classifyIntent(txt)).toBe(exp));
  it("ignora mensagem sem pedido de troca", () => {
    expect(classifyIntent("bom dia, tem esse modelo?")).toBeNull();
    expect(classifyIntent("vou passar na loja amanhã")).toBeNull();
  });
});

describe("regras de decisão", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const recent = new Date("2026-11-09T12:00:00Z");
  it("compra só na loja → presencial", () =>
    expect(decide({ intent: "troca", onlineOrders: 0, storeOrders: 1, deliveredAt: null, windowDays: 7, now }).decision).toBe("presencial"));
  it("vários pedidos → fila", () =>
    expect(decide({ intent: "troca", onlineOrders: 2, storeOrders: 0, deliveredAt: recent, windowDays: 7, now }).reason).toBe("varios_pedidos"));
  it("nenhum pedido → fila", () =>
    expect(decide({ intent: "troca", onlineOrders: 0, storeOrders: 0, deliveredAt: null, windowDays: 7, now }).reason).toBe("nenhum_pedido"));
  it("fora do prazo de 7 dias → fila", () =>
    expect(decide({ intent: "devolucao", onlineOrders: 1, storeOrders: 0, deliveredAt: new Date("2026-11-01T12:00:00Z"), windowDays: 7, now }).reason).toBe("fora_do_prazo"));
  it("intenção indefinida → fila", () =>
    expect(decide({ intent: "indefinido", onlineOrders: 1, storeOrders: 0, deliveredAt: recent, windowDays: 7, now }).reason).toBe("intencao_indefinida"));
  it("entrega sem confirmação → fila", () =>
    expect(decide({ intent: "troca", onlineOrders: 1, storeOrders: 0, deliveredAt: null, windowDays: 7, now }).reason).toBe("entrega_sem_confirmacao"));
  it("1 pedido no prazo → link", () =>
    expect(decide({ intent: "troca", onlineOrders: 1, storeOrders: 0, deliveredAt: recent, windowDays: 7, now }).decision).toBe("enviar_link"));
});

describe("modo sombra", () => {
  it("shadow e off nunca enviam", () => {
    expect(shouldAutoSend("shadow", true, "enviar_link")).toBe(false);
    expect(shouldAutoSend("off", true, "enviar_link")).toBe(false);
  });
  it("auto exige Centrais abertas e 1 pedido elegível", () => {
    expect(shouldAutoSend("auto", false, "enviar_link")).toBe(false);
    expect(shouldAutoSend("auto", true, "fila")).toBe(false);
    expect(shouldAutoSend("auto", true, "enviar_link")).toBe(true);
  });
});
