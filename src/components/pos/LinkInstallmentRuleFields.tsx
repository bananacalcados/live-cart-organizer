import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Regra de parcelamento DESTE link (vazio = padrão da loja). */
export default function LinkInstallmentRuleFields({
  maxInstallments, setMaxInstallments,
  noInterestInstallments, setNoInterestInstallments,
  interestRate, setInterestRate,
}: {
  maxInstallments: string; setMaxInstallments: (v: string) => void;
  noInterestInstallments: string; setNoInterestInstallments: (v: string) => void;
  interestRate: string; setInterestRate: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-base font-bold">Parcelamento deste link</Label>
      <div className="grid grid-cols-3 gap-2 mt-1">
        <div>
          <Label className="text-xs">Máx. parcelas</Label>
          <Input
            value={maxInstallments}
            onChange={(e) => setMaxInstallments(e.target.value.replace(/\D/g, "").slice(0, 2))}
            placeholder="Padrão" className="h-12 text-lg font-bold" inputMode="numeric"
          />
        </div>
        <div>
          <Label className="text-xs">Sem juros até</Label>
          <Input
            value={noInterestInstallments}
            onChange={(e) => setNoInterestInstallments(e.target.value.replace(/\D/g, "").slice(0, 2))}
            placeholder="Padrão" className="h-12 text-lg font-bold" inputMode="numeric"
          />
        </div>
        <div>
          <Label className="text-xs">Juros a.m. %</Label>
          <Input
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
            placeholder="2,49" className="h-12 text-lg font-bold" inputMode="decimal"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        Vazio = padrão da loja. <b>Sem juros até 0</b> = todas as parcelas com acréscimo. Máx 12×.
      </p>
    </div>
  );
}
