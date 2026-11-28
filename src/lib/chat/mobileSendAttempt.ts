import type { Message } from '@/components/chat/ChatTypes';

export type AttemptPayload = { text: string; mediaUrl?: string; mediaType?: string; quotedMessageId?: string | null; mode?: 'catalog' | 'template'; template?: { name:string; language:string; components: {type:string;parameters:{type:string;text:string}[]}[] } };
export interface MobileSendAttempt extends AttemptPayload {
  id: string; phone: string; numberId: string | null; senderUserId: string | null;
  startedAt: string; state: 'sending' | 'uncertain' | 'confirmed'; messageId?: string | null; superseded?: boolean;
}
/** Opção A: lock is synchronous; there is deliberately no reconnect/retry method. */
export class MobileSendGate {
  private active = new Set<string>();
  enter(key: string) { if (this.active.has(key)) return false; this.active.add(key); return true; }
  leave(key: string) { this.active.delete(key); }
}
export const mobileConversationKey = (phone: string, numberId?: string | null) => `${phone}__${numberId || 'none'}`;
/** Never infer delivery from text alone: require provider ID, exact target and attributable sender. */
export function matchesProviderEcho(a: MobileSendAttempt, m: Message): boolean {
  if (!m.message_id || m.direction !== 'outgoing' || m.phone !== a.phone || (m.whatsapp_number_id || null) !== a.numberId) return false;
  if (a.messageId) return m.message_id === a.messageId;
  if (!a.senderUserId || m.sender_user_id !== a.senderUserId) return false;
  const delta = Date.parse(m.created_at) - Date.parse(a.startedAt);
  return delta >= -2000 && delta <= 15000 && m.message === a.text && (m.media_url || '') === (a.mediaUrl || '') && (m.media_type || '') === (a.mediaType || '');
}
export function reconcileMobileAttempts(attempts: MobileSendAttempt[], messages: Message[]): MobileSendAttempt[] {
  let changed = false;
  const next = attempts.map((a) => {
    if (a.state === 'confirmed') return a;
    const candidates = messages.filter((m) => matchesProviderEcho(a, m));
    // Identical nearby attempts/echoes are ambiguous: retain the warning.
    if (candidates.length !== 1 || attempts.filter((other) => matchesProviderEcho(other, candidates[0])).length !== 1) return a;
    changed = true; return { ...a, state: 'confirmed' as const, messageId: candidates[0].message_id };
  });
  return changed ? next : attempts;
}
