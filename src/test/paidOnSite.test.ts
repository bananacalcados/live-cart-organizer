import { describe, expect, it } from "vitest";
import { MANUAL_PAYMENT_METHODS, PAID_ON_SITE_METHOD } from "@/components/MarkOrderPaidDialog";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";

describe("forma de pagamento COMPROU NO SITE", () => {
  it("é a primeira opção, seguida do PIX", () => {
    expect(MANUAL_PAYMENT_METHODS[0].value).toBe(PAID_ON_SITE_METHOD);
    expect(MANUAL_PAYMENT_METHODS[1].value).toBe("PIX");
  });

  it("pedido comprado no site conta como pago", () => {
    expect(isOrderMarkedPaid({ stage: "paid", is_paid: true, paid_externally: true })).toBe(true);
  });
});
