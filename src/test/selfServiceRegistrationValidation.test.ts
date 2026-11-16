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
  it("rejects browser email autofill in each address field with a friendly error", () => {
    expect(registrationErrors({ ...valid, address: "kashimirtricot@gmail.com" }, valid, false).address).toBe("Digite o nome da rua, não o e-mail.");
    expect(registrationErrors({ ...valid, address_number: "cliente@example.com" }, valid, false).address_number).toBe("Digite o número do endereço, não o e-mail.");
    expect(registrationErrors({ ...valid, neighborhood: "cliente@example.com" }, valid, false).neighborhood).toBe("Digite o bairro, não o e-mail.");
  });
  it.each(["12", "12A", "S/N", "sn", "Km 12", "123-B"])("accepts common address number %s", (address_number) => {
    expect(registrationErrors({ ...valid, address: "Rua 7 de Setembro", address_number }, valid, false)).toEqual({});
  });
  it("rejects an implausible address number", () => {
    expect(registrationErrors({ ...valid, address_number: "abc" }, valid, false).address_number).toContain("número válido");
  });
  it("validates alternate delivery address fields too", () => {
    expect(registrationErrors(valid, { ...valid, address: "cliente@example.com" }, true).alt_address).toBe("Digite o nome da rua, não o e-mail.");
  });
});