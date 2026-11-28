const BASE = "https://api.brasilnfe.com.br/services/fiscal";
export type PendingNfe = {
  id: string; numero: number; serie: number; ambiente: string; company_id: string;
  created_at: string; brasilnfe_request: Record<string, any>; retry_count: number;
  last_retry_at: string | null; next_retry_at: string | null; status: string;
};

// NÃO REMOVER: HTTP/HTML do BrasilNFe não comprova indisponibilidade da SEFAZ.
export function fiscalProviderFailure(status: number, text: string, networkError: string | null = null) {
  const html = /<!doctype\s+html|<html[\s>]/i.test(text);
  const unavailable = !!networkError || status === 0 || status >= 500 || html;
  const summary = unavailable
    ? `Provedor fiscal indisponível${status ? ` (HTTP ${status})` : " (falha de comunicação)"}. Resultado da emissão incerto; consultar antes de reenviar.`
    : text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 300);
  return { unavailable, summary, response: { provider_unavailable: unavailable, httpStatus: status, summary } };
}

export function validatePendingPayload(doc: PendingNfe) {
  const p = doc.brasilnfe_request;
  if (!p || Number(p.ModeloDocumento) !== 55 || Number(p.Numero) !== doc.numero || Number(p.Serie) !== doc.serie ||
      Number(p.TipoAmbiente) !== (doc.ambiente === "producao" ? 1 : 2) || !p.IdentificadorInterno || !p.Emitente?.CpfCnpj) {
    throw new Error("Reserva e payload fiscal divergentes; não foi feito reenvio.");
  }
  return p;
}

export function matchesNfeKey(key: string, doc: PendingNfe) {
  const issuer = String(doc.brasilnfe_request.Emitente.CpfCnpj).replace(/\D/g, "").padStart(14, "0");
  return /^\d{44}$/.test(key) && key.slice(6, 20) === issuer && key.slice(20, 22) === "55" &&
    Number(key.slice(22, 25)) === doc.serie && Number(key.slice(25, 34)) === doc.numero;
}

type Consultation = { kind: "authorized"; nota: any; summary: string } | { kind: "missing" | "uncertain"; summary: string };

export async function consultPendingNfe(doc: PendingNfe, token: string, fetcher: typeof fetch = fetch): Promise<Consultation> {
  const payload = validatePendingPayload(doc);
  const start = new Date(new Date(doc.created_at).getTime() - 86400000).toISOString();
  const end = new Date(Date.now() + 3600000).toISOString();
  const observations: string[] = [];
  // NÃO REMOVER: consulta por identificador + conferência independente do número/série.
  // Uma lista vazia sozinha, HTTP 5xx, resultado truncado ou nota em processamento NÃO liberam emissão.
  for (const filter of [{ IdentificadorInterno: payload.IdentificadorInterno }, { Numero: doc.numero, Serie: doc.serie }]) {
    let r: Response;
    try {
      r = await fetcher(`${BASE}/ObterNotasFiscais`, {
        method: "POST", headers: { "Content-Type": "application/json", Token: token },
        body: JSON.stringify({ TipoAmbiente: Number(payload.TipoAmbiente), TipoDocumentoFiscal: 1, DtInicio: start, DtFim: end, ...filter }),
        signal: AbortSignal.timeout(30000),
      });
    } catch { return { kind: "uncertain", summary: "Consulta ao provedor sem resposta; não foi feito reenvio." }; }
    const text = await r.text();
    if (!r.ok) return { kind: "uncertain", summary: fiscalProviderFailure(r.status, text).summary };
    let data: any;
    try { data = JSON.parse(text); } catch { return { kind: "uncertain", summary: "Consulta retornou conteúdo não JSON; não foi feito reenvio." }; }
    const absence = data.Error === "Não existe notas fiscais para o período informado.";
    if ((!absence && data.Error) || !Array.isArray(data.Notas) || data.Notas.length >= 2000 ||
        (Array.isArray(data.Avisos) ? data.Avisos.length > 0 : !!data.Avisos)) {
      return { kind: "uncertain", summary: `Consulta inconclusiva: ${String(data.Error || "lista incompleta ou avisos").replace(/<[^>]*>/g, " ").slice(0, 180)}. Não foi feito reenvio.` };
    }
    const notes = data.Notas.filter((n: any) => n.IdentificadorInterno === payload.IdentificadorInterno ||
      (Number(n.ModeloDocumento) === 55 && Number(n.Numero) === doc.numero && Number(n.Serie) === doc.serie));
    if (notes.length) {
      if (notes.length !== 1) return { kind: "uncertain", summary: "Consulta encontrou mais de uma referência; não foi feito reenvio." };
      const n = notes[0];
      if (n.IdentificadorInterno !== payload.IdentificadorInterno || !matchesNfeKey(String(n.Chave || ""), doc) ||
          Number(n.Status) !== 1 || !n.NumeroProtocolo) {
        return { kind: "uncertain", summary: `Nota encontrada com status ${String(n.Status)} sem autorização inequívoca da mesma reserva; não foi feito reenvio.` };
      }
      return { kind: "authorized", nota: n, summary: `BrasilNFe confirmou NF-e ${doc.numero}, série ${doc.serie}, autorizada.` };
    }
    if (filter.IdentificadorInterno && !absence) {
      return { kind: "uncertain", summary: "O provedor não confirmou explicitamente a inexistência do identificador; não foi feito reenvio." };
    }
    observations.push(absence ? "identificador inexistente" : "número/série ausentes na consulta do período");
  }
  return { kind: "missing", summary: `BrasilNFe: ${observations.join("; ")}.` };
}

