import { describe, expect, it } from "vitest";
import { buildInstallmentOptions, type InstallmentConfig } from "@/lib/installmentRules";

describe("buildInstallmentOptions", () => {
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