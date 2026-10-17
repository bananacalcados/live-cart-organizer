import { describe, expect, it } from 'vitest';
import { replyTarget, waitReplyBranches, waitReplyExpiresAt, continuationIndices } from '../../supabase/functions/_shared/automation-reply-branches';

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
    const branches = waitReplyBranches({ buttonBranches: { 'btn-timeout': 'sem-resposta' } }, 'outro-ramo');
    expect(replyTarget(branches, false, 'Oi')).toBeNull();
    expect(branches.__reply_stop__).toBe('true');
  });
  it('24 horas e duas horas expiram no instante exato', () => {
    const now = Date.parse('2026-10-17T12:22:00Z');
    expect(waitReplyExpiresAt({ timeoutHours: 24 }, now)).toBe('2026-10-18T12:22:00.000Z');
    expect(waitReplyExpiresAt({ timeoutHours: 2 }, now)).toBe('2026-10-17T14:22:00.000Z');
  });
});

describe('sequências por ramo', () => {
  const steps = [
    { id: 'espera', action_config: { buttonBranches: { 'btn-replied': 'sim', 'btn-timeout': 'nao' } } },
    { id: 'sim', action_config: { nextStepId: 'sim-final' } },
    { id: 'nao', action_config: { nextStepId: 'nao-final' } },
    { id: 'sim-final', action_config: {} },
    { id: 'nao-final', action_config: {} },
  ];
  it('resposta percorre somente suas ações, mesmo fora da ordem da lista', () => {
    expect(continuationIndices(steps, 1)).toEqual([1, 3]);
  });
  it('timeout percorre somente suas ações', () => {
    expect(continuationIndices(steps, 2)).toEqual([2, 4]);
  });
  it('fluxos antigos sem ligações preservam a sequência anterior', () => {
    expect(continuationIndices([{ id: 'a', action_config: {} }, { id: 'b', action_config: {} }], 0)).toBeNull();
  });
});

import { engagementTarget } from "../../supabase/functions/_shared/automation-reply-branches";
describe("engajamento na espera", () => {
  const b = waitReplyBranches({ buttonBranches: { "btn-replied": "r", "btn-clicked": "c", "btn-timeout": "t" } });
  it("clique segue o ramo clicou", () => expect(engagementTarget(b, "clicked")).toEqual({ consume: true, target: "c" }));
  it("reação sem ramo não encerra a espera", () => expect(engagementTarget(b, "reacted")).toEqual({ consume: false, target: null }));
  it("resposta segue o ramo respondeu", () => expect(engagementTarget(b, "replied").target).toBe("r"));
});
