import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamChat } from '@/components/TeamChat';
import { POSTeamChat } from '@/components/pos/POSTeamChat';

const { profileFilters, writes, getUser } = vi.hoisted(() => ({ profileFilters: vi.fn(), writes: vi.fn(), getUser: vi.fn() }));
const uid = '11111111-1111-4111-8111-111111111111';
let profile: { display_name: string } | null = null;
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser },
  from: (table: string) => {
    const q: any = {};
    for (const method of ['select', 'order', 'limit', 'in', 'gte']) q[method] = () => q;
    q.eq = (column: string, value: unknown) => { if (table === 'user_profiles') profileFilters(column, value); return q; };
    q.maybeSingle = async () => ({ data: table === 'user_profiles' ? profile : null, error: null });
    q.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
    q.insert = q.update = q.delete = writes;
    return q;
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: vi.fn(),
} }));
vi.mock('@/components/exchange-desk/SupportGuardBanner', () => ({ SupportGuardBanner: () => null }));
beforeEach(() => { vi.clearAllMocks(); profile = null; getUser.mockResolvedValue({ data: { user: { id: uid, email: 'teste@example.test', user_metadata: {} } } }); });
afterEach(cleanup);
describe('identidade da equipe não consulta e-mail em coluna UUID', () => {
  it.each([TeamChat, POSTeamChat])('%s sem perfil usa sessão, sem consulta inválida ou regravação', async Component => {
    render(<MemoryRouter initialEntries={['/dashboard']}><Component storeId="store" /></MemoryRouter>);
    await waitFor(() => expect(profileFilters).toHaveBeenCalledWith('user_id', uid));
    await waitFor(() => expect(getUser).toHaveBeenCalledTimes(1));
    expect(profileFilters.mock.calls).toEqual([['user_id', uid]]);
    expect(writes).not.toHaveBeenCalled();
  });
  it.each([TeamChat, POSTeamChat])('%s mantém perfil existente pelo UUID sem regravar', async Component => {
    profile = { display_name: 'Equipe Teste' };
    render(<MemoryRouter initialEntries={['/dashboard']}><Component storeId="store" /></MemoryRouter>);
    await waitFor(() => expect(profileFilters).toHaveBeenCalledWith('user_id', uid));
    expect(profileFilters.mock.calls).toEqual([['user_id', uid]]);
    expect(writes).not.toHaveBeenCalled();
  });
});