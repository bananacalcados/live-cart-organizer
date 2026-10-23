import { describe, expect, it } from "vitest";
import { buildInstallmentOptions, resolveInstallmentSelection, resolveSelfServiceInstallments, type InstallmentConfig } from "@/lib/installmentRules";

describe("oferta do autoatendimento", () => {
  const base: InstallmentConfig = { max_installments: 12, interest_free_installments: 6, monthly_interest_rate: 2.49 };
  it("R$ 159,99 permite 6x sem juros ou 10x com juros, não 12x", () => {
    const config = resolveSelfServiceInstallments(base, 159.99, 10, 300);
    const options = buildInstallmentOptions(159.99, config);
    expect(options.filter(o => !o.hasInterest).map(o => o.installments)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(options.filter(o => o.hasInterest).map(o => o.installments)).toEqual([7, 8, 9, 10]);
    expect(options.find(o => o.installments === 10)?.totalAmount).toBeGreaterThan(159.99);
  });
  it("libera 10x sem juros somente quando alcança o mínimo de R$ 300", () => {
    expect(resolveSelfServiceInstallments(base, 299.99, 10, 300).interest_free_installments).toBe(6);
    expect(resolveSelfServiceInstallments(base, 300, 10, 300).interest_free_installments).toBe(10);
  });
});

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

  it("preserva 10x fixadas para a cascata quando o MP oferece somente até 6x", () => {
    const mp = [{ installments: 6, installmentAmount: 500 / 6, totalAmount: 500, interestFree: true }];
    const options = buildInstallmentOptions(500, tenInstallments, mp, 10);
    const selection = resolveInstallmentSelection(options, "", 10);
    expect(selection.count).toBe(10);
    expect(selection.option).toMatchObject({ chargeAmount: 500, totalAmount: 500, installmentAmount: 50, hasInterest: false });
    expect(buildInstallmentOptions(500, tenInstallments, mp).map(o => o.installments)).toEqual([6]);
  });

  it("não libera 10x fixadas acima do teto de 6x do pedido", () => {
    const options = buildInstallmentOptions(500, { ...tenInstallments, max_installments: 6 }, null, 10);
    expect(resolveInstallmentSelection(options, "1", 10).count).toBe(0);
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