export async function resumePendingNfe(db: any, doc: PendingNfe, token: string, fetcher: typeof fetch = fetch,
  persistFiles?: (db: any, response: any, key: string) => Promise<{ xml_content?: string; danfe_url?: string }>) {
  const payload = validatePendingPayload(doc);
  if (doc.status !== "pending_sefaz") throw new Error("Somente a mesma NF-e pendente pode ser retomada.");
  if (doc.next_retry_at && new Date(doc.next_retry_at).getTime() > Date.now()) {
    return { ok: false, contingencia: true, document_id: doc.id, numero: doc.numero, message: "Consulta/emissão em andamento; aguarde antes de tentar novamente." };
  }
  const stamp = new Date().toISOString();
  // Lease no próprio documento: queda da função não deixa pending irrecuperável.
  let claim = db.from("fiscal_documents").update({ last_retry_at: stamp, retry_count: (doc.retry_count || 0) + 1,
    next_retry_at: new Date(Date.now() + 300000).toISOString() }).eq("id", doc.id).eq("status", "pending_sefaz");
  claim = doc.last_retry_at ? claim.eq("last_retry_at", doc.last_retry_at) : claim.is("last_retry_at", null);
  const { data: locked, error: lockError } = await claim.select("id").maybeSingle();
  if (lockError) throw lockError;
  if (!locked) return { ok: false, contingencia: true, message: "Outra tentativa já está em andamento; nenhum reenvio adicional foi feito." };
  const save = async (patch: Record<string, any>) => {
    const { data, error } = await db.from("fiscal_documents").update(patch).eq("id", doc.id)
      .eq("status", "pending_sefaz").eq("last_retry_at", stamp).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Documento foi atualizado por outra operação; recarregue o status fiscal.");
  };
  try {
    const consultation = await consultPendingNfe(doc, token, fetcher);
    if (consultation.kind === "uncertain") {
      await save({ rejection_message: consultation.summary, contingencia_motivo: consultation.summary, next_retry_at: null });
      return { ok: false, contingencia: true, document_id: doc.id, numero: doc.numero, message: consultation.summary };
    }
    let response: any;
    let recovered = false;
    if (consultation.kind === "authorized") {
      const n = consultation.nota;
      const getFile = async (FileType: number) => {
        const r = await fetcher(`${BASE}/ObterArquivoNotaFiscal`, { method: "POST",
          headers: { "Content-Type": "application/json", Token: token },
          body: JSON.stringify({ ChaveNF: n.Chave, FileType, TipoDocumentoFiscal: 1 }), signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error("Nota já autorizada, mas o provedor não devolveu os arquivos; não foi feito reenvio.");
        const text = await r.text();
        try { const value = JSON.parse(text); return typeof value === "string" ? value : value.Base64File || value.Base64Xml || value.Arquivo; }
        catch { return text.replace(/^"|"$/g, ""); }
      };
      const [Base64Xml, Base64File] = await Promise.all([getFile(1), getFile(2)]);
      response = { ReturnNF: { Ok: true, ChaveNF: n.Chave, NumeroProtocolo: n.NumeroProtocolo, CodStatusRespostaSefaz: 100, Numero: doc.numero, Serie: doc.serie }, Base64Xml, Base64File };
      recovered = true;
    } else {
      // NÃO REMOVER: inexistência comprovada; reenviar o SNAPSHOT, sem rebuild, nova reserva ou loop de duplicidade 539.
      let r: Response;
      try {
        r = await fetcher(`${BASE}/EnviarNotaFiscal`, { method: "POST",
          headers: { "Content-Type": "application/json", Token: token }, body: JSON.stringify(payload), signal: AbortSignal.timeout(45000) });
      } catch {
        const failure = fiscalProviderFailure(0, "", "network");
        await save({ rejection_code: "NETWORK", rejection_message: failure.summary, contingencia_motivo: failure.summary, brasilnfe_response: failure.response, next_retry_at: null });
        return { ok: false, contingencia: true, document_id: doc.id, numero: doc.numero, message: failure.summary };
      }
      const text = await r.text();
      const failure = fiscalProviderFailure(r.status, text);
      if (failure.unavailable) {
        await save({ rejection_code: String(r.status), rejection_message: failure.summary, contingencia_motivo: failure.summary, brasilnfe_response: failure.response, next_retry_at: null });
        return { ok: false, contingencia: true, document_id: doc.id, numero: doc.numero, message: failure.summary };
      }
      try { response = JSON.parse(text); } catch { throw new Error("Resposta fiscal ilegível; consulte novamente antes de reenviar."); }
    }
    const ret = response.ReturnNF || {};
    const protocol = ret.NumeroProtocolo || ret.Protocolo || response.Protocolo;
    if (!ret.Ok || Number(ret.CodStatusRespostaSefaz) !== 100 || !matchesNfeKey(String(ret.ChaveNF || ""), doc) || !protocol ||
        (ret.Numero && Number(ret.Numero) !== doc.numero) || (ret.Serie && Number(ret.Serie) !== doc.serie)) {
      const summary = `Retomada não confirmou autorização: ${String(response.Error || ret.DsStatusRespostaSefaz || "resposta incompleta/divergente").replace(/<[^>]*>/g, " ").slice(0, 200)}. Número ${doc.numero} preservado; consultar antes de tentar novamente.`;
      await save({ rejection_message: summary, contingencia_motivo: summary, next_retry_at: null });
      return { ok: false, contingencia: true, document_id: doc.id, numero: doc.numero, message: summary };
    }
    if (!persistFiles) throw new Error("Persistência fiscal indisponível; consultar antes de reenviar.");
    const files = await persistFiles(db, response, ret.ChaveNF);
    if (!files.xml_content || !files.danfe_url || !files.xml_content.includes(ret.ChaveNF) || !files.xml_content.includes(String(protocol)) ||
        !/<(?:\w+:)?cStat>100<\/(?:\w+:)?cStat>/.test(files.xml_content)) {
      throw new Error("Autorização recebida, mas XML/DANFE não foram confirmados; consultar novamente, sem emissão às cegas.");
    }
    await save({ status: "authorized", chave_acesso: ret.ChaveNF, protocolo: String(protocol), ...files,
      data_autorizacao: consultation.kind === "authorized" ? consultation.nota.DtRecebimento || stamp : stamp,
      rejection_code: null, rejection_message: null, contingencia_motivo: null, next_retry_at: null,
      brasilnfe_response: response });
    return { ok: true, recovered, document_id: doc.id, numero: doc.numero, serie: doc.serie, chave_acesso: ret.ChaveNF,
      protocolo: protocol, danfe_url: files.danfe_url, consultation: consultation.summary };
  } catch (error) {
    const summary = error instanceof Error ? error.message.slice(0, 300) : "Retomada incerta; consultar antes de reenviar.";
    await save({ rejection_message: summary, contingencia_motivo: summary, next_retry_at: null });
    return { ok: false, contingencia: true, document_id: doc.id, numero: doc.numero, message: summary };
  }
}