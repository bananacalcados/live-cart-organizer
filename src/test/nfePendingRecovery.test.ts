import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consultPendingNfe, fiscalProviderFailure, resumePendingNfe, validatePendingPayload, type PendingNfe } from "../../supabase/functions/_shared/fiscal/provider-recovery";

const key = "31261116941125000156550010000040601040589280";
const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
beforeAll(() => { Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: () => new AbortController().signal }); });
afterAll(() => {
  if (timeoutDescriptor) Object.defineProperty(AbortSignal, "timeout", timeoutDescriptor);
  else Reflect.deleteProperty(AbortSignal, "timeout");
});
const protocol = "131268142389864";
const doc: PendingNfe = { id: "same-doc", numero: 4060, serie: 1, ambiente: "producao", company_id: "same-company",
  created_at: new Date().toISOString(), status: "pending_sefaz", retry_count: 0, last_retry_at: null, next_retry_at: null,
  brasilnfe_request: { ModeloDocumento: 55, Numero: 4060, Serie: 1, TipoAmbiente: "1", IdentificadorInterno: "NFE-POS-same-sale",
    Emitente: { CpfCnpj: "16941125000156" }, Produtos: [{ Codigo: "original", Quantidade: 1, ValorTotal: 300 }], Pagamentos: [{ VlPago: 300 }] } };
const json = (body: unknown) => Response.json(body);
const missing = () => json({ Notas: [], Error: "Não existe notas fiscais para o período informado.", Avisos: [] });
const emptyPeriod = () => json({ Notas: [], Error: "", Avisos: [] });
const authorized = () => json({ ReturnNF: { Ok: true, ChaveNF: key, Numero: 4060, Serie: 1, NumeroProtocolo: protocol, CodStatusRespostaSefaz: 100 },
  Base64Xml: btoa(`<nfeProc><infNFe Id="NFe${key}"/><protNFe><infProt><chNFe>${key}</chNFe><nProt>${protocol}</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`), Base64File: btoa("%PDF-fake-test-only") });
