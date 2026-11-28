import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileConversation } from '@/lib/chat/mobileWhatsappReads';
const mock = vi.hoisted(() => ({ responses: [] as unknown[], eq: vi.fn(), page: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mock.from } }));
vi.mock('./directReads', () => ({ fetchMobileMessagePage: mock.page }));
import { readQuotedHistory } from './quotedHistory';
const target = { phone: '5533999990000', whatsapp_number_id: 'number-1', channel: 'whatsapp' } as MobileConversation;
beforeEach(() => {
  vi.clearAllMocks(); mock.responses = []; mock.page.mockResolvedValue([]);
  mock.from.mockImplementation(() => {
    const q = { select: () => q, eq: (...args: unknown[]) => { mock.eq(...args); return q; }, is: () => q, or: () => q, limit: () => q, maybeSingle: async () => ({ data: mock.responses.shift() ?? null, error: null }) };
    return q;
  });
});
describe('mensagem citada é resolvida só na conversa alvo', () => {
  it('procura o ID do provedor no arquivo e carrega apenas duas páginas de contexto', async () => {
    const original = { id: 'db-original', phone: target.phone, message_id: 'provider-original', created_at: '2026-07-01T12:00:00Z', direction: 'incoming', message: 'Original' };
    mock.responses = [null, original];
    const result = await readQuotedHistory(target, 'provider-original');
    expect(result?.originalId).toBe('db-original');
    expect(mock.eq).toHaveBeenCalledWith('phone', target.phone);
    expect(mock.eq).toHaveBeenCalledWith('whatsapp_number_id', 'number-1');
    expect(mock.eq).toHaveBeenCalledWith('message_id', 'provider-original');
    expect(mock.page).toHaveBeenCalledTimes(2);
    expect(mock.page).toHaveBeenCalledWith(target, true, original);
  });
  it('não inventa mensagem quando ela não existe mais', async () => {
    expect(await readQuotedHistory(target, 'deleted')).toBeNull(); expect(mock.page).not.toHaveBeenCalled();
    expect(mock.from).toHaveBeenCalledTimes(2);
  });
});