import { describe, expect, it } from "vitest";
import { canBulkAdvance, missingOrderData, shippingTag, sortMobileExpedition } from "@/lib/pos/expeditionReadiness";

const base: any = { id: "x", created_at: "2026-11-20T10:00:00Z", status: "paid", paid_at: "2026-11-20", customer_name: "Ana", customer_phone: "33999998888", resolved_phone: "33999998888",
  customer_cpf: "12345678909", shipping_carrier: "Correios PAC", shipping_address: { cep: "35000000", address: "Rua A", number: "1", neighborhood: "B", city: "GV", state: "MG" }, payment_details: {}, items: [] };

describe("expedição mobile", () => {
  it("SEDEX e Mototaxista primeiro, depois mais antigo", () => {
    const old = { ...base, id: "old", created_at: "2026-11-01T00:00:00Z" };
    const moto = { ...base, id: "moto", shipping_carrier: "Mototaxi" };
    const sedex = { ...base, id: "sedex", is_sedex: true, created_at: "2026-11-25T00:00:00Z" };
    expect(sortMobileExpedition([old, moto, sedex], "novo").map(o => o.id)).toEqual(["moto", "sedex", "old"]);
  });
  it("etiquetas de frete", () => {
    expect(shippingTag({ ...base, shipping_carrier: "Mototaxi" }).label).toBe("Mototaxista GV");
    expect(shippingTag({ ...base, shipping_carrier: null, delivery_method: null }).tone).toBe("none");
  });
  it("dados completos e faltantes", () => {
    expect(missingOrderData(base)).toEqual([]);
    expect(missingOrderData({ ...base, customer_cpf: "", shipping_address: {}, shipping_carrier: "" })).toEqual(["CPF", "frete", "CEP", "endereço"]);
    expect(missingOrderData({ ...base, shipping_carrier: "Retirada na loja", shipping_address: {} })).toEqual([]);
  });
  it("não avança em lote na conferência nem avulso incompleto", () => {
    expect(canBulkAdvance(base, "conferencia")).toBe(false);
    expect(canBulkAdvance({ ...base, is_avulso: true, avulso_ready: false }, "novo")).toBe(false);
    expect(canBulkAdvance(base, "novo")).toBe(true);
  });
});
