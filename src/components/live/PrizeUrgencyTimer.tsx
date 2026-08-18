import { useEffect, useMemo, useState } from "react";
import { Gift, Timer } from "lucide-react";

interface Props {
  /** Nome do prêmio cadastrado no evento (roleta ou sorteio). */
  prizeLabel: string;
  /** Chave estável (pedido ou telefone) pra o cronômetro não reiniciar a cada etapa. */
  storageKey: string;
  /** Duração em minutos (padrão 5). */
  minutes?: number;
}

/**
 * Cronômetro de urgência exibido durante a confirmação do pedido quando existe
 * roleta/sorteio ativo para quem confirma. O prazo é gravado em localStorage
 * para sobreviver às etapas do onboarding e a recarregamentos da página.
 */
export function PrizeUrgencyTimer({ prizeLabel, storageKey, minutes = 5 }: Props) {
  const deadline = useMemo(() => {
    const key = `ma-prize-urgency:${storageKey}`;
    try {
      const saved = Number(localStorage.getItem(key) || 0);
      if (saved && saved > Date.now() - 60 * 60 * 1000) return saved;
      const next = Date.now() + minutes * 60 * 1000;
      localStorage.setItem(key, String(next));
      return next;
    } catch {
      return Date.now() + minutes * 60 * 1000;
    }
  }, [storageKey, minutes]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const left = Math.max(0, deadline - now);
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const done = left <= 0;

  return (
    <div className="mb-4 rounded-2xl border-2 border-primary/60 bg-primary/10 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-xl bg-primary/20 p-2">
          <Gift className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-snug">
            {done
              ? "Corre! O sorteio pode acontecer a qualquer momento"
              : "Confirme seu pedido e preencha seus dados em até 5 minutos e concorra a"}
          </p>
          <p className="text-sm font-black leading-snug text-primary truncate">{prizeLabel}</p>
        </div>
        <div
          className={`shrink-0 flex items-center gap-1 rounded-xl px-2.5 py-1.5 font-black tabular-nums ${
            done ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground animate-pulse"
          }`}
        >
          <Timer className="h-4 w-4" />
          {mm}:{ss}
        </div>
      </div>
    </div>
  );
}
