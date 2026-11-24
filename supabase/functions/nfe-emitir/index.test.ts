import { assert, assertEquals } from "jsr:@std/assert";
import { buildNfeCustomerPayload, type NfeCustomerPayloadInput } from "./fiscal-customer.ts";
import { missingOnlineCustomerData, MISSING_CUSTOMER_MESSAGE } from "../_shared/fiscal/sale-fiscal-rules.ts";

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const sanitize = (value: unknown) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Za-z0-9 ]/g, " ")
  .replace(/\s+/g, " ").trim();

// Implementação anterior, preservada aqui só como gabarito do teste antes/depois.
function legacyCustomerPayload(input: NfeCustomerPayloadInput) {
  return {
    CpfCnpj: input.cpf,
    NmCliente: sanitize(input.name || "CONSUMIDOR").slice(0, 60),
    IndicadorIe: 9,
    Endereco: {
      Cep: input.cep,
      Logradouro: sanitize(input.logradouro).slice(0, 60) || "Rua nao informada",
      Numero: sanitize(input.numero).slice(0, 10) || "S/N",
      Bairro: input.bairro,
      CodMunicipio: input.codMunicipio,
      Municipio: input.municipio.slice(0, 60),
      Uf: input.uf,
      CodPais: 1058,
      Pais: "BRASIL",
    },
    Contato: {
      ...(input.phone ? { Telefone: digits(input.phone) } : {}),
      ...(input.email ? { Email: input.email } : {}),
    },
  };
}

const completeSale: NfeCustomerPayloadInput = {
  cpf: "52998224725",
  name: "José da Silva Áquila",
  phone: "(33) 99999-0000",
  email: "cliente.ficticia@example.com",
  cep: "35180000",
  logradouro: "Rua das Flores",
  numero: "123",
  bairro: "Centro",
  codMunicipio: "3131307",
  municipio: "ITABIRA",
  uf: "MG",
};

Deno.test("venda completa: bloco Cliente do payload fica idêntico ao anterior", () => {
  assertEquals(buildNfeCustomerPayload(completeSale), legacyCustomerPayload(completeSale));
  assertEquals(buildNfeCustomerPayload(completeSale), {
    CpfCnpj: "52998224725",
    NmCliente: "Jose da Silva Aquila",
    IndicadorIe: 9,
    Endereco: {
      Cep: "35180000",
      Logradouro: "Rua das Flores",
      Numero: "123",
      Bairro: "Centro",
      CodMunicipio: "3131307",
      Municipio: "ITABIRA",
      Uf: "MG",
      CodPais: 1058,
      Pais: "BRASIL",
    },
    Contato: { Telefone: "33999990000", Email: "cliente.ficticia@example.com" },
  });
});

Deno.test("venda sem CPF: mantém o erro claro de dado faltante antes do emissor", () => {
  const missing = missingOnlineCustomerData({
    cpf: null,
    uf: completeSale.uf,
    city: completeSale.municipio,
    neighborhood: completeSale.bairro,
    cep: completeSale.cep,
  });
  assertEquals(missing, ["CPF"]);
  assertEquals(`${MISSING_CUSTOMER_MESSAGE} (falta: ${missing.join(", ")})`,
    "Falta CPF/endereço da cliente — complete o cadastro (falta: CPF)");
});

Deno.test("nfe-emitir não volta a consultar o Tiny", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!source.includes("api.tiny.com.br"));
});
