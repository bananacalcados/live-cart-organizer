import { Gift, Timer } from "lucide-react";
import { formatMmSs } from "@/lib/liveModes";

interface Props {
  name: string;
  image: string | null;
  left: number;
  active: boolean;
  description: string;
}

export function SelfServicePrizeBanner({ name, image, left, active, description }: Props) {
  const [minutes, seconds] = formatMmSs(left).split(":");
  return (
    <section aria-label={`Sorteio: ${name}`} className="selfservice-prize overflow-hidden rounded-lg border-2 border-primary bg-card">
      <div className="flex items-center gap-2 bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
        <Gift className="h-5 w-5 shrink-0" /> CONCORRA AO PRÊMIO DA LIVE
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-4">
          {image ? <img src={image} alt={name} className="h-28 w-28 shrink-0 rounded-md bg-background object-contain" /> : <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-primary/15"><Gift className="h-16 w-16 text-foreground" /></div>}
          <h2 className="min-w-0 break-words text-xl font-extrabold leading-tight">{name}</h2>
        </div>
        {active && <div className="space-y-2 text-center">
          <p className="flex items-center justify-center gap-2 text-sm font-semibold"><Timer className="h-4 w-4" /> Tempo para confirmar seus dados</p>
          <div aria-label={`Tempo restante: ${formatMmSs(left)}`} className="selfservice-prize-clock mx-auto flex h-24 max-w-72 items-center justify-center gap-2 rounded-md bg-primary font-extrabold tabular-nums text-primary-foreground">
            <span className="w-20 text-center text-6xl">{minutes.padStart(2, "0")}</span><span className="selfservice-prize-tick text-5xl">:</span><span className="w-20 text-center text-6xl">{seconds}</span>
          </div>
        </div>}
        <p className="text-center text-sm leading-relaxed">{description}</p>
        <p className="text-center text-xs text-muted-foreground">Prêmio entregue somente com o pedido pago.</p>
      </div>
    </section>
  );
}