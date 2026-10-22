import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { mergeKnownCustomer } from "@/lib/posCustomerResolve";

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
