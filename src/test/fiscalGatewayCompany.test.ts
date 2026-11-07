import { describe, expect, it } from "vitest";
import { chooseFiscalCompany, normalizeFiscalGateway } from "../../supabase/functions/_shared/fiscal/gateway-company";

const OLD = "febc4662-a126-493e-ada1-4729122760ed";
const BANANA = "69d3b494-9126-4438-bb05-eb976a8380ad";
const mappings = { pagarme: BANANA, rinne: BANANA, austpay: BANANA, mercadopago: OLD, appmax: OLD, vindi: OLD };

function choose(gateways: string[], extra: Record<string, unknown> = {}) {
  return chooseFiscalCompany({ enabled: true, defaultCompanyId: OLD, storeCompanyId: OLD, gateways, mappings, ...extra });
}

describe("CNPJ emissor pelo gateway", () => {
  it.each(["pagarme", "rinne", "austpay"])("%s usa o CNPJ 43.102.495/0001-72", (gateway) => {
    expect(choose([gateway]).companyId).toBe(BANANA);
  });

  it.each(["mercadopago", "appmax", "vindi"])("%s usa o CNPJ 16.941.125/0001-56", (gateway) => {
    expect(choose([gateway]).companyId).toBe(OLD);
  });

  it("normaliza Pagar.me e Mercado Pago sem depender da grafia", () => {
    expect(normalizeFiscalGateway("Pagar.me")).toBe("pagarme");
    expect(normalizeFiscalGateway("Mercado Pago")).toBe("mercadopago");
  });

  it("usa a empresa padrão para gateway conhecido sem mapeamento", () => {
    const result = choose(["paypal"]);
    expect(result.companyId).toBe(OLD);
    expect(result.rule).toBe("default_gateway");
  });

  it("sem gateway usa a empresa da loja", () => {
    const result = choose([]);
    expect(result.companyId).toBe(OLD);
    expect(result.rule).toBe("store");
  });

  it("pagamento dividido entre CNPJs diferentes bloqueia o automático", () => {
    const result = choose(["pagarme", "mercadopago"]);
    expect(result.mixed).toBe(true);
    expect(result.rule).toBe("mixed_companies");
    expect(result.companyIds).toEqual([BANANA, OLD]);
  });

  it("pagamento dividido no mesmo CNPJ não bloqueia", () => {
    const result = choose(["pagarme", "rinne"]);
    expect(result.mixed).toBe(false);
    expect(result.companyId).toBe(BANANA);
  });

  it("VPS não é tratado como um segundo CNPJ", () => {
    const result = choose(["pagarme", "vps"]);
    expect(result.mixed).toBe(false);
    expect(result.companyId).toBe(BANANA);
  });

  it("emissão manual escolhe um CNPJ para o pagamento dividido", () => {
    const result = choose(["pagarme", "mercadopago"], { forcedCompanyId: BANANA });
    expect(result.mixed).toBe(false);
    expect(result.rule).toBe("manual_split");
    expect(result.companyId).toBe(BANANA);
  });

  it("origem gateway_webhook não é confundida com o gateway que pagou", () => {
    const result = choose(["gateway_webhook"]);
    expect(result.rule).toBe("store");
    expect(result.gateways).toEqual([]);
  });

  it("interruptor desligado preserva o comportamento anterior", () => {
    const result = chooseFiscalCompany({ enabled: false, defaultCompanyId: OLD, gateways: ["pagarme"], mappings });
    expect(result.rule).toBe("legacy");
    expect(result.companyId).toBeNull();
  });
});
