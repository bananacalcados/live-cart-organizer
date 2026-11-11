/**
 * Vínculo de cópias da mesma mensagem entre campanhas de Grupos VIP (sync_key).
 * A chave é `<uuid da mensagem>:<posição do bloco>` e não depende do texto.
 * O casamento automático (backfill) espelha a migração: mesmo lote, mesma sequência de
 * blocos (tipo + texto normalizado), ao menos um bloco com texto, campanhas diferentes e
 * no máximo uma ocorrência por campanha.
 */
import { normalizeMessageText } from './mirrorGroupMedia';

export interface SyncBlockRow {
  id: string;
  campaign_id: string;
  draft_batch: string | null;
  message_group_id: string | null;
  block_order: number | null;
  message_type: string;
  message_content: string | null;
}

export function buildSyncKey(messageUuid: string, blockOrder: number | null | undefined): string {
  return `${messageUuid}:${blockOrder ?? 0}`;
}

/** Devolve grupos de chaves de mensagem (message_group_id ou id) que devem ser vinculados. */
export function matchSyncGroups(rows: SyncBlockRow[]): string[][] {
  const msgs = new Map<string, { campaign: string; batch: string; blocks: SyncBlockRow[] }>();
  for (const r of rows) {
    if (!r.draft_batch) continue;
    const mk = r.message_group_id || r.id;
    const m = msgs.get(mk) || { campaign: r.campaign_id, batch: r.draft_batch, blocks: [] };
    m.blocks.push(r);
    msgs.set(mk, m);
  }
  const bySig = new Map<string, { mk: string; campaign: string }[]>();
  for (const [mk, m] of msgs) {
    const blocks = [...m.blocks].sort((a, b) => (a.block_order ?? 0) - (b.block_order ?? 0));
    if (!blocks.some(b => normalizeMessageText(b.message_content))) continue;
    const sig = m.batch + '##' + blocks.map(b => `${b.message_type}::${normalizeMessageText(b.message_content)}`).join('||');
    const list = bySig.get(sig) || [];
    list.push({ mk, campaign: m.campaign });
    bySig.set(sig, list);
  }
  const out: string[][] = [];
  for (const list of bySig.values()) {
    const camps = new Set(list.map(l => l.campaign));
    if (camps.size >= 2 && camps.size === list.length) out.push(list.map(l => l.mk));
  }
  return out;
}

export interface SyncSibling {
  anchor_id: string;
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  scheduled_at: string | null;
  reason: string | null;
  content_differs: boolean;
}

/** Cópia aprovável vem marcada; "conteúdo diferente" vem desmarcada; bloqueada não tem caixa. */
export function defaultSiblingChecked(s: SyncSibling): boolean {
  return !s.reason && !s.content_differs;
}

export interface SyncApproveRow { anchor_id: string; id: string; campaign_id: string; ok: boolean; reason: string }

export function summarizeByCampaign(rows: SyncApproveRow[]): Map<string, { ok: number; past: number; blocked: string[] }> {
  const out = new Map<string, { ok: number; past: number; blocked: string[] }>();
  for (const r of rows) {
    const s = out.get(r.campaign_id) || { ok: 0, past: 0, blocked: [] };
    if (r.ok) { s.ok++; if (r.reason === 'past_schedule') s.past++; } else s.blocked.push(r.reason);
    out.set(r.campaign_id, s);
  }
  return out;
}
