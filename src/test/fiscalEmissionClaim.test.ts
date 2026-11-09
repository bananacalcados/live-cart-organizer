import { describe, expect, it } from "vitest";
import { applyReservedFiscalNumber, fiscalEmissionReuseBody, getFiscalEmissionClaim } from "../../supabase/functions/_shared/fiscal/emission-claim";

const claim = (extra: Record<string, unknown> = {}) => getFiscalEmissionClaim([{
  out_document_id: "doc-1",
  out_numero: 2768,
  out_status: "pending",
  out_claimed: true,
  out_chave_acesso: null,
  out_protocolo: null,
  out_danfe_url: null,
  ...extra,
}]);

describe("trava e numeração da emissão fiscal", () => {
  it("CNPJ da AustPay com última nota 2767 envia a próxima como 2768", () => {
    const payload = applyReservedFiscalNumber({ ModeloDocumento: 55, IdentificadorInterno: "NFE-POS-sale" }, claim());
    expect(payload.Numero).toBe(2768);
    expect(payload.Serie).toBe(1);
    expect(payload.IdentificadorInterno).toBe("NFE-POS-sale");
  });

  it("uma emissão reutilizada nunca pode ser enviada de novo ao provedor", () => {
    expect(() => applyReservedFiscalNumber({ ModeloDocumento: 55 }, claim({ out_claimed: false })))
      .toThrow("não pode ser reenviada");
  });

  it("nota já autorizada é reutilizada com a mesma chave", () => {
    const body = fiscalEmissionReuseBody(claim({ out_claimed: false, out_status: "authorized", out_chave_acesso: "chave-1" }));
    expect(body).toMatchObject({ ok: true, reused: true, chave_acesso: "chave-1", contingencia: false });
  });

  it("clique repetido durante emissão não cria erro nem nova tentativa", () => {
    const body = fiscalEmissionReuseBody(claim({ out_claimed: false, out_status: "pending" }));
    expect(body).toMatchObject({ ok: true, reused: true, contingencia: false });
    expect(body.message).toContain("nenhuma nota duplicada");
  });
});
