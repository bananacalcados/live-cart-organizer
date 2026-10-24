import { describe, expect, it } from "vitest";
import { registrationErrors, type RegistrationFields } from "@/lib/selfServiceRegistrationValidation";

const valid: RegistrationFields = {
  full_name: "Maria Oliveira", email: "maria.oliveira@example.com", cpf: "529.982.247-25",
  cep: "35010-000", address: "Rua Um", address_number: "10", complement: "",
  neighborhood: "Centro", city: "Governador Valadares", state: "MG",
};

describe("registration field validation", () => {
  it("rejects an email in the full name field even when every other field is valid", () => {
    const errors = registrationErrors({ ...valid, full_name: "maria.oliveira@example.com" }, valid, false);
    expect(Object.keys(errors)).toEqual(["full_name"]);
  });
  it("accepts the corrected full name", () => {
    expect(registrationErrors(valid, valid, false)).toEqual({});
  });
  it("identifies each missing required address field", () => {
    expect(Object.keys(registrationErrors({ ...valid, cep: "", address: "", address_number: "", city: "", state: "" }, valid, false)).sort())
      .toEqual(["address", "address_number", "cep", "city", "state"]);
  });
  it("identifies invalid CPF and email independently", () => {
    expect(Object.keys(registrationErrors({ ...valid, cpf: "11111111111", email: "invalid" }, valid, false)).sort()).toEqual(["cpf", "email"]);
  });
  it("requires alternate delivery fields only while enabled", () => {
    const alt = { ...valid, cep: "" };
    expect(registrationErrors(valid, alt, false)).toEqual({});
    expect(Object.keys(registrationErrors(valid, alt, true))).toEqual(["alt_cep"]);
  });
});