import { describe, expect, it } from "vitest";
import { cleanSelfserviceSignals, loadSelfserviceAdvertising } from "../../supabase/functions/_shared/selfservice-advertising";

describe("publicidade do autoatendimento", () => {
  it("aceite de cadastro não autoriza publicidade", async () => {
    const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { advertising: false, notice_version: "selfservice-meta-v1" } }) }) }) }) };
    expect(await loadSelfserviceAdvertising(sb, "11111111-1111-1111-1111-111111111111")).toBeNull();
  });
  it("retém somente URL sem dados pessoais nem parâmetros", () => {
    const signals = cleanSelfserviceSignals({ source_url: "https://checkout.bananacalcados.com.br/pedido/live?email=cliente@example.com&cpf=12345678900" }, new Request("https://example.com"));
    expect(signals.event_source_url).toBe("https://checkout.bananacalcados.com.br/pedido/live");
  });
  it("IP vem da conexão, não de campo enviado pela pessoa", () => {
    const signals = cleanSelfserviceSignals({ client_ip: "1.1.1.1" }, new Request("https://example.com", { headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" } }));
    expect(signals.client_ip).toBe("203.0.113.8");
  });
  it("não fabrica FBC quando não houve sinal de clique", () => expect(cleanSelfserviceSignals({}, new Request("https://example.com")).fbc).toBeNull());
});