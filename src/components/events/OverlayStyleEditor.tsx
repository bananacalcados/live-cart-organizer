import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_OVERLAY_STYLES, type OverlayBlockKey, type OverlayBlockStyle, type OverlayConfig, type OverlayStyles } from "@/lib/liveOverlay";
import { OverlayPanel } from "./OverlayPanel";

const names: Record<OverlayBlockKey, string> = { ticker: "Faixa de informações", raffle_bar: "Barra do sorteio", alert: "Avisos de compra/pedido", cta: "Chamada para ação", wheel: "Roleta", timers: "Relógios de pagamento", shown_product: "Produto em exibição" };
const keys = Object.keys(names) as OverlayBlockKey[];
const samples: Record<OverlayBlockKey, string> = {
  ticker: "🚚 Frete fixo R$ 19,99",
  raffle_bar: "🎁 25 clientes já concorrem ao sorteio!",
  alert: "🎉 @cliente garantiu o tênis!",
  cta: "Comente VIP e receba o link no direct",
  wheel: "🎰 Roleta de @cliente · 🎉 Bolsa",
  timers: "✅ @cliente · ⏳ 19:42 para pagar",
  shown_product: "T101 · Tênis exemplo",
};
const green: OverlayBlockStyle = { bg_color: "#16a34a", bg_opacity: 0.95, text_color: "#ffffff", font_weight: 900 };
const yellow: OverlayBlockStyle = { bg_color: "#facc15", bg_opacity: 0.95, text_color: "#111111", font_weight: 900 };

export function OverlayStyleEditor({ config, onChange }: { config: OverlayConfig; onChange: (styles: OverlayStyles) => void }) {
  const setStyle = (key: OverlayBlockKey, style: OverlayBlockStyle) => onChange({ ...config.styles, [key]: style });
  const patchStyle = (key: OverlayBlockKey, patch: Partial<OverlayBlockStyle>) => setStyle(key, { ...config.styles[key], ...patch });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cores e destaque dos blocos</CardTitle>
        <p className="text-sm text-muted-foreground">Escolha o estilo e clique em Aplicar. O OBS recebe a mudança sem recarregar.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {keys.map((key) => {
          const style = config.styles[key];
          return (
            <details key={key} className="rounded-md border p-3" open={key === "ticker"}>
              <summary className="cursor-pointer font-medium">{names[key]}</summary>
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setStyle(key, green)}>Verde destaque</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setStyle(key, yellow)}>Amarelo</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setStyle(key, DEFAULT_OVERLAY_STYLES[key])}>Padrão</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`overlay-bg-${key}`}>Cor de fundo</Label>
                    <Input id={`overlay-bg-${key}`} type="color" className="h-10 w-full cursor-pointer p-1" value={style.bg_color} onChange={(event) => patchStyle(key, { bg_color: event.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`overlay-text-${key}`}>Cor do texto</Label>
                    <Input id={`overlay-text-${key}`} type="color" className="h-10 w-full cursor-pointer p-1" value={style.text_color} onChange={(event) => patchStyle(key, { text_color: event.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><Label htmlFor={`overlay-opacity-${key}`}>Opacidade do fundo</Label><span className="text-sm text-muted-foreground">{Math.round(style.bg_opacity * 100)}%</span></div>
                  <input id={`overlay-opacity-${key}`} aria-label={`Opacidade de ${names[key]}`} type="range" min="0" max="1" step="0.05" className="w-full accent-primary" value={style.bg_opacity} onChange={(event) => patchStyle(key, { bg_opacity: Number(event.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`overlay-weight-${key}`}>Peso da fonte</Label>
                  <select id={`overlay-weight-${key}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={style.font_weight} onChange={(event) => patchStyle(key, { font_weight: Number(event.target.value) as OverlayBlockStyle["font_weight"] })}>
                    <option value={400}>Normal (400)</option><option value={600}>Seminegrito (600)</option><option value={700}>Negrito (700)</option><option value={800}>Extranegrito (800)</option><option value={900}>Máximo (900)</option>
                  </select>
                </div>
                <OverlayPanel blockKey={key} styles={config.styles} className="text-center text-lg" aria-label={`Prévia de ${names[key]}`}>
                  {samples[key]}
                </OverlayPanel>
              </div>
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}
