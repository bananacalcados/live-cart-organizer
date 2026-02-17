import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  pointsEarned: number;
  onComplete: () => void;
}

export function POSSlotMachine({ pointsEarned, onComplete }: Props) {
  const [phase, setPhase] = useState<"idle" | "pulling" | "spinning" | "done">("idle");
  const [displayDigits, setDisplayDigits] = useState<number[]>([0, 0, 0]);
  const intervalRefs = useRef<ReturnType<typeof setInterval>[]>([]);

  const digits = String(pointsEarned).padStart(3, "0").split("").map(Number);

  const startSpin = () => {
    setPhase("pulling");
    setTimeout(() => {
      setPhase("spinning");

      // Start all reels spinning with random numbers
      digits.forEach((_, i) => {
        const ref = setInterval(() => {
          setDisplayDigits(prev => {
            const next = [...prev];
            next[i] = Math.floor(Math.random() * 10);
            return next;
          });
        }, 80);
        intervalRefs.current.push(ref);
      });

      // Stop reels sequentially
      setTimeout(() => {
        clearInterval(intervalRefs.current[0]);
        setDisplayDigits(prev => { const n = [...prev]; n[0] = digits[0]; return n; });
      }, 1200);
      setTimeout(() => {
        clearInterval(intervalRefs.current[1]);
        setDisplayDigits(prev => { const n = [...prev]; n[1] = digits[1]; return n; });
      }, 1800);
      setTimeout(() => {
        clearInterval(intervalRefs.current[2]);
        setDisplayDigits(prev => { const n = [...prev]; n[2] = digits[2]; return n; });
        setPhase("done");
      }, 2400);
    }, 600);
  };

  useEffect(() => {
    return () => intervalRefs.current.forEach(clearInterval);
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      <h3 className="text-xl font-black text-pos-orange flex items-center gap-2">
        🎰 Seus Pontos de Fidelidade!
      </h3>
      <p className="text-sm text-pos-white/60">Puxe a alavanca para revelar seus pontos</p>

      <div className="relative">
        {/* Slot machine body */}
        <div className="bg-gradient-to-b from-zinc-800 to-zinc-900 rounded-2xl p-6 border-2 border-yellow-500/40 shadow-[0_0_40px_rgba(255,215,0,0.15)]">
          {/* Top decoration */}
          <div className="flex items-center justify-center mb-4">
            <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse mx-1" />
            <div className="h-3 w-3 rounded-full bg-yellow-400 animate-pulse mx-1 delay-100" />
            <div className="h-3 w-3 rounded-full bg-green-400 animate-pulse mx-1 delay-200" />
            <span className="text-xs font-bold text-yellow-400 ml-3 tracking-widest">PONTOS</span>
            <div className="h-3 w-3 rounded-full bg-green-400 animate-pulse mx-1 delay-200" />
            <div className="h-3 w-3 rounded-full bg-yellow-400 animate-pulse mx-1 delay-100" />
            <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse mx-1" />
          </div>

          {/* Reels */}
          <div className="flex gap-3">
            {displayDigits.map((digit, i) => (
              <div key={i} className="relative overflow-hidden">
                <div className={cn(
                  "w-20 h-28 bg-gradient-to-b from-zinc-700 via-zinc-600 to-zinc-700 rounded-xl border-2 border-zinc-500/50 flex items-center justify-center shadow-inner",
                  phase === "spinning" && "border-yellow-400/50"
                )}>
                  <span className={cn(
                    "text-5xl font-black tabular-nums transition-all",
                    phase === "spinning" ? "text-yellow-300 scale-110" : "text-white",
                    phase === "done" && "text-yellow-400 scale-125"
                  )}>
                    {digit}
                  </span>
                </div>
                {/* Highlight line */}
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-yellow-400/30 -translate-y-1/2 pointer-events-none" />
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <div className="h-1 flex-1 bg-gradient-to-r from-transparent via-yellow-400/30 to-transparent rounded" />
            <span className="text-[10px] text-yellow-400/60 font-bold tracking-wider">FIDELIDADE</span>
            <div className="h-1 flex-1 bg-gradient-to-r from-transparent via-yellow-400/30 to-transparent rounded" />
          </div>
        </div>

        {/* Lever */}
        <div className="absolute -right-12 top-1/2 -translate-y-1/2 flex flex-col items-center">
          <button
            onClick={phase === "idle" ? startSpin : undefined}
            disabled={phase !== "idle"}
            className={cn(
              "flex flex-col items-center cursor-pointer transition-transform",
              phase === "pulling" && "translate-y-6",
              phase === "idle" && "hover:-translate-y-1"
            )}
          >
            {/* Ball */}
            <div className={cn(
              "w-10 h-10 rounded-full shadow-lg transition-all",
              phase === "idle"
                ? "bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 cursor-grab"
                : "bg-gradient-to-b from-red-700 to-red-900"
            )} />
            {/* Stick */}
            <div className="w-3 h-20 bg-gradient-to-b from-zinc-400 to-zinc-600 rounded-b-lg" />
          </button>
        </div>
      </div>

      {phase === "done" && (
        <div className="text-center space-y-3 animate-in fade-in zoom-in duration-500">
          <p className="text-3xl font-black text-yellow-400">
            +{pointsEarned} pontos!
          </p>
          <p className="text-sm text-pos-white/60">Pontos acumulados com sucesso</p>
          <button
            onClick={onComplete}
            className="px-8 py-3 rounded-xl bg-pos-orange text-pos-black font-bold hover:bg-pos-orange-muted transition-colors"
          >
            Continuar ✨
          </button>
        </div>
      )}

      {phase === "idle" && (
        <p className="text-xs text-yellow-400/70 animate-pulse">👆 Puxe a alavanca!</p>
      )}
    </div>
  );
}
