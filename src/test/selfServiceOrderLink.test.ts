import { describe, expect, it } from "vitest";
import { selfserviceOrderLink } from "../../supabase/functions/_shared/selfservice-order-link";

describe("payment link source order", () => {
  it("uses Amine's exact order in this live", () => {
    expect(selfserviceOrderLink({ operation_mode: "whatsapp_autoatendimento", self_service_slug: "livebanana2310" }, "cbe2420c-c371-40b0-aa98-72e5575599e6"))
      .toBe("https://checkout.bananacalcados.com.br/pedido/livebanana2310/carrinho/cbe2420cc37140b0aa9872e5575599e6");
  });
  it.each(["manual", "member_area", "whatsapp"])("does not redirect the legacy %s mode", (mode) => {
    expect(selfserviceOrderLink({ operation_mode: mode, self_service_slug: "livebanana2310" }, "order-a")).toBeNull();
  });
  it("does not create a generic cart for a contact without an order", () => {
    expect(selfserviceOrderLink({ operation_mode: "whatsapp_autoatendimento", self_service_slug: "livebanana2310" }, null)).toBeNull();
  });
});