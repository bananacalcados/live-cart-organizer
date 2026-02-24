import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  pointsEarned: number;
  customerName?: string;
  onComplete: () => void;
}

export function POSSlotMachine({ pointsEarned, customerName, onComplete }: Props) {
  const [phase, setPhase] = useState<"spinning" | "done">("spinning");
  const [displayDigits, setDisplayDigits] = useState<number[]>([0, 0, 0]);
  const intervalRefs = useRef<ReturnType<typeof setInterval>[]>([]);

  const digits = String(pointsEarned).padStart(3, "0").split("").map(Number);

  // Auto-start spinning on mount
  useEffect(() => {
    // Start all reels spinning with random numbers
    digits.forEach((_, i) => {
      const ref = setInterval(() => {
        setDisplayDigits(prev => {
          const next = [...prev];
          next[i] = Math.floor(Math.random() * 10);
          return next;
        });
      }, 70);
      intervalRefs.current.push(ref);
    });

    // Stop reels sequentially
    setTimeout(() => {
      clearInterval(intervalRefs.current[0]);
      setDisplayDigits(prev => { const n = [...prev]; n[0] = digits[0]; return n; });
    }, 1000);
    setTimeout(() => {
      clearInterval(intervalRefs.current[1]);
      setDisplayDigits(prev => { const n = [...prev]; n[1] = digits[1]; return n; });
    }, 1600);
    setTimeout(() => {
      clearInterval(intervalRefs.current[2]);
      setDisplayDigits(prev => { const n = [...prev]; n[2] = digits[2]; return n; });
      setPhase("done");
    }, 2200);

    return () => intervalRefs.current.forEach(clearInterval);
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4">
      {/* Colorful title */}
      <div className="text-center">
        <h3 className="text-2xl font-black bg-gradient-to-r from-yellow-300 via-orange-400 to-red-500 bg-clip-text text-transparent">
          🎰 {customerName ? `Parabéns, ${customerName}!` : 'Seus Pontos de Fidelidade!'}
        </h3>
        <p className="text-sm text-pos-white/50 mt-1">Aguarde o resultado...</p>
      </div>

      {/* Slot machine body */}
      <div className="relative">
        <div className="bg-gradient-to-b from-yellow-500/20 via-orange-500/10 to-red-500/20 rounded-3xl p-8 border-2 border-yellow-400/50 shadow-[0_0_60px_rgba(255,215,0,0.2)]">
          {/* Top lights */}
          <div className="flex items-center justify-center mb-5 gap-1.5">
            {[...Array(7)].map((_, i) => (
              <div
                key={i}
                className="h-3 w-3 rounded-full animate-pulse"
                style={{
                  backgroundColor: ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF6B6B', '#FFD93D', '#6BCB77'][i],
                  animationDelay: `${i * 150}ms`
                }}
              />
            ))}
          </div>

          {/* Reels */}
          <div className="flex gap-4">
            {displayDigits.map((digit, i) => (
              <div key={i} className="relative overflow-hidden">
                <div className={cn(
                  "w-24 h-32 rounded-2xl border-3 flex items-center justify-center shadow-inner transition-all duration-300",
                  phase === "spinning"
                    ? "bg-gradient-to-b from-yellow-400/20 via-orange-400/30 to-yellow-400/20 border-yellow-400/60"
                    : "bg-gradient-to-b from-green-400/20 via-green-500/30 to-green-400/20 border-green-400/60"
                )}>
                  <span className={cn(
                    "text-6xl font-black tabular-nums transition-all duration-500",
                    phase === "spinning" ? "text-yellow-300 scale-110 animate-pulse" : "text-green-400 scale-125"
                  )}>
                    {digit}
                  </span>
                </div>
                {/* Glow line */}
                <div className="absolute top-1/2 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-yellow-400/40 to-transparent -translate-y-1/2 pointer-events-none" />
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="mt-5 flex items-center justify-center gap-2">
            <div className="h-0.5 flex-1 bg-gradient-to-r from-transparent via-yellow-400/40 to-transparent rounded" />
            <span className="text-xs text-yellow-400/70 font-bold tracking-[0.3em]">PONTOS</span>
            <div className="h-0.5 flex-1 bg-gradient-to-r from-transparent via-yellow-400/40 to-transparent rounded" />
          </div>
        </div>
      </div>

      {phase === "done" && (
        <div className="text-center space-y-4 animate-in fade-in zoom-in duration-700">
          <div className="space-y-1">
            <p className="text-4xl font-black bg-gradient-to-r from-yellow-300 via-orange-400 to-green-400 bg-clip-text text-transparent">
              +{pointsEarned} pontos! 🎉
            </p>
            <p className="text-sm text-pos-white/50">Pontos acumulados com sucesso!</p>
          </div>
          <button
            onClick={onComplete}
            className="px-10 py-3.5 rounded-2xl bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 text-white font-bold text-lg hover:from-yellow-500 hover:via-orange-600 hover:to-red-600 transition-all shadow-lg shadow-orange-500/30"
          >
            Continuar ✨
          </button>
        </div>
      )}

      {phase === "spinning" && (
        <div className="flex items-center gap-2 text-yellow-400/70 animate-pulse">
          <span className="text-2xl">🎲</span>
          <p className="text-sm font-bold">Calculando seus pontos...</p>
          <span className="text-2xl">🎲</span>
        </div>
      )}
    </div>
  );
}
