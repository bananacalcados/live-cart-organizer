import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { POSSlotMachine } from "./POSSlotMachine";
import { POSGiftBox } from "./POSGiftBox";
import { Progress } from "@/components/ui/progress";
import { Gift, Star, Trophy, Clock } from "lucide-react";

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
  open: boolean;
  pointsEarned: number;
  totalPoints: number;
  tiers: PrizeTier[];
  wonPrize: PrizeTier | null;
  wonCouponCode: string;
  customerName?: string;
  onClose: () => void;
  onRedeemPrize?: () => Promise<string>; // returns coupon code
}

type Phase = "slot" | "summary" | "prize";

export function POSLoyaltyScreen({ open, pointsEarned, totalPoints, tiers, wonPrize, wonCouponCode, customerName, onClose, onRedeemPrize }: Props) {
  const [phase, setPhase] = useState<Phase>("slot");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemedCode, setRedeemedCode] = useState("");

  const handleSlotComplete = () => {
    setPhase("summary");
  };

  const handleRedeemNow = async () => {
    if (!onRedeemPrize) return;
    setRedeeming(true);
    try {
      const code = await onRedeemPrize();
      setRedeemedCode(code);
      setPhase("prize");
    } catch {
      // If redemption fails, just close
      onClose();
    } finally {
      setRedeeming(false);
    }
  };

  const handleSaveLater = () => {
    onClose();
  };

  // Find next tier the customer hasn't reached yet
  const sortedTiers = [...tiers].sort((a, b) => a.min_points - b.min_points);
  const nextTier = sortedTiers.find(t => totalPoints < t.min_points);
  const pointsToNext = nextTier ? nextTier.min_points - totalPoints : 0;
  const progressPercent = nextTier ? Math.min(100, (totalPoints / nextTier.min_points) * 100) : 100;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-lg border-0 p-0 overflow-hidden [&>button]:hidden bg-transparent shadow-none"
        onPointerDownOutside={e => e.preventDefault()}
      >
        <div className="bg-gradient-to-br from-yellow-900/95 via-orange-900/95 to-red-900/95 rounded-2xl border-2 border-yellow-400/30 shadow-[0_0_80px_rgba(255,165,0,0.3)]">
          {/* Phase 1: Slot Machine */}
          {phase === "slot" && (
            <POSSlotMachine
              pointsEarned={pointsEarned}
              customerName={customerName}
              onComplete={handleSlotComplete}
            />
          )}

          {/* Phase 2: Points Summary */}
          {phase === "summary" && (
            <div className="p-6 space-y-6 animate-in fade-in slide-in-from-right duration-500">
              <div className="text-center">
                <h3 className="text-xl font-black text-yellow-400 flex items-center justify-center gap-2">
                  <Star className="h-6 w-6" /> Seus Pontos Acumulados
                </h3>
                {customerName && (
                  <p className="text-sm text-white/60 mt-1">Olá, {customerName}! 💛</p>
                )}
              </div>

              {/* Total points display */}
              <div className="text-center py-4">
                <div className="inline-flex items-center gap-3 bg-yellow-400/10 rounded-2xl px-8 py-4 border border-yellow-400/30">
                  <Trophy className="h-8 w-8 text-yellow-400" />
                  <div>
                    <p className="text-4xl font-black text-yellow-400">{totalPoints}</p>
                    <p className="text-xs text-white/50 uppercase tracking-wider">pontos totais</p>
                  </div>
                </div>
              </div>

              {/* Progress to next tier */}
              {nextTier && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">Próximo prêmio:</span>
                    <span className="text-yellow-400 font-bold">{nextTier.prize_label}</span>
                  </div>
                  <Progress value={progressPercent} className="h-3 bg-white/10" />
                  <p className="text-xs text-center text-white/50">
                    Faltam <span className="text-yellow-400 font-bold">{pointsToNext} pontos</span> para desbloquear!
                  </p>
                </div>
              )}

              {/* Available tiers list */}
              {sortedTiers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-white/40 uppercase tracking-wider font-bold">Prêmios disponíveis:</p>
                  {sortedTiers.map(tier => {
                    const unlocked = totalPoints >= tier.min_points;
                    return (
                      <div
                        key={tier.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                          unlocked
                            ? "border-green-400/50 bg-green-400/10"
                            : "border-white/10 bg-white/5"
                        }`}
                      >
                        <div
                          className="h-10 w-10 rounded-xl flex items-center justify-center text-lg"
                          style={{ backgroundColor: tier.color + "30" }}
                        >
                          {unlocked ? "🎁" : "🔒"}
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm font-bold ${unlocked ? "text-green-400" : "text-white/70"}`}>
                            {tier.prize_label}
                          </p>
                          <p className="text-[10px] text-white/40">{tier.min_points} pontos</p>
                        </div>
                        {unlocked && (
                          <span className="text-xs text-green-400 font-bold animate-pulse">✓ Desbloqueado!</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* CTA - Redeem or Save */}
              <div className="text-center space-y-3">
                {wonPrize ? (
                  <div className="space-y-3">
                    <p className="text-sm text-green-400 font-bold">
                      🎉 Você desbloqueou: {wonPrize.prize_label}!
                    </p>
                    <button
                      onClick={handleRedeemNow}
                      disabled={redeeming}
                      className="w-full px-8 py-4 rounded-2xl bg-gradient-to-r from-green-400 via-emerald-500 to-green-600 text-white font-bold text-lg hover:from-green-500 hover:via-emerald-600 hover:to-green-700 transition-all shadow-lg shadow-green-500/30 animate-pulse disabled:opacity-50"
                    >
                      <Gift className="h-5 w-5 inline mr-2" />
                      {redeeming ? 'Resgatando...' : 'Resgatar Agora! 🎁'}
                    </button>
                    <button
                      onClick={handleSaveLater}
                      className="w-full px-8 py-3 rounded-2xl bg-white/10 text-white/80 font-bold hover:bg-white/20 transition-all border border-white/20"
                    >
                      <Clock className="h-4 w-4 inline mr-2" />
                      Guardar para Depois 💰
                    </button>
                    <p className="text-[10px] text-white/40">
                      Ao guardar, seus pontos ficam acumulados para resgatar na próxima visita!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-yellow-400/80">
                      {nextTier
                        ? `Faltam apenas ${pointsToNext} pontos para ganhar ${nextTier.prize_label}! Volte em breve! 💪`
                        : "Continue comprando para acumular mais pontos! 💛"
                      }
                    </p>
                    <button
                      onClick={onClose}
                      className="w-full px-8 py-3 rounded-2xl bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 text-white font-bold hover:from-yellow-500 hover:via-orange-600 hover:to-red-600 transition-all shadow-lg"
                    >
                      Finalizar ✨
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Phase 3: Prize Reveal */}
          {phase === "prize" && wonPrize && (
            <div className="p-6 animate-in fade-in zoom-in duration-700">
              <POSGiftBox
                prize={wonPrize}
                couponCode={redeemedCode || wonCouponCode}
                onClose={onClose}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
