import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MobileWhatsappComposer } from './MobileWhatsappComposer';
import type { AttemptPayload } from '@/lib/chat/mobileSendAttempt';
vi.mock('@/components/MediaAttachmentPicker', () => ({ uploadMediaToStorage: vi.fn(async () => 'https://example.test/audio') }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('prévia antes do envio', () => {
  it('galeria aceita vídeo e usa o mesmo envio de mídia após confirmação', async () => {
    const send = vi.fn(async (_payload: AttemptPayload) => true);
    URL.createObjectURL = vi.fn(() => 'blob:gallery'); URL.revokeObjectURL = vi.fn();
    render(<MobileWhatsappComposer disabled={false} quoted={null} cancelQuote={() => {}} send={send} openCatalog={() => {}} openReplies={() => {}} />);
    fireEvent.change(screen.getByLabelText('Fotos e vídeos da galeria'), { target: { files: [new File(['video'], 'gallery.mp4', { type: 'video/mp4' })] } });
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Enviar mensagem'));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toMatchObject({ mediaType: 'video' });
  });
  it('vídeo da câmera só envia após confirmar e permanece no tipo vídeo', async () => {
    const send = vi.fn(async (_payload: AttemptPayload) => true);
    URL.createObjectURL = vi.fn(() => 'blob:video'); URL.revokeObjectURL = vi.fn();
    render(<MobileWhatsappComposer disabled={false} quoted={null} cancelQuote={() => {}} send={send} openCatalog={() => {}} openReplies={() => {}} />);
    fireEvent.change(screen.getByLabelText('Vídeo da câmera'), { target: { files: [new File(['video'], 'camera.mp4', { type: 'video/mp4' })] } });
    expect(screen.getByLabelText('Prévia do vídeo')).toBeTruthy(); expect(send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Legenda opcional' } });
    fireEvent.click(screen.getByLabelText('Enviar mensagem'));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toMatchObject({ mediaType: 'video', text: 'Legenda opcional' });
  });
  it('parar gravação não envia; só o toque posterior despacha', async () => {
    const send = vi.fn(async (_payload: AttemptPayload) => true);
    const track = { stop: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
    vi.stubGlobal('MediaRecorder', class {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType = 'audio/webm';
      ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
    });
    URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn();
    render(<MobileWhatsappComposer disabled={false} quoted={null} cancelQuote={() => {}} send={send} openCatalog={() => {}} openReplies={() => {}} />);
    fireEvent.click(screen.getByLabelText('Gravar áudio'));
    await waitFor(() => expect(screen.getByLabelText('Parar e ouvir áudio')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Parar e ouvir áudio'));
    expect(screen.getByLabelText('Prévia do áudio')).toBeTruthy(); expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Enviar mensagem'));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toMatchObject({ mediaType: 'audio' });
  });
});