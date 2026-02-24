import { useState, useEffect } from "react";
import { Lock, DollarSign, Target, Trophy, TrendingUp, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  storeId: string;
  period: string;
  periodStart: Date;
  periodEnd: Date;
  sellerMetrics: { name: string; totalSales: number; salesCount: number; totalItems: number; sellerId?: string }[];
}

interface CommissionTier {
  id: string;
  goal_value: number;
  achievement_percent: number;
  commission_percent: number;
  tier_order: number;
}

function calculateGoalCommission(revenue: number, tiers: CommissionTier[]): { commission: number; currentTier: CommissionTier | null; nextTier: CommissionTier | null; achievementPct: number; goalValue: number } {
  if (tiers.length === 0) return { commission: 0, currentTier: null, nextTier: null, achievementPct: 0, goalValue: 0 };

  const goalValue = tiers[0]?.goal_value || 0;
  if (goalValue <= 0) return { commission: 0, currentTier: null, nextTier: null, achievementPct: 0, goalValue: 0 };

  const achievementPct = (revenue / goalValue) * 100;

  // Sort by achievement_percent descending to find the highest tier achieved
  const sorted = [...tiers].sort((a, b) => b.achievement_percent - a.achievement_percent);
  const currentTier = sorted.find(t => achievementPct >= t.achievement_percent) || null;

  // Next tier is the one just above
  const sortedAsc = [...tiers].sort((a, b) => a.achievement_percent - b.achievement_percent);
  const currentIdx = currentTier ? sortedAsc.findIndex(t => t.id === currentTier.id) : -1;
  const nextTier = currentIdx >= 0 && currentIdx < sortedAsc.length - 1 ? sortedAsc[currentIdx + 1] : null;

  const commission = currentTier ? revenue * (currentTier.commission_percent / 100) : 0;

  return { commission, currentTier, nextTier, achievementPct, goalValue };
}

