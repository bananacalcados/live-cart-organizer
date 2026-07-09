import { CheckCircle2, Circle } from "lucide-react";
import type { GoalTier } from "@/lib/pos/payroll";

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  goal: number;
  total: number;
  tiers: GoalTier[];
  variant?: "dark" | "light";
}

/**
 * Tabela de metas escalonadas de uma pessoa:
 * para cada degrau (80/90/100/110/120%) mostra o faturamento necessário,
 * quanto falta para atingir, a % de comissão e a comissão projetada nesse degrau.
 */
export function ScaledGoalTiers({ goal, total, tiers, variant = "dark" }: Props) {
  const dark = variant === "dark";
  const c = dark
    ? {
        head: "text-zinc-400",
        border: "border-zinc-800",
        muted: "text-zinc-500",
        text: "text-zinc-200",
        reached: "text-emerald-400",
        pending: "text-zinc-500",
        rowReached: "bg-emerald-500/5",
        com: "text-orange-400",
      }
    : {
        head: "text-black/50",
        border: "border-black/10",
        muted: "text-black/40",
        text: "text-black/80",
        reached: "text-emerald-600",
        pending: "text-black/40",
        rowReached: "bg-emerald-500/10",
        com: "text-orange-600",
      };

  if (goal <= 0 || tiers.length === 0) {
    return <p className={`text-[11px] ${c.muted}`}>Sem meta definida para o período.</p>;
  }

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className={`${c.head} uppercase tracking-wide`}>
          <th className="text-left py-1 pr-2 font-semibold">Meta</th>
          <th className="text-right py-1 px-2 font-semibold">Faturamento p/ atingir</th>
          <th className="text-right py-1 px-2 font-semibold">Falta</th>
          <th className="text-right py-1 px-2 font-semibold">% Com.</th>
          <th className="text-right py-1 pl-2 font-semibold">Comissão no degrau</th>
        </tr>
      </thead>
      <tbody>
        {tiers.map((t) => (
          <tr
            key={t.achievementPercent}
            className={`border-t ${c.border} ${t.reached ? c.rowReached : ""}`}
          >
            <td className="py-1 pr-2">
              <span className="inline-flex items-center gap-1.5">
                {t.reached ? (
                  <CheckCircle2 className={`h-3.5 w-3.5 ${c.reached}`} />
                ) : (
                  <Circle className={`h-3.5 w-3.5 ${c.pending}`} />
                )}
                <span className={`font-semibold ${c.text}`}>{t.achievementPercent}%</span>
                {t.achievementPercent === 100 && (
                  <span className={`text-[9px] ${c.muted}`}>(base)</span>
                )}
              </span>
            </td>
            <td className={`text-right py-1 px-2 ${c.text}`}>{BRL(t.targetRevenue)}</td>
            <td className={`text-right py-1 px-2 ${t.reached ? c.reached : c.text}`}>
              {t.reached ? "atingida" : BRL(t.missing)}
            </td>
            <td className={`text-right py-1 px-2 font-semibold ${c.text}`}>
              {t.commissionPercent.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%
            </td>
            <td className={`text-right py-1 pl-2 font-semibold ${c.com}`}>{BRL(t.commissionValue)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={`border-t ${c.border}`}>
          <td className={`py-1 pr-2 ${c.muted}`} colSpan={2}>
            Faturamento atual: <span className={`font-semibold ${c.reached}`}>{BRL(total)}</span>
          </td>
          <td colSpan={3} className={`text-right py-1 ${c.muted}`}>
            Comissão = % do degrau atingido × faturamento
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
