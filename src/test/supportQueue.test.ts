import { compareSupportRows, exchangeDeskTabs, resolveExchangeDeskTab, supportWaitInfo } from "@/lib/exchangeDesk/supportQueue";
import { allowedPOSSections } from "@/lib/pos/sectionAccess";

const NOW = new Date("2026-11-12T15:00:00Z").getTime();
const ago = (hours: number) => new Date(NOW - hours * 3600000).toISOString();

describe("fila Em suporte", () => {
  it("destaca somente depois de 1 hora, 4 horas e 24 horas", () => {
    expect(supportWaitInfo(ago(1), null, NOW).level).toBe("normal");
    expect(supportWaitInfo(ago(1.01), null, NOW).level).toBe("1h");
    expect(supportWaitInfo(ago(4), null, NOW).level).toBe("1h");
    expect(supportWaitInfo(ago(4.01), null, NOW).level).toBe("4h");
    expect(supportWaitInfo(ago(24), null, NOW).level).toBe("4h");
    expect(supportWaitInfo(ago(24.01), null, NOW).level).toBe("24h");
  });

  it("não marca espera quando a loja respondeu depois, mesmo sem leitura", () => {
    expect(supportWaitInfo(ago(8), ago(2), NOW).waiting).toBe(false);
    expect(supportWaitInfo(ago(8), ago(9), NOW).waiting).toBe(true);
  });

  it("ordena primeiro quem espera há mais tempo", () => {
    const rows = [
      { waiting: false, last_incoming_at: ago(1), last_message_at: ago(0.1) },
      { waiting: true, last_incoming_at: ago(2), last_message_at: ago(2) },
      { waiting: true, last_incoming_at: ago(10), last_message_at: ago(10) },
    ];
    expect([...rows].sort(compareSupportRows)[0].last_incoming_at).toBe(ago(10));
  });

  it("mantém Em suporte primeiro e esconde Treino, Roteiro e Custo de não admin", () => {
    expect(exchangeDeskTabs(false)[0]).toBe("suporte");
    expect(exchangeDeskTabs(false)).toEqual(["suporte", "precisa", "andamento", "concluidas", "sugestoes", "assistente"]);
    expect(exchangeDeskTabs(true)).toEqual(["suporte", "precisa", "andamento", "concluidas", "sugestoes", "treino", "assistente", "roteiro", "custo"]);
    expect(resolveExchangeDeskTab("treino", false)).toBe("suporte");
    expect(resolveExchangeDeskTab("treino", true)).toBe("treino");
  });

  it("mostra só Expedição para quem não tem acesso ao PDV completo", () => {
    expect(allowedPOSSections(["expedition"], ["dashboard", "expedition", "sales"])).toEqual(["expedition"]);
    expect(allowedPOSSections(["pos", "expedition"], ["dashboard", "expedition", "sales"])).toEqual(["dashboard", "expedition", "sales"]);
  });
});
