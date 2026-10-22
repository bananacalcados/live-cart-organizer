import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { mergeKnownCustomer, fillEmptyCheckoutFields } from "@/lib/posCustomerResolve";

describe("pré-preenchimento do link do WhatsApp", () => {
  it("cadastro do PDV tem prioridade e o unificado completa o que falta", () => {
    const r = mergeKnownCustomer(
      { name: "Waleria", email: null, cpf: "45149429104" },
      { name: "Outra", email: "waleriamaria46@hotmail.com", cep: "77060040", city: "Palmas" },
    );
    expect(r.name).toBe("Waleria");
    expect(r.cpf).toBe("45149429104");
    expect(r.email).toBe("waleriamaria46@hotmail.com");
    expect(r.cep).toBe("77060040");
  });
});

describe("links antigos: completar dados vazios no checkout", () => {
  it("preenche só o que está vazio com os dados do cadastro", () => {
    const r = fillEmptyCheckoutFields(
      { fullName: "", email: "", cpf: "", cep: "35051520", address: "", city: "", state: "" },
      {
        name: "Maria Brígida de Almeida", cpf: "31686417829", email: "maria@teste.com",
        cep: "35051000", address: "Rua Vale Formoso", address_number: "362",
        complement: null, neighborhood: "Kennedy", city: "Governador Valadares", state: "MG",
      },
    );
    expect(r.fullName).toBe("Maria Brígida de Almeida");
    expect(r.cpf).toBe("31686417829");
    expect(r.email).toBe("maria@teste.com");
    expect(r.cep).toBe("35051520");
    expect(r.city).toBe("Governador Valadares");
  });

  it("nunca sobrescreve o que já veio do pedido ou foi digitado", () => {
    const r = fillEmptyCheckoutFields(
      { fullName: "Maria Brigida", email: "outra@teste.com", cpf: "11122233344", cep: "", address: "", city: "" },
      {
        name: "Nome Diferente", cpf: "99988877766", email: "cadastro@teste.com",
        cep: "35051000", address: "Rua X", address_number: "1",
        complement: null, neighborhood: "Centro", city: "GV", state: "MG",
      },
    );
    expect(r.fullName).toBe("Maria Brigida");
    expect(r.email).toBe("outra@teste.com");
    expect(r.cpf).toBe("11122233344");
    expect(r.cep).toBe("35051000");
    expect(r.address).toBe("Rua X");
  });

  it("não inventa dados quando o cadastro não tem", () => {
    const r = fillEmptyCheckoutFields(
      { fullName: "", email: "", cpf: "" },
      { name: null, cpf: null, email: null, cep: null, address: null, address_number: null, complement: null, neighborhood: null, city: null, state: null },
    );
    expect(r.fullName).toBe("");
    expect(r.email).toBe("");
    expect(r.cpf).toBe("");
  });
});
