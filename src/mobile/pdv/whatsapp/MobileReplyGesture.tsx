import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';

export function MobileReplyGesture({ onReply, text, canReply, out, children }: { onReply: () => void; text: string; canReply: boolean; out: boolean; children: ReactNode }) {
  const start = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const movement = useRef(0), fired = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [dx, setDx] = useState(0), [menu, setMenu] = useState(false);
  const reset = () => { clearTimeout(timer.current); start.current = null; movement.current = 0; setDx(0); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const reply = () => { if (canReply) onReply(); else toast.info('Essa mensagem não tem referência para responder no WhatsApp.'); };
  return <>
    <div tabIndex={0} role="group" aria-label="Ações da mensagem" className={`m-wa-gesture relative flex ${out ? 'justify-end' : 'justify-start'}`}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
      onPointerDown={e => {
        if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if ((e.target as HTMLElement).closest('button,a,input,audio,video')) return;
        reset(); fired.current = false; start.current = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        timer.current = setTimeout(() => { fired.current = true; setMenu(true); navigator.vibrate?.(25); }, 500);
      }}
      onPointerMove={e => {
        const s = start.current; if (!s || s.pointer !== e.pointerId || fired.current) return;
        const x = e.clientX - s.x, y = Math.abs(e.clientY - s.y);
        if (Math.abs(x) > 8 || y > 8) clearTimeout(timer.current);
        if (y > 30) { reset(); return; }
        movement.current = Math.max(0, Math.min(x, 80)); setDx(movement.current);
      }}
      onPointerUp={e => { const shouldReply = !!start.current && movement.current >= 60 && !fired.current; reset(); if (shouldReply) reply(); if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={reset} onLostPointerCapture={reset}
      onContextMenu={e => { if ((e.target as HTMLElement).closest('button,a,input,audio,video')) return; e.preventDefault(); clearTimeout(timer.current); fired.current = true; setMenu(true); }}
      onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMenu(true); } }}>
      {dx > 20 && <Reply className="absolute left-0 top-1/2 h-6 w-6 -translate-x-7 -translate-y-1/2 text-[var(--wa-icon)]" />}
      {children}
    </div>
    <Sheet open={menu} onOpenChange={setMenu}><SheetContent side="bottom" aria-describedby={undefined}><SheetHeader><SheetTitle>Mensagem</SheetTitle></SheetHeader>
      <Button variant="ghost" className="mt-3 min-h-12 w-full justify-start" disabled={!canReply} onClick={() => { setMenu(false); reply(); }}><Reply className="h-6 w-6" />Responder</Button>
      <Button variant="ghost" className="min-h-12 w-full justify-start" disabled={!text} onClick={() => { setMenu(false); void navigator.clipboard.writeText(text).then(() => toast.success('Mensagem copiada.'), () => toast.error('Não consegui copiar a mensagem.')); }}><Copy className="h-6 w-6" />Copiar</Button>
    </SheetContent></Sheet>
  </>;
}