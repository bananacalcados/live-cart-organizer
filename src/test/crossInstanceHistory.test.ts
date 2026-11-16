import { describe, expect, it } from "vitest";
import { otherInstanceHistory } from "@/lib/chat/crossInstanceHistory";

const instances = [{ id: "centro", label: "Whats Centro" }, { id: "perola", label: "Meta Pérola" }];

describe("aviso de histórico em outra instância", () => {
  it("mostra a outra instância e sua contagem quando a aberta está vazia", () => {
    expect(otherInstanceHistory([{ whatsapp_number_id: "perola", message_count: 42 }], "centro", 0, instances))
      .toEqual({ whatsapp_number_id: "perola", message_count: 42, label: "Meta Pérola" });
  });

  it("não consulta/exibe aviso quando a conversa atual já tem mais de três mensagens", () => {
    expect(otherInstanceHistory([{ whatsapp_number_id: "perola", message_count: 42 }], "centro", 4, instances)).toBeNull();
  });

  it("ignora a instância atual e escolhe a outra com mais mensagens", () => {
    expect(otherInstanceHistory([
      { whatsapp_number_id: "centro", message_count: 1 },
      { whatsapp_number_id: "perola", message_count: 12 },
    ], "centro", 1, instances)?.label).toBe("Meta Pérola");
  });
});
