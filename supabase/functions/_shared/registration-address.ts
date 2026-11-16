export type RegistrationAddressField = "address" | "address_number" | "neighborhood";

export function isPlausibleAddressNumber(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > 20) return false;
  return /^s\s*\/?\s*n$/i.test(value) || /^(?=.*\d)[a-z0-9\s./-]+$/i.test(value);
}

export function registrationAddressFieldError(field: RegistrationAddressField, raw: unknown): string | null {
  const value = String(raw ?? "").trim();
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
