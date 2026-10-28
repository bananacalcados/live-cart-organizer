import { describe, expect, it } from 'vitest';
import { applyManualVip } from '@/lib/groupVip';

describe('Marcação manual de grupos VIP', () => {
  const rows = [
    { id: 'perola', group_jid_base: '120363123', is_vip: false },
    { id: 'carol', group_jid_base: '120363123', is_vip: false },
    { id: 'centro', group_jid_base: '120363456', is_vip: false },
  ];
  it('marca todas as instâncias do mesmo grupo e nenhuma de outro grupo', () => {
    expect(applyManualVip(rows, '120363123', true).map(r => r.is_vip)).toEqual([true, true, false]);
  });
  it('desmarca todas as instâncias sem remover ou unificar linhas', () => {
    const result = applyManualVip(applyManualVip(rows, '120363123', true), '120363123', false);
    expect(result).toEqual(rows);
    expect(result.map(r => r.id)).toEqual(['perola', 'carol', 'centro']);
  });
});