export function POSSellerPrivatePanel({ open, onClose, storeId, period, periodStart, periodEnd, sellerMetrics }: Props) {
  const [step, setStep] = useState<"pin" | "data">("pin");
  const [pin, setPin] = useState("");
  const [authenticatedSeller, setAuthenticatedSeller] = useState<{ id: string; name: string } | null>(null);
  const [commissionTiers, setCommissionTiers] = useState<CommissionTier[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [prizes, setPrizes] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      setStep("pin");
      setPin("");
      setAuthenticatedSeller(null);
      loadCommissionTiers();
    }
  }, [open]);

  const loadCommissionTiers = async () => {
    const { data } = await supabase.from("pos_seller_commission_tiers" as any).select("*").eq("store_id", storeId).eq("is_active", true).order("tier_order");
    setCommissionTiers((data as any[]) || []);
  };

  const handlePinComplete = async (value: string) => {
    setPin(value);
    if (value.length === 4) {
      const { data: sellers } = await supabase
        .from("pos_sellers")
        .select("id, name, pin_code")
        .eq("store_id", storeId)
        .eq("is_active", true);

      const match = (sellers || []).find((s: any) => s.pin_code === value);
      if (match) {
        setAuthenticatedSeller({ id: match.id, name: match.name });
        // Load goals and prizes
        const [goalsRes, prizesRes] = await Promise.all([
          supabase.from("pos_goals").select("*").eq("store_id", storeId).eq("is_active", true),
          supabase.from("customer_prizes").select("*").eq("store_id", storeId).gte("created_at", periodStart.toISOString()).lte("created_at", periodEnd.toISOString()),
        ]);
        setGoals(goalsRes.data || []);
        setPrizes(prizesRes.data || []);
        setStep("data");
      } else {
        toast.error("PIN incorreto!");
        setPin("");
      }
    }
  };

  const sellerData = authenticatedSeller
    ? sellerMetrics.find(s => s.sellerId === authenticatedSeller.id)
    : null;

  const sellerRevenue = sellerData?.totalSales || 0;
  const commResult = calculateGoalCommission(sellerRevenue, commissionTiers);

  // Find seller goals
  const sellerGoals = goals.filter(g => g.seller_id === authenticatedSeller?.id);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-pos-black border-pos-orange/30 text-pos-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-pos-white">
            <Lock className="h-4 w-4 text-pos-orange" />
            {step === "pin" ? "Digite seu PIN" : `Meus Dados - ${authenticatedSeller?.name}`}
          </DialogTitle>
        </DialogHeader>

        {step === "pin" && (
          <div className="flex flex-col items-center gap-6 py-8">
            <p className="text-sm text-pos-white/60">Digite seu PIN de 4 dígitos para acessar seus dados</p>
            <InputOTP maxLength={4} value={pin} onChange={handlePinComplete}>
              <InputOTPGroup>
                <InputOTPSlot index={0} className="border-pos-orange/30 text-pos-white bg-pos-white/5" />
                <InputOTPSlot index={1} className="border-pos-orange/30 text-pos-white bg-pos-white/5" />
                <InputOTPSlot index={2} className="border-pos-orange/30 text-pos-white bg-pos-white/5" />
                <InputOTPSlot index={3} className="border-pos-orange/30 text-pos-white bg-pos-white/5" />
              </InputOTPGroup>
            </InputOTP>
          </div>
        )}

        {step === "data" && authenticatedSeller && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Revenue */}
            <div className="p-4 rounded-xl bg-pos-white/5 border border-pos-orange/10">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-green-400" />
                <span className="text-xs text-pos-white/50">Faturamento no Período</span>
              </div>
              <p className="text-2xl font-bold text-pos-white">
                R$ {sellerRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-pos-white/40 mt-1">
                {sellerData?.salesCount || 0} vendas · Ticket médio: R$ {sellerData && sellerData.salesCount > 0 ? (sellerData.totalSales / sellerData.salesCount).toFixed(2) : "0.00"}
              </p>
            </div>

            {/* Goal & Achievement */}
            {commResult.goalValue > 0 && (
              <div className="p-4 rounded-xl bg-pos-orange/5 border border-pos-orange/20">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-pos-orange" />
                  <span className="text-xs text-pos-white/50">Meta do Período</span>
                </div>
                <p className="text-lg font-bold text-pos-orange">
                  R$ {commResult.goalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                <div className="mt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-pos-white/60">Atingimento</span>
                    <span className={`font-bold ${commResult.achievementPct >= 100 ? 'text-green-400' : 'text-pos-orange'}`}>
                      {commResult.achievementPct.toFixed(1)}%
                    </span>
                  </div>
                  <Progress 
                    value={Math.min(120, commResult.achievementPct)} 
                    className={`h-3 ${commResult.achievementPct >= 100 ? "[&>div]:bg-green-500" : "[&>div]:bg-pos-orange"} bg-pos-white/10`} 
                  />
                </div>
              </div>
            )}

            {/* Commission */}
            <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-green-400" />
                <span className="text-xs text-pos-white/50">Comissão</span>
              </div>
              <p className="text-2xl font-bold text-green-400">
                R$ {commResult.commission.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              {commResult.currentTier && (
                <p className="text-xs text-pos-white/40 mt-1">
                  Faixa atual: {commResult.currentTier.achievement_percent}% da meta → {commResult.currentTier.commission_percent}% de comissão
                </p>
              )}
              {!commResult.currentTier && commissionTiers.length > 0 && (
                <p className="text-xs text-red-400 mt-1">
                  ⚠️ Abaixo do mínimo para comissão ({commissionTiers.sort((a,b) => a.achievement_percent - b.achievement_percent)[0]?.achievement_percent}% da meta)
                </p>
              )}
              {commissionTiers.length === 0 && (
                <p className="text-xs text-pos-white/40 mt-1">Nenhuma faixa de comissão configurada.</p>
              )}
            </div>

            {/* Next tier */}
            {commResult.nextTier && commResult.goalValue > 0 && (
              <div className="p-3 rounded-lg bg-pos-orange/10 border border-pos-orange/20">
                <p className="text-xs text-pos-orange font-bold">
                  🚀 Falta R$ {((commResult.nextTier.achievement_percent / 100 * commResult.goalValue) - sellerRevenue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} para a faixa de {commResult.nextTier.commission_percent}% ({commResult.nextTier.achievement_percent}% da meta)!
                </p>
              </div>
            )}

            {/* Goals progress */}
            {sellerGoals.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-pos-white flex items-center gap-2">
                  <Target className="h-3.5 w-3.5 text-pos-orange" /> Metas Individuais
                </h4>
                {sellerGoals.map((goal: any) => {
                  const current = sellerRevenue;
                  const pct = goal.goal_value > 0 ? Math.min(100, (current / goal.goal_value) * 100) : 0;
                  const achieved = pct >= 100;
                  return (
                    <div key={goal.id} className={`p-3 rounded-lg border ${achieved ? "bg-green-500/10 border-green-500/30" : "bg-pos-white/5 border-pos-orange/10"}`}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-pos-white">{goal.goal_type === 'seller_revenue' ? 'Faturamento' : goal.goal_type}</span>
                        <span className={`text-xs font-bold ${achieved ? "text-green-400" : "text-pos-orange"}`}>{pct.toFixed(0)}%</span>
                      </div>
                      <Progress value={pct} className={`h-2 ${achieved ? "[&>div]:bg-green-500" : "[&>div]:bg-pos-orange"} bg-pos-white/10`} />
                      <p className="text-[10px] text-pos-white/40 mt-1">
                        R$ {current.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} / R$ {goal.goal_value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                      {goal.prize_label && (
                        <p className={`text-[10px] font-bold mt-1 ${achieved ? "text-green-400" : "text-black"}`}>
                          {achieved ? `✅ Ganhou: ${goal.prize_label}` : `🏆 Prêmio: ${goal.prize_label}`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bonuses won */}
            {sellerGoals.filter((g: any) => {
              const pct = g.goal_value > 0 ? (sellerRevenue / g.goal_value) * 100 : 0;
              return pct >= 100 && g.prize_label;
            }).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-pos-white flex items-center gap-2">
                  <Trophy className="h-3.5 w-3.5 text-yellow-400" /> Bônus Conquistados
                </h4>
                {sellerGoals.filter((g: any) => {
                  const pct = g.goal_value > 0 ? (sellerRevenue / g.goal_value) * 100 : 0;
                  return pct >= 100 && g.prize_label;
                }).map((g: any) => (
                  <div key={g.id} className="flex items-center gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <span className="text-lg">🎁</span>
                    <div>
                      <p className="text-sm font-bold text-pos-white">{g.prize_label}</p>
                      {g.prize_value && <p className="text-[10px] text-yellow-400">Valor: R$ {Number(g.prize_value).toFixed(2)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
