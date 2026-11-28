import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MobileReplyGesture } from './MobileReplyGesture';
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId = 1; pointerType = 'touch'; isPrimary = true;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const setup = () => {
  const reply = vi.fn(); render(<MobileReplyGesture onReply={reply} canReply text="Mensagem" out={false}><article>Texto recebido</article></MobileReplyGesture>);
  return { reply, el: screen.getByLabelText('Ações da mensagem') };
};
describe('resposta no Android Chrome', () => {
  it('arrastar horizontal responde uma única vez', () => {
    const { reply, el } = setup();
    fireEvent.pointerDown(el, { clientX: 10, clientY: 50 }); fireEvent.pointerMove(el, { clientX: 85, clientY: 52 }); fireEvent.pointerUp(el);
    expect(reply).toHaveBeenCalledTimes(1);
  });
  it('gesto cancelado não responde', () => {
    const { reply, el } = setup();
    fireEvent.pointerDown(el, { clientX: 10, clientY: 50 }); fireEvent.pointerMove(el, { clientX: 85, clientY: 52 }); fireEvent.pointerCancel(el); fireEvent.pointerUp(el);
    expect(reply).not.toHaveBeenCalled();
  });
  it('toque longo abre menu e só Responder seleciona a mensagem', () => {
    const { reply, el } = setup(); fireEvent.pointerDown(el, { clientX: 10, clientY: 50 });
    act(() => vi.advanceTimersByTime(550)); fireEvent.pointerUp(el);
    expect(reply).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    expect(reply).toHaveBeenCalledTimes(1);
  });
});