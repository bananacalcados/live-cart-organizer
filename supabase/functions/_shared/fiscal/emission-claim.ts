export type FiscalEmissionClaim = {
  out_document_id: string;
  out_numero: number | string | null;
  out_status: string;
  out_claimed: boolean;
  out_chave_acesso: string | null;
  out_protocolo: string | null;
  out_danfe_url: string | null;
};

export function getFiscalEmissionClaim(data: unknown): FiscalEmissionClaim {
  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim || typeof claim !== "object" || !(claim as FiscalEmissionClaim).out_document_id) {
    throw new Error("Não foi possível reservar a emissão fiscal");
  }
  return claim as FiscalEmissionClaim;
}

export function applyReservedFiscalNumber<T extends Record<string, unknown>>(
  payload: T,
  claim: FiscalEmissionClaim,
  serie = 1,
): T & { Numero: number; Serie: number } {
  if (!claim.out_claimed) throw new Error("Emissão reutilizada não pode ser reenviada ao provedor");
  const numero = Number(claim.out_numero);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error("Número fiscal reservado inválido");
  }
  return { ...payload, Numero: numero, Serie: serie };
}

export function fiscalEmissionReuseBody(claim: FiscalEmissionClaim) {
  const authorized = claim.out_status === "authorized";
  return {
    ok: true,
    reused: true,
    document_id: claim.out_document_id,
    numero: claim.out_numero,
    chave_acesso: claim.out_chave_acesso,
    protocolo: claim.out_protocolo,
    danfe_url: claim.out_danfe_url,
    contingencia: claim.out_status === "pending_sefaz",
    message: authorized
      ? "Nota já autorizada; reutilizando o documento existente"
      : "Emissão já está em andamento; nenhuma nota duplicada foi enviada",
  };
}
