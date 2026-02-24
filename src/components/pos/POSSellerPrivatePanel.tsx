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
  min_revenue: number;
  max_revenue: number | null;
  commission_percent: number;
  tier_order: number;
}

function calculateTieredCommission(revenue: number, tiers: CommissionTier[]): { total: number; breakdown: { tier: CommissionTier; amount: number; revenue: number }[] } {
  const sorted = [...tiers].sort((a, b) => a.tier_order - b.tier_order);
  let remaining = revenue;
  let total = 0;
  const breakdown: { tier: CommissionTier; amount: number; revenue: number }[] = [];

  for (const tier of sorted) {
    if (remaining <= 0) break;
    const tierMax = tier.max_revenue ? tier.max_revenue - tier.min_revenue : remaining;
    const applicable = Math.min(remaining, tierMax);
    const amount = applicable * (tier.commission_percent / 100);
    breakdown.push({ tier, amount, revenue: applicable });
    total += amount;
    remaining -= applicable;
  }

  return { total, breakdown };
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
  const commission = calculateTieredCommission(sellerRevenue, commissionTiers);

  // Find seller goals
  const sellerGoals = goals.filter(g => g.seller_id === authenticatedSeller?.id);
  
  // Find next tier
  const sortedTiers = [...commissionTiers].sort((a, b) => a.tier_order - b.tier_order);
  const currentTierIdx = sortedTiers.findIndex(t => 
    sellerRevenue >= t.min_revenue && (t.max_revenue === null || sellerRevenue < t.max_revenue)
  );
  const nextTier = currentTierIdx >= 0 && currentTierIdx < sortedTiers.length - 1 
    ? sortedTiers[currentTierIdx + 1] 
    : null;

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

            {/* Commission */}
            <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-green-400" />
                <span className="text-xs text-pos-white/50">Comissão Acumulada</span>
              </div>
              <p className="text-2xl font-bold text-green-400">
                R$ {commission.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              {commission.breakdown.length > 0 && (
                <div className="mt-2 space-y-1">
                  {commission.breakdown.map((b, i) => (
                    <p key={i} className="text-[10px] text-pos-white/40">
                      Faixa {i + 1}: R$ {b.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} × {b.tier.commission_percent}% = R$ {b.amount.toFixed(2)}
                    </p>
                  ))}
                </div>
              )}
              {commissionTiers.length === 0 && (
                <p className="text-xs text-pos-white/40 mt-1">Nenhuma faixa de comissão configurada.</p>
              )}
            </div>

            {/* Next tier */}
            {nextTier && (
              <div className="p-3 rounded-lg bg-pos-orange/10 border border-pos-orange/20">
                <p className="text-xs text-pos-orange font-bold">
                  🚀 Falta R$ {(nextTier.min_revenue - sellerRevenue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} para a próxima faixa de {nextTier.commission_percent}%!
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
