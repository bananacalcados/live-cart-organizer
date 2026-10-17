import { describe, expect, it } from "vitest";
import { buildInstallmentOptions, resolveInstallmentSelection, type InstallmentConfig } from "@/lib/installmentRules";

describe("buildInstallmentOptions", () => {
  const tenInstallments: InstallmentConfig = { max_installments: 10, interest_free_installments: 10, monthly_interest_rate: 0 };

  it("fixa em 10x a escolha da equipe mesmo se a cliente tinha escolhido 3x", () => {
    const selection = resolveInstallmentSelection(buildInstallmentOptions(500, tenInstallments), "3", 10);
    expect(selection.locked).toBe(true);
    expect(selection.count).toBe(10);
    expect(selection.option?.installmentAmount).toBe(50);
    expect(selection.option?.chargeAmount).toBe(500);
  });

  it("sem escolha da equipe mantém as parcelas escolhidas pela cliente", () => {
    const selection = resolveInstallmentSelection(buildInstallmentOptions(500, tenInstallments), "3", null);
    expect(selection.count).toBe(3);
    expect(selection.locked).toBe(false);
  });

  it("não substitui 10x fixadas por 1x quando a condição não está disponível", () => {
    expect(resolveInstallmentSelection(buildInstallmentOptions(500, { ...tenInstallments, max_installments: 6 }), "1", 10))
      .toEqual({ locked: true, count: 0, option: null });
  });

  it("débito permanece em 1x mesmo quando crédito foi fixado em 10x", () => {
    expect(resolveInstallmentSelection(buildInstallmentOptions(500, tenInstallments), "", 10, true).count).toBe(1);
  });

  it("mantém a regra de 10x sem juros da Live mesmo se o cartão informar juros", () => {
    const config: InstallmentConfig = {
      max_installments: 10,
      interest_free_installments: 10,
      monthly_interest_rate: 2.49,
    };
    const options = buildInstallmentOptions(359.99, config, [{
      installments: 10,
      installmentAmount: 43,
      totalAmount: 430,
      interestFree: false,
    }]);

    expect(options).toEqual([expect.objectContaining({
      installments: 10,
      totalAmount: 359.99,
      chargeAmount: 359.99,
      hasInterest: false,
    })]);
    expect(options[0].label).toContain("sem juros");
  });
});