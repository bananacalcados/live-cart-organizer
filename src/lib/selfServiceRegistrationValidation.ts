import { isRealFullName, isUsableEmail } from "./customerIdentity";
import { isValidCpf } from "./cpfUtils";
import { digitsOnly } from "./formatMasks";

export type RegistrationFields = {
  full_name: string; cep: string; address: string; address_number: string;
  complement: string; neighborhood: string; city: string; state: string;
  cpf: string; email: string;
};
export type DeliveryFields = Omit<RegistrationFields, "full_name" | "cpf" | "email">;
export type RegistrationErrorKey = keyof RegistrationFields | `alt_${keyof DeliveryFields}`;
export type RegistrationErrors = Partial<Record<RegistrationErrorKey, string>>;

export function isPlausibleAddressNumber(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > 20) return false;
  return /^s\s*\/?\s*n$/i.test(value) || /^(?=.*\d)[a-z0-9\s./-]+$/i.test(value);
}

function addressFieldError(field: "address" | "address_number" | "neighborhood", raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes("@")) {
    if (field === "address") return "Digite o nome da rua, não o e-mail.";
    if (field === "address_number") return "Digite o número do endereço, não o e-mail.";
    return "Digite o bairro, não o e-mail.";
  }
  if (field === "address_number" && !isPlausibleAddressNumber(value)) {
    return "Digite um número válido, como 12, 12A, S/N ou Km 12.";
  }
  return null;
}

// Same acceptance rules as the registration page; errors also drive field feedback.
export function registrationErrors(form: RegistrationFields, alt: DeliveryFields, useAlt: boolean): RegistrationErrors {
  const errors: RegistrationErrors = {};
  if (!isRealFullName(form.full_name)) errors.full_name = form.full_name.includes("@")
    ? "Você colocou um e-mail no nome. Digite seu nome e sobrenome aqui."
    : "Digite seu nome e sobrenome, sem números ou @.";
  if (!isValidCpf(form.cpf)) errors.cpf = "Confira o CPF: digite os 11 números de um CPF válido.";
  if (!isUsableEmail(form.email)) errors.email = "Digite um e-mail válido.";
  const checkAddress = (address: DeliveryFields, prefix: "" | "alt_") => {
    if (digitsOnly(address.cep).length !== 8) errors[`${prefix}cep`] = "Digite o CEP com 8 números.";
    if (!address.address.trim()) errors[`${prefix}address`] = "Digite a rua.";
    else if (addressFieldError("address", address.address)) errors[`${prefix}address`] = addressFieldError("address", address.address)!;
    if (!address.address_number.trim()) errors[`${prefix}address_number`] = "Digite o número do endereço (ou S/N).";
    else if (addressFieldError("address_number", address.address_number)) errors[`${prefix}address_number`] = addressFieldError("address_number", address.address_number)!;
    if (addressFieldError("neighborhood", address.neighborhood)) errors[`${prefix}neighborhood`] = addressFieldError("neighborhood", address.neighborhood)!;
    if (!address.city.trim()) errors[`${prefix}city`] = "Digite a cidade.";
    if (!address.state.trim()) errors[`${prefix}state`] = "Digite a UF do estado.";
  };
  checkAddress(form, "");
  if (useAlt) checkAddress(alt, "alt_");
  return errors;
}