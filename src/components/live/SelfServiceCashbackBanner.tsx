import { Timer, Gift } from "lucide-react";
import { formatMmSs } from "@/lib/liveModes";

export function SelfServiceCashbackBanner({ deadline, now, amount }: { deadline: string | null; now: number; amount: number }) {
  if (!deadline) return null;
  const left = Math.max(0, Date.parse(deadline) - now);
  // Prazo encerrado: não mostrar nada. Avisar que o bônus "terminou" só deixa a cliente chateada.
  if (left <= 0) return null;
  const value = amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return <section aria-label="Cashback da live" className="space-y-3 border-y-2 border-primary bg-primary/10 px-4 py-5 text-center">
    <p className="flex items-center justify-center gap-2 text-lg font-extrabold"><Gift className="h-6 w-6" />PAGUE AGORA E GANHE</p>
    {left > 0 && <>
      <p className="break-words text-4xl font-extrabold text-foreground">{value}</p>
      <p className="text-lg font-bold">DE CASHBACK · 10% DO VALOR PAGO</p>
      <div aria-label={`Tempo restante: ${formatMmSs(left)}`} className="selfservice-prize-clock mx-auto flex h-28 max-w-72 items-center justify-center gap-2 rounded-md bg-primary text-6xl font-extrabold tabular-nums text-primary-foreground"><Timer className="h-7 w-7 shrink-0" />{formatMmSs(left)}</div>
      <p className="text-base font-bold">Pague antes do relógio zerar para garantir o cashback de 10%.</p>
      <p className="text-base font-semibold">Use na segunda compra ainda nesta live!</p>
      <p className="text-xs text-muted-foreground">20 minutos a partir do primeiro envio do carrinho. Valor calculado sobre o pagamento; descontos alteram o crédito.</p>
    </>}
  </section>;
}