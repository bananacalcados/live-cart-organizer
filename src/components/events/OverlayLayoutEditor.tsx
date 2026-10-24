import { PointerEvent, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoveDiagonal2 } from "lucide-react";
import { fill, normalizeOverlayPosition, OverlayBlockKey, OverlayConfig, OverlayLayout } from "@/lib/liveOverlay";
import { OverlayBlock } from "./OverlayBlock";

const names: Record<OverlayBlockKey, string> = { ticker: "Faixa", raffle_bar: "Sorteio", alert: "Aviso", cta: "Chamada", wheel: "Roleta", timers: "Relógios" };
const keys = Object.keys(names) as OverlayBlockKey[];

export function OverlayLayoutEditor({ config, onChange, onSave }: { config: OverlayConfig; onChange: (layout: OverlayLayout) => void; onSave: (layout: OverlayLayout) => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(config.layout);
  layoutRef.current = config.layout;
  const gesture = useRef<{ key: OverlayBlockKey; mode: "move" | "width"; x: number; y: number; scale: number; initial: OverlayLayout; pointer: number } | null>(null);
  const start = (event: PointerEvent<HTMLElement>, key: OverlayBlockKey, mode: "move" | "width") => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { key, mode, x: event.clientX, y: event.clientY, scale: bounds.width / 1080, initial: layoutRef.current, pointer: event.pointerId };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointer) return;
    const p = g.initial[g.key];
    const dx = (event.clientX - g.x) / g.scale;
    const dy = (event.clientY - g.y) / g.scale;
    const next = { ...g.initial, [g.key]: normalizeOverlayPosition(g.mode === "move" ? { ...p, x: p.x + dx, y: p.y + dy } : { ...p, width: Math.min(1080 - p.x, p.width + dx) }) };
    layoutRef.current = next; onChange(next);
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (!gesture.current || event.pointerId !== gesture.current.pointer) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onSave(layoutRef.current);
  };
  const setFont = (key: OverlayBlockKey, size: number) => { const layout = { ...layoutRef.current, [key]: normalizeOverlayPosition({ ...layoutRef.current[key], font_size: size }) }; layoutRef.current = layout; onChange(layout); onSave(layout); };
  const texts: Record<OverlayBlockKey, string> = {
    ticker: config.ticker.items.find((i) => i.enabled)?.text || "🚚 Frete fixo R$ 19,99",
    raffle_bar: fill(config.raffle_bar.text_template, { count: 25 }),
    alert: fill(config.paid_alert.template, { handle: "cliente", product: "Tenis Feminino New Balance 530" }),
    cta: config.cta.items.find((i) => i.enabled)?.text || "Comente VIP e receba o link no direct",
    wheel: `${fill(config.wheel.title_template, { handle: "cliente" })} · 🎉 Bolsa`,
    timers: fill(config.payment_timers.template, { handle: "cliente", timer: "19:42", product: "Tenis 530", size: "36" }),
  };
  return <div className="space-y-3">
    <div data-testid="overlay-editor" className="relative overflow-hidden bg-muted-foreground/40" style={{ width: 324, height: 576 }}>
      <div ref={canvasRef} className="absolute origin-top-left overflow-hidden" style={{ width: 1080, height: 1920, transform: "scale(0.3)" }}>
        <div className="overlay-guide absolute inset-x-0 top-0 flex items-center justify-center text-foreground" style={{ height: 180, fontSize: 34 }}>Perfil do Instagram</div>
        <div className="overlay-guide absolute inset-x-0 bottom-0 flex items-end justify-center pb-10 text-foreground" style={{ height: 420, fontSize: 34 }}>Comentários do Instagram</div>
        {keys.map((key) => <OverlayBlock key={key} position={config.layout[key]} blockKey={key}>
          <div aria-label={`Arrastar ${names[key]}`} role="group" className="relative cursor-move touch-none select-none border-4 border-dashed border-primary overlay-panel font-bold" onPointerDown={(e) => start(e, key, "move")} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
            {texts[key]}
            <Button aria-label={`Largura ${names[key]}`} title={`Largura ${names[key]}`} variant="secondary" size="icon" className="absolute bottom-0 right-0 h-16 w-16 cursor-ew-resize touch-none" onPointerDown={(e) => start(e, key, "width")} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}><MoveDiagonal2 className="h-10 w-10" /></Button>
          </div>
        </OverlayBlock>)}
      </div>
    </div>
    {keys.map((key) => <div key={key} className="flex items-center justify-between gap-2">
      <Label htmlFor={`font-${key}`}>{names[key]} · fonte</Label>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" aria-label={`Diminuir ${names[key]}`} onClick={() => setFont(key, config.layout[key].font_size - 4)}>A−</Button>
        <Input id={`font-${key}`} type="number" min={16} max={160} className="w-20" value={config.layout[key].font_size} onChange={(e) => setFont(key, Number(e.target.value))} />
        <Button type="button" variant="outline" size="sm" aria-label={`Aumentar ${names[key]}`} onClick={() => setFont(key, config.layout[key].font_size + 4)}>A+</Button>
      </div>
    </div>)}
  </div>;
}