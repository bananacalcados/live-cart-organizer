/**
 * Espelhamento de mídia entre campanhas de grupos VIP:
 * encontra, em outras campanhas, mensagens ainda não enviadas com texto idêntico
 * às que acabaram de receber mídia, para oferecer aplicar a mesma mídia nelas.
 * Nunca casa mensagens sem texto (conteúdo vazio normalizado) — segurança contra
 * aplicar imagem em mensagem diferente.
 */

export interface MediaRowSig {
  message_type: string;
  message_content: string | null;
  media_url: string | null;
}

export interface MirrorCandidateRow extends MediaRowSig {
  id: string;
  campaign_id: string;
}

export interface MirrorUpdate {
  id: string;
  campaign_id: string;
  newMediaUrl: string;
}

export function normalizeMessageText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function signatureOf(row: MediaRowSig): string | null {
  const text = normalizeMessageText(row.message_content);
  if (!text) return null;
  return `${row.message_type}::${text}`;
}

/**
 * Dado os blocos de mídia recém-salvos (com a URL nova) e as linhas candidatas
 * de outras campanhas, devolve as linhas que devem receber a mesma mídia.
 * Só casa mesmo tipo de mídia + texto idêntico (ignorando espaços e maiúsculas),
 * e pula quem já tem exatamente a mesma URL.
 */
export function findMirrorUpdates(edited: MediaRowSig[], candidates: MirrorCandidateRow[]): MirrorUpdate[] {
  const newUrlBySig = new Map<string, string>();
  for (const row of edited) {
    if (!row.media_url) continue;
    const sig = signatureOf(row);
    if (sig) newUrlBySig.set(sig, row.media_url);
  }
  if (newUrlBySig.size === 0) return [];
  const updates: MirrorUpdate[] = [];
  for (const candidate of candidates) {
    const sig = signatureOf(candidate);
    if (!sig) continue;
    const newUrl = newUrlBySig.get(sig);
    if (newUrl && newUrl !== candidate.media_url) {
      updates.push({ id: candidate.id, campaign_id: candidate.campaign_id, newMediaUrl: newUrl });
    }
  }
  return updates;
}
