import { describe, expect, it } from "vitest";
import { parseTrackingInput, normalizeTrackingField } from "@/lib/logistics/trackingInput";

describe("rastreio colado como link", () => {
  it("Leila: link da Frenet vira AP724578092BR + Correios", () => {
    expect(parseTrackingInput("https://rastreio.frenet.com.br/COR/AP724578092BR?")).toEqual({ code: "AP724578092BR", carrier: "Correios", url: "https://rastreio.frenet.com.br/COR/AP724578092BR?" });
  });
  it("J&T pela Frenet, com lixo de rastreamento no fim", () => {
    expect(parseTrackingInput("https://rastreio.frenet.com.br/JTE/888031006648552?_gl=1*abc")?.code).toBe("888031006648552");
    expect(parseTrackingInput("HTTPS://RASTREIO.FRENET.COM.BR/JTE/888030740730967")?.carrier).toBe("J&T Express");
  });
  it("Jadlog com e sem domínio", () => {
    expect(parseTrackingInput("JAD/624431976")).toEqual({ code: "624431976", carrier: "Jadlog", url: null });
    expect(parseTrackingInput("https://www.jadlog.com.br/tracking?cte=12345678901")?.code).toBe("12345678901");
  });
  it("link dos Correios", () => {
    expect(parseTrackingInput("https://rastreamento.correios.com.br/app/index.php?objetos=qb123456789br")?.code).toBe("QB123456789BR");
  });
  it("código puro não muda; link nosso e formato desconhecido também não", () => {
    expect(normalizeTrackingField("AP724578092BR")).toBe("AP724578092BR");
    expect(parseTrackingInput("https://checkout.bananacalcados.com.br/rastreio/BCJMPDHY")).toBeNull();
    expect(parseTrackingInput("HTTPS://RASTREIO.FRENET.COM.BR/JA159D/619019")).toBeNull();
  });
});