function database(available = true) {
  const updates: Record<string, any>[] = [];
  return { updates, from: (table: string) => {
    expect(table).toBe("fiscal_documents");
    let patch: Record<string, any>;
    const q: any = { update: (value: any) => { patch = value; updates.push(value); return q; },
      eq: (field: string, value: unknown) => { if (field === "id") expect(value).toBe("same-doc"); return q; },
      is: () => q, select: () => q, maybeSingle: async () => ({ data: available ? { id: "same-doc", ...patch } : null, error: null }) };
    return q;
  }, storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/danfe.pdf" } }) }) } };
}
const persistFiles = async (_db: any, response: any) => ({ xml_content: atob(response.Base64Xml), danfe_url: "https://example.test/danfe.pdf" });
function provider(responses: Array<() => Response>) {
  const calls: { url: string; body: any }[] = [];
  const fetcher = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected provider call");
    return next();
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("NF-e 4060: retomada segura sem nova numeração", () => {
  it.each([502, 503, 504])("HTTP %i HTML é falha do provedor, sem gravar HTML", (status) => {
    const failure = fiscalProviderFailure(status, "<!DOCTYPE html><html>Cloudflare Bad gateway</html>");
    expect(failure.unavailable).toBe(true);
    expect(failure.summary).toContain("Provedor fiscal indisponível");
    expect(JSON.stringify(failure.response)).not.toContain("<html>");
  });
  it("resposta incerta -> consulta autorizada -> recupera no mesmo documento sem enviar", async () => {
    const db = database();
    const auth = await authorized().json();
    const p = provider([() => json({ Notas: [{ IdentificadorInterno: doc.brasilnfe_request.IdentificadorInterno, Numero: 4060, Serie: 1, ModeloDocumento: 55, Status: 1, Chave: key, NumeroProtocolo: protocol }], Error: "", Avisos: [] }),
      () => json(auth.Base64Xml), () => json(auth.Base64File)]);
    const result = await resumePendingNfe(db, doc, "fake-test-only", p.fetcher, persistFiles);
    expect(result).toMatchObject({ ok: true, recovered: true, document_id: "same-doc", numero: 4060, protocolo: protocol });
    expect(p.calls.some(c => c.url.endsWith("EnviarNotaFiscal"))).toBe(false);
    expect(db.updates.at(-1)).toMatchObject({ status: "authorized", chave_acesso: key, protocolo: protocol });
    expect(db.updates.at(-1)?.xml_content).toContain(key);
  });
  it("inexistente -> consulta independente -> reenvia snapshot intacto com 4060 série 1", async () => {
    const db = database(); const p = provider([missing, emptyPeriod, authorized]);
    const result = await resumePendingNfe(db, doc, "fake-test-only", p.fetcher, persistFiles);
    expect(result).toMatchObject({ ok: true, recovered: false, numero: 4060, serie: 1, document_id: "same-doc" });
    expect(p.calls.map(c => c.url.split("/").at(-1))).toEqual(["ObterNotasFiscais", "ObterNotasFiscais", "EnviarNotaFiscal"]);
    expect(p.calls[2].body).toEqual(doc.brasilnfe_request);
    expect(db.updates.some(patch => "numero" in patch || "serie" in patch || "company_id" in patch)).toBe(false);
  });
  it("consulta 502 não permite reenvio", async () => {
    const db = database(); const p = provider([() => new Response("<html>502</html>", { status: 502 })]);
    expect(await resumePendingNfe(db, doc, "fake-test-only", p.fetcher)).toMatchObject({ ok: false, contingencia: true });
    expect(p.calls).toHaveLength(1);
    expect(db.updates.some(p => p.status === "authorized")).toBe(false);
  });
  it("lista vazia sem confirmação explícita não permite reenviar", async () => {
    const p = provider([emptyPeriod]);
    expect(await consultPendingNfe(doc, "fake-test-only", p.fetcher)).toMatchObject({ kind: "uncertain" });
    expect(p.calls).toHaveLength(1);
  });
  it("nota 4060 encontrada em processamento nunca é reenviada", async () => {
    const p = provider([() => json({ Notas: [{ Numero: 4060, Serie: 1, ModeloDocumento: 55, Status: 0 }], Error: "" })]);
    expect(await consultPendingNfe(doc, "fake-test-only", p.fetcher)).toMatchObject({ kind: "uncertain" });
    expect(p.calls).toHaveLength(1);
  });
  it("duplicidade 539 na retomada nunca reserva o próximo número", async () => {
    const db = database(); const p = provider([missing, emptyPeriod, () => json({ ReturnNF: { Ok: false, CodStatusRespostaSefaz: 539, DsStatusRespostaSefaz: "Duplicidade" } })]);
    expect(await resumePendingNfe(db, doc, "fake-test-only", p.fetcher)).toMatchObject({ ok: false, numero: 4060 });
    expect(p.calls).toHaveLength(3);
    expect(db.updates.at(-1)?.rejection_message).toContain("4060");
  });
  it("lease concorrente impede qualquer chamada ao provedor", async () => {
    const db = database(false); const p = provider([]);
    expect(await resumePendingNfe(db, doc, "fake-test-only", p.fetcher)).toMatchObject({ ok: false });
    expect(p.calls).toHaveLength(0);
  });
  it("nota autorizada e snapshot com outra numeração não podem ser retomados", async () => {
    expect(() => validatePendingPayload({ ...doc, numero: 4061 })).toThrow("divergentes");
    await expect(resumePendingNfe(database(), { ...doc, status: "authorized" }, "fake", provider([]).fetcher)).rejects.toThrow("pendente");
  });
  it("502 no reenvio mantém a mesma pendência e grava apenas resumo", async () => {
    const db = database(); const p = provider([missing, emptyPeriod, () => new Response("<!DOCTYPE html><html>Cloudflare</html>", { status: 502 })]);
    expect(await resumePendingNfe(db, doc, "fake-test-only", p.fetcher)).toMatchObject({ ok: false, contingencia: true, numero: 4060 });
    expect(db.updates.at(-1)?.brasilnfe_response).toMatchObject({ provider_unavailable: true, httpStatus: 502 });
    expect(JSON.stringify(db.updates)).not.toContain("<html>");
  });
});