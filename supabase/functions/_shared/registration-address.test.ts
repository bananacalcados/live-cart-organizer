import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPlausibleAddressNumber, registrationAddressFieldError } from "./registration-address.ts";

Deno.test("recusa e-mail preenchido automaticamente nos campos de endereço", () => {
  assertEquals(registrationAddressFieldError("address", "kashimirtricot@gmail.com"), "Digite o nome da rua, não o e-mail.");
  assertEquals(registrationAddressFieldError("address_number", "cliente@example.com"), "Digite o número do endereço, não o e-mail.");
  assertEquals(registrationAddressFieldError("neighborhood", "cliente@example.com"), "Digite o bairro, não o e-mail.");
});

Deno.test("aceita endereços e números comuns", () => {
  assertEquals(registrationAddressFieldError("address", "Rua 7 de Setembro"), null);
  assertEquals(registrationAddressFieldError("neighborhood", "São Pedro"), null);
  for (const value of ["12", "12A", "S/N", "sn", "Km 12", "123-B"]) {
    assertEquals(isPlausibleAddressNumber(value), true, value);
  }
});

Deno.test("recusa número sem dígitos ou texto longo demais", () => {
  assertEquals(isPlausibleAddressNumber("abc"), false);
  assertEquals(isPlausibleAddressNumber("123456789012345678901"), false);
  assertEquals(registrationAddressFieldError("address_number", "abc")?.includes("número válido"), true);
});
