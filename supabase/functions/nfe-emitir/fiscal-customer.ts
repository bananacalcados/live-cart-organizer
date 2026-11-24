// Bloco Cliente da NF-e online. Mantido isolado para testar o payload sem chamar o emissor.
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const sanitize = (value: unknown) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Za-z0-9 ]/g, " ")
  .replace(/\s+/g, " ").trim();

export type NfeCustomerPayloadInput = {
  cpf: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  codMunicipio: string;
  municipio: string;
  uf: string;
};

export function buildNfeCustomerPayload(input: NfeCustomerPayloadInput) {
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
