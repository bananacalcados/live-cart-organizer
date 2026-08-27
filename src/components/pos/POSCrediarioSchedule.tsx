import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, RefreshCw } from "lucide-react";

export interface CrediarioInstallment {
  amount: number;
  due_date: string; // yyyy-MM-dd
}

interface Props {
  amount: number;
  count: number;
  onCountChange?: (n: number) => void;
  showCountSelector?: boolean;
  value: CrediarioInstallment[];
  onChange: (rows: CrediarioInstallment[]) => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Soma meses preservando o dia (clamp no último dia do mês). */
function addMonthsKeepingDay(base: Date, months: number, day: number) {
  const d = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

export function buildSchedule(amount: number, count: number, firstDue: Date, baseDay?: number): CrediarioInstallment[] {
  const n = Math.max(1, Math.floor(count || 1));
  const cents = Math.round((amount || 0) * 100);
  const per = Math.floor(cents / n);
  const day = baseDay ?? firstDue.getDate();
  const rows: CrediarioInstallment[] = [];
  for (let i = 0; i < n; i++) {
    const value = i === n - 1 ? cents - per * (n - 1) : per;
    const due = i === 0 ? firstDue : addMonthsKeepingDay(firstDue, i, day);
    rows.push({ amount: value / 100, due_date: toISO(due) });
  }
  return rows;
}

export function POSCrediarioSchedule({ amount, count, onCountChange, showCountSelector, value, onChange }: Props) {
  const defaultFirst = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d;
  }, []);
  const [firstDue, setFirstDue] = useState<string>(toISO(defaultFirst));

  // (Re)gera automaticamente quando muda o valor, a quantidade ou a 1ª data
  useEffect(() => {
    onChange(buildSchedule(amount, count, fromISO(firstDue)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, count, firstDue]);

  const sum = value.reduce((s, r) => s + Number(r.amount || 0), 0);
  const diff = Math.round((sum - (amount || 0)) * 100) / 100;

  const setRow = (i: number, patch: Partial<CrediarioInstallment>) => {
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const regenerate = () => onChange(buildSchedule(amount, count, fromISO(firstDue)));

  return (
    <div className="space-y-5 p-6 rounded-xl bg-pos-white/5 border border-pos-orange/20">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-lg font-semibold text-pos-white flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-pos-orange" /> Vencimentos do crediário
        </Label>
        <Button type="button" size="default" variant="ghost" onClick={regenerate} className="h-11 text-sm text-pos-white/70 hover:text-pos-orange gap-1.5">
          <RefreshCw className="h-4 w-4" /> Recalcular
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {showCountSelector && (
          <div className="space-y-2">
            <span className="text-sm text-pos-white/60">Parcelas</span>
            <Select value={String(count)} onValueChange={(v) => onCountChange?.(Number(v))}>
              <SelectTrigger className="h-12 text-base bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                  <SelectItem key={n} value={String(n)} className="text-base">{n}x</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <span className="text-sm text-pos-white/60">1º vencimento</span>
          <Input
            type="date"
            value={firstDue}
            onChange={(e) => e.target.value && setFirstDue(e.target.value)}
            className="h-12 text-base bg-pos-white/5 border-pos-orange/30 text-pos-white"
          />
        </div>
      </div>

      <div className="space-y-3 max-h-[360px] overflow-y-auto pr-2">
        {value.map((r, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-base font-medium text-pos-white/60">{i + 1}/{value.length}</span>
            <Input
              type="date"
              value={r.due_date}
              onChange={(e) => e.target.value && setRow(i, { due_date: e.target.value })}
              className="h-12 flex-1 text-base bg-pos-white/5 border-pos-orange/20 text-pos-white"
            />
            <Input
              type="number"
              step="0.01"
              value={r.amount}
              onChange={(e) => setRow(i, { amount: Number(e.target.value) })}
              className="h-12 w-40 text-base bg-pos-white/5 border-pos-orange/20 text-pos-white"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-base pt-1">
        <span className="text-pos-white/60">Soma das parcelas</span>
        <span className={diff === 0 ? "font-semibold text-green-400" : "font-semibold text-red-400"}>
          {BRL(sum)}{diff !== 0 && ` · difere ${BRL(diff)} do total (${BRL(amount)})`}
        </span>
      </div>
    </div>
  );
}
