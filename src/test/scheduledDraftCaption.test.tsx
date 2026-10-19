import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledMessageForm } from '@/components/marketing/ScheduledMessageForm';
const { upload, fetchProducts } = vi.hoisted(() => ({ upload: vi.fn(), fetchProducts: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => ({ select: () => ({ order: async () => ({ data: [] }) }) }),
  storage: { from: () => ({ upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/${path}` } }) }) },
} }));
vi.mock('@/lib/shopify', () => ({ fetchProducts }));
vi.mock('@/lib/imageOrientation', () => ({ normalizeImageOrientation: async (f: File) => f }));
vi.mock('@/components/EmojiPickerButton', () => ({ EmojiPickerButton: () => null }));
vi.mock('@/components/marketing/VipLinkControls', async () => {
  const actual = await vi.importActual<typeof import('@/components/marketing/VipLinkControls')>('@/components/marketing/VipLinkControls');
  return { ...actual, VipDayLock: () => null };
});
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const caption = '*SANDÁLIA LÍVIA*\nDe ~R$199,99~ por *R$119,99*\n{{link_atendimento}}';
function setup(type = 'image', text = caption, status = 'draft') {
  const save = vi.fn().mockResolvedValue(undefined);
  const result = render(<ScheduledMessageForm open onOpenChange={vi.fn()} onSubmit={vi.fn()}
    onUpdate={save} editingMessage={{ id: 'test', message_type: type, message_content: text,
      media_url: null, poll_options: null, scheduled_at: '2099-01-01T12:00:00Z', send_speed: 'slow', vip_link_mode: 'general', status }} />);
  return { ...result, save };
}
beforeEach(() => { vi.clearAllMocks(); upload.mockResolvedValue({ error: null }); });
afterEach(cleanup);
describe('editor de legendas VIP', () => {
  it.each(['image', 'video', 'document'])('salva %s sem arquivo como rascunho', async type => {
    const { save } = setup(type);
    fireEvent.click(screen.getByRole('button', { name: /^Salvar$/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1].blocks[0]).toMatchObject({ content: caption, mediaItems: [] });
  });
  it('upload múltiplo salva a legenda somente no primeiro arquivo', async () => {
    const { save } = setup();
    const input = document.querySelector('input[type=file]');
    if (!input) throw new Error('Upload ausente');
    fireEvent.change(input, { target: { files: [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getAllByPlaceholderText('Legenda...')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /^Salvar$/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1].blocks[0].mediaItems.map((i: { caption: string }) => i.caption)).toEqual([caption, '']);
  });
  it('URL e remoção do último arquivo mantêm a legenda', () => {
    setup();
    const input = screen.getByPlaceholderText('Ou cole URL...');
    fireEvent.change(input, { target: { value: 'https://example.test/photo.jpg' } });
    const button = input.parentElement?.querySelector('button');
    if (!button) throw new Error('Adicionar URL ausente');
    fireEvent.click(button);
    expect(screen.getByPlaceholderText('Legenda...')).toHaveValue(caption);
    fireEvent.click(screen.getByRole('button', { name: 'Remover arquivo 1' }));
    expect(screen.getByLabelText('Legenda (vai junto com a foto)')).toHaveValue(caption);
  });
  it('insere marcador antes da foto sem duplicar', () => {
    setup('image', 'Oferta');
    const button = screen.getByRole('button', { name: 'Inserir {{link_atendimento}} no texto' });
    fireEvent.click(button); fireEvent.click(button);
    expect(screen.getByLabelText('Legenda (vai junto com a foto)')).toHaveValue('Oferta\n{{link_atendimento}}');
  });
  it('Shopify transfere a legenda pronta', async () => {
    fetchProducts.mockResolvedValue([{ node: { id: 'prod', title: 'Sandália', handle: 'sandalia',
      priceRange: { minVariantPrice: { amount: '119.99' } }, images: { edges: [{ node: { url: 'https://example.test/photo.jpg' } }] } } }]);
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^Shopify$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Usar Foto' }));
    expect(screen.getByPlaceholderText('Legenda...')).toHaveValue(caption);
  });
  it('mensagem pendente continua exigindo arquivo', () => {
    const { save } = setup('image', caption, 'pending');
    fireEvent.click(screen.getByRole('button', { name: /^Salvar$/ }));
    expect(save).not.toHaveBeenCalled();
  });
});