import { describe, expect, it } from "vitest";
import { liveStaffCartLink, mergeSelfServiceDraft, selfServiceDraftPhoneKey } from "@/lib/selfServiceStaff";

describe("staff self-service draft", () => {
  it("matches the server key for the reported Brazilian phone", () => {
    expect(selfServiceDraftPhoneKey("(31) 98216-3750")).toBe("1982163750");
    expect(selfServiceDraftPhoneKey("5531982163750")).toBe("1982163750");
  });
  it("updates incomplete draft data before confirmation", () => {
    expect(mergeSelfServiceDraft({ full_name: "", city: "" }, { full_name: "Silvania", city: "Casa Grande" }, ["full_name", "city"], new Set())).toEqual({ full_name: "Silvania", city: "Casa Grande" });
  });
  it("preserves manually edited staff fields", () => {
    expect(mergeSelfServiceDraft({ full_name: "Equipe", city: "" }, { full_name: "Cliente", city: "Casa Grande" }, ["full_name", "city"], new Set(["full_name"]))).toEqual({ full_name: "Equipe", city: "Casa Grande" });
  });
  it("does not change a reference when values do not change", () => {
    const form = { full_name: "Silvania" };
    expect(mergeSelfServiceDraft(form, form, ["full_name"], new Set())).toBe(form);
  });
});
describe("manual live cart", () => {
  const id = "a967d2bc-5bfa-4eb3-9d44-3af09c7cbf78";
  it("allows an exact cart link without a WhatsApp confirmation, opening straight on the card screen", () => {
    expect(liveStaffCartLink({ operation_mode: "whatsapp_autoatendimento", self_service_slug: "livebanana2310" }, id)).toBe(`https://checkout.bananacalcados.com.br/pedido/livebanana2310/carrinho/${id.replace(/-/g, "")}?pgto=cartao`);
  });
  it.each(["manual", "member_area", "whatsapp"])("keeps old mode %s unchanged", (operation_mode) => {
    expect(liveStaffCartLink({ operation_mode, self_service_slug: "livebanana2310" }, id)).toBeNull();
  });
  it("rejects a virtual order", () => {
    expect(liveStaffCartLink({ operation_mode: "whatsapp_autoatendimento", self_service_slug: "livebanana2310" }, "live-contact-phone")).toBeNull();
  });
});