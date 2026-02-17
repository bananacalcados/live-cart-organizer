import { useState } from "react";
import { cn } from "@/lib/utils";

interface PrizeTier {
  id: string;
  name: string;
  prize_label: string;
  prize_type: string;
  prize_value: number;
  color: string;
  min_points: number;
}

interface Props {
  prize: PrizeTier;
  couponCode: string;
  onClose: () => void;
}

export function POSGiftBox({ prize, couponCode, onClose }: Props) {
  const [opened, setOpened] = useState(false);

  const prizeDescription = 
    prize.prize_type === 'discount_percent' ? `${prize.prize_value}% de desconto` :
    prize.prize_type === 'discount_fixed' ? `R$ ${Number(prize.prize_value).toFixed(2)} de desconto` :
    prize.prize_type === 'free_shipping' ? 'Frete Grátis' :
    prize.prize_type === 'gift' ? `Brinde especial` :
    prize.prize_label;

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      <div className="text-center space-y-1">
        <h3 className="text-xl font-black text-yellow-400 flex items-center justify-center gap-2">
          🎁 Você desbloqueou um prêmio!
        </h3>
        <p className="text-sm text-pos-white/60">
          {opened ? "Parabéns!" : "Toque na caixa para abrir seu presente"}
        </p>
      </div>

      {!opened ? (
        <button
          onClick={() => setOpened(true)}
          className="relative group cursor-pointer transition-transform hover:scale-105 active:scale-95"
        >
          {/* Glow */}
          <div className="absolute inset-0 rounded-3xl animate-pulse"
            style={{ boxShadow: `0 0 60px ${prize.color}40, 0 0 120px ${prize.color}20` }}
          />

          {/* Box body */}
          <div className="relative w-40 h-40 rounded-2xl border-4 border-yellow-500/60 overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${prize.color}CC, ${prize.color}88)` }}>
            {/* Ribbon vertical */}
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-8 bg-yellow-400/40" />
            {/* Ribbon horizontal */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-8 bg-yellow-400/40" />
            {/* Bow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-5xl group-hover:animate-bounce">
              🎀
            </div>
          </div>

          {/* Shimmer particles */}
          <div className="absolute -top-2 -left-2 text-2xl animate-bounce">✨</div>
          <div className="absolute -top-2 -right-2 text-2xl animate-bounce delay-150">✨</div>
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-2xl animate-bounce delay-300">✨</div>
        </button>
      ) : (
        <div className="text-center space-y-5 animate-in fade-in zoom-in duration-700">
          {/* Exploded box */}
          <div className="relative">
            <div className="h-28 w-28 mx-auto rounded-full flex items-center justify-center shadow-2xl"
              style={{
                background: `linear-gradient(135deg, ${prize.color}, ${prize.color}AA)`,
                boxShadow: `0 0 50px ${prize.color}50`
              }}>
              <span className="text-6xl">🎉</span>
            </div>
            <div className="absolute -top-4 -right-4 text-4xl animate-bounce">🎊</div>
            <div className="absolute -top-4 -left-4 text-3xl animate-bounce delay-100">🥳</div>
          </div>

          <div>
            <p className="text-sm text-pos-white/60 uppercase tracking-wider font-medium">{prize.name}</p>
            <h3 className="text-2xl font-black text-yellow-400 mt-1">
              {prizeDescription}
            </h3>
          </div>

          <div className="bg-pos-white/10 rounded-xl p-4 border-2 border-dashed border-yellow-400/50 space-y-2 max-w-xs mx-auto">
            <p className="text-xs text-pos-white/60 uppercase tracking-wider">Código do Prêmio</p>
            <p className="text-2xl font-mono font-black text-yellow-400 tracking-widest">{couponCode}</p>
          </div>

          <p className="text-xs text-pos-white/40 max-w-xs mx-auto">
            Apresente este código na próxima compra para resgatar.
          </p>

          <button
            onClick={onClose}
            className="px-8 py-3 rounded-xl bg-pos-orange text-pos-black font-bold hover:bg-pos-orange-muted transition-colors"
          >
            🎁 Fechar
          </button>
        </div>
      )}
    </div>
  );
}
