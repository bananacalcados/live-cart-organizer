import { describe, expect, it } from 'vitest';
import { replyTarget, waitReplyBranches, waitReplyExpiresAt } from '../../supabase/functions/_shared/automation-reply-branches';

describe('Aguardar resposta — caminhos independentes', () => {
  it('resposta dentro do prazo segue somente o caminho de resposta', () => {
    const branches = waitReplyBranches({ buttonBranches: { 'btn-replied': 'respondeu', 'btn-timeout': 'nao-respondeu' } });
    expect(replyTarget(branches, false, 'Olá')).toBe('respondeu');
    expect(replyTarget(branches, true, 'Sim')).toBe('respondeu');
  });
  it('sem resposta segue destino próprio mesmo com cancelamento antigo', () => {
    const branches = waitReplyBranches({ timeoutAction: 'cancel', buttonBranches: { 'btn-timeout': 'sem-resposta' } });
    expect(branches.__timeout__).toBe('sem-resposta');
    expect(branches.__timeout_action__).toBe('continue');
  });
  it('preserva o caminho e a ação antigos', () => {
    const branches = waitReplyBranches({ nextStepId: 'antigo', timeoutAction: 'send_text', timeoutMessage: 'Oi' });
    expect(branches.__replied__).toBe('antigo');
    expect(branches.__timeout_action__).toBe('send_text');
    expect(branches.__timeout_message__).toBe('Oi');
  });
  it('saída desconectada não entra no outro ramo', () => {
    const branches = waitReplyBranches({ buttonBranches: { 'btn-timeout': 'sem-resposta' } });
    expect(replyTarget(branches, false, 'Oi')).toBeNull();
    expect(branches.__reply_stop__).toBe('true');
  });
  it('24 horas e duas horas expiram no instante exato', () => {
    const now = Date.parse('2026-10-17T12:22:00Z');
    expect(waitReplyExpiresAt({ timeoutHours: 24 }, now)).toBe('2026-10-18T12:22:00.000Z');
    expect(waitReplyExpiresAt({ timeoutHours: 2 }, now)).toBe('2026-10-17T14:22:00.000Z');
  });
});
