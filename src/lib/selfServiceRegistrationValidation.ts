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
    if (!address.address_number.trim()) errors[`${prefix}address_number`] = "Digite o número do endereço (ou S/N).";
    if (!address.city.trim()) errors[`${prefix}city`] = "Digite a cidade.";
    if (!address.state.trim()) errors[`${prefix}state`] = "Digite a UF do estado.";
  };
  checkAddress(form, "");
  if (useAlt) checkAddress(alt, "alt_");
  return errors;
}