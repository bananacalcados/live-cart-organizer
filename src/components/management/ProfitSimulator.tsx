import { useState, useMemo } from "react";
import {
  Calculator, Target, DollarSign, Percent, TrendingUp, RotateCcw, Minus,
  ArrowDownToLine, Crosshair,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number) => `${v.toFixed(2)}%`;

interface FixedCostItem {
  id: string;
  name: string;
  category: string | null;
  amount: number; // current amount for this context
}

interface VariableCostItem {
  id: string;
  description: string;
  percentage: number;
}

interface Props {
  title: string;
  fixedCostItems: FixedCostItem[];
  variableCostItems: VariableCostItem[];
  totalFixedCosts: number;
  totalVariablePercent: number;
}

export function ProfitSimulator({
  title,
  fixedCostItems,
  variableCostItems,
  totalFixedCosts,
  totalVariablePercent,
}: Props) {
  const [simRevenue, setSimRevenue] = useState("100000");
  const [globalFixedReduction, setGlobalFixedReduction] = useState(0);
  const [globalVariableReduction, setGlobalVariableReduction] = useState(0);

  // Per-item reductions: { [id]: reduction percentage 0-100 }
  const [fixedItemReductions, setFixedItemReductions] = useState<Record<string, number>>({});
  const [variableItemReductions, setVariableItemReductions] = useState<Record<string, number>>({});

  const [showFixedDetails, setShowFixedDetails] = useState(false);
  const [showVariableDetails, setShowVariableDetails] = useState(false);

  // Reverse simulator
  const [reverseRevenue, setReverseRevenue] = useState("");
  const [targetProfit, setTargetProfit] = useState("0");
  const [cutMode, setCutMode] = useState<"fixed" | "variable" | "both">("both");

  const hasItemReductions = Object.values(fixedItemReductions).some(v => v > 0) ||
    Object.values(variableItemReductions).some(v => v > 0);

  // Adjusted values considering both global and per-item reductions
  const adjustedFixed = useMemo(() => {
    if (hasItemReductions) {
      // Per-item mode: apply individual reductions
      return fixedCostItems.reduce((sum, item) => {
        const reduction = fixedItemReductions[item.id] || 0;
        return sum + item.amount * (1 - reduction / 100);
      }, 0);
    }
    // Global mode
    return totalFixedCosts * (1 - globalFixedReduction / 100);
  }, [fixedCostItems, fixedItemReductions, totalFixedCosts, globalFixedReduction, hasItemReductions]);

  const adjustedVariablePercent = useMemo(() => {
    if (Object.values(variableItemReductions).some(v => v > 0)) {
      return variableCostItems.reduce((sum, item) => {
        const reduction = variableItemReductions[item.id] || 0;
        return sum + item.percentage * (1 - reduction / 100);
      }, 0);
    }
    return totalVariablePercent * (1 - globalVariableReduction / 100);
  }, [variableCostItems, variableItemReductions, totalVariablePercent, globalVariableReduction]);

  const revenue = parseFloat(simRevenue) || 0;
  const variableCostsAmount = revenue * (adjustedVariablePercent / 100);
  const profit = revenue - variableCostsAmount - adjustedFixed;
  const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const contributionMarginPercent = 100 - totalVariablePercent;
  const breakEven = contributionMarginPercent > 0 ? totalFixedCosts / (contributionMarginPercent / 100) : 0;
  const adjustedContrib = 100 - adjustedVariablePercent;
  const adjustedBreakEven = adjustedContrib > 0 ? adjustedFixed / (adjustedContrib / 100) : 0;
  const totalSavings = totalFixedCosts - adjustedFixed;

  const resetAll = () => {
    setGlobalFixedReduction(0);
    setGlobalVariableReduction(0);
    setFixedItemReductions({});
    setVariableItemReductions({});
  };

  // Group fixed items by category for per-item view
  const groupedFixed = useMemo(() => {
    const map = new Map<string, FixedCostItem[]>();
    fixedCostItems.forEach(item => {
      const cat = item.category || "Outros";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [fixedCostItems]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          {(globalFixedReduction > 0 || globalVariableReduction > 0 || hasItemReductions) && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={resetAll}>
              <RotateCcw className="h-3 w-3" /> Resetar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Revenue */}
        <div>
          <Label className="text-xs font-medium">Faturamento Mensal (R$)</Label>
          <Input
            type="number"
            value={simRevenue}
            onChange={e => setSimRevenue(e.target.value)}
            className="h-10 text-lg font-bold"
          />
        </div>

        {/* Global sliders */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <Label className="text-xs font-medium">Redução Global de Fixos: {globalFixedReduction}%</Label>
            <Slider
              value={[globalFixedReduction]}
              onValueChange={v => {
                setGlobalFixedReduction(v[0]);
                setFixedItemReductions({}); // clear per-item when using global
              }}
              max={50}
              step={1}
            />
            <p className="text-[10px] text-muted-foreground">
              De {fmt(totalFixedCosts)} para {fmt(totalFixedCosts * (1 - globalFixedReduction / 100))}
            </p>
          </div>
          <div className="space-y-3">
            <Label className="text-xs font-medium">Redução Global de Variáveis: {globalVariableReduction}%</Label>
            <Slider
              value={[globalVariableReduction]}
              onValueChange={v => {
                setGlobalVariableReduction(v[0]);
                setVariableItemReductions({});
              }}
              max={50}
              step={1}
            />
            <p className="text-[10px] text-muted-foreground">
              De {fmtPct(totalVariablePercent)} para {fmtPct(totalVariablePercent * (1 - globalVariableReduction / 100))}
            </p>
          </div>
        </div>

        {/* Per-item fixed cost reductions */}
        {fixedCostItems.length > 0 && (
          <Collapsible open={showFixedDetails} onOpenChange={setShowFixedDetails}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
                <DollarSign className="h-3.5 w-3.5" />
                {showFixedDetails ? "Ocultar" : "Simular"} redução por custo fixo
                {Object.values(fixedItemReductions).filter(v => v > 0).length > 0 && (
                  <Badge variant="secondary" className="text-[10px] ml-1">
                    {Object.values(fixedItemReductions).filter(v => v > 0).length} ajustado(s)
                  </Badge>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              {groupedFixed.map(([category, items]) => (
                <div key={category} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{category}</p>
                  {items.filter(item => item.amount > 0).map(item => {
                    const reduction = fixedItemReductions[item.id] || 0;
                    const adjusted = item.amount * (1 - reduction / 100);
                    return (
                      <div key={item.id} className="flex items-center gap-3 pl-2">
                        <span className="text-xs min-w-[140px] truncate">{item.name}</span>
                        <span className="text-xs text-muted-foreground w-[80px] text-right">{fmt(item.amount)}</span>
                        <Slider
                          value={[reduction]}
                          onValueChange={v => {
                            setFixedItemReductions(prev => ({ ...prev, [item.id]: v[0] }));
                            setGlobalFixedReduction(0);
                          }}
                          max={100}
                          step={5}
                          className="flex-1"
                        />
                        <span className="text-xs font-medium w-[40px] text-right">
                          {reduction > 0 ? `-${reduction}%` : "—"}
                        </span>
                        {reduction > 0 && (
                          <span className="text-xs text-primary w-[80px] text-right">{fmt(adjusted)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {totalSavings > 0 && hasItemReductions && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Minus className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-bold text-primary">Economia em fixos: {fmt(totalSavings)}</span>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Per-item variable cost reductions */}
        {variableCostItems.length > 0 && (
          <Collapsible open={showVariableDetails} onOpenChange={setShowVariableDetails}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
                <Percent className="h-3.5 w-3.5" />
                {showVariableDetails ? "Ocultar" : "Simular"} redução por custo variável
                {Object.values(variableItemReductions).filter(v => v > 0).length > 0 && (
                  <Badge variant="secondary" className="text-[10px] ml-1">
                    {Object.values(variableItemReductions).filter(v => v > 0).length} ajustado(s)
                  </Badge>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-2">
              {variableCostItems.map(item => {
                const reduction = variableItemReductions[item.id] || 0;
                const adjusted = item.percentage * (1 - reduction / 100);
                return (
                  <div key={item.id} className="flex items-center gap-3 pl-2">
                    <span className="text-xs min-w-[140px] truncate">{item.description}</span>
                    <span className="text-xs text-muted-foreground w-[60px] text-right">{fmtPct(item.percentage)}</span>
                    <Slider
                      value={[reduction]}
                      onValueChange={v => {
                        setVariableItemReductions(prev => ({ ...prev, [item.id]: v[0] }));
                        setGlobalVariableReduction(0);
                      }}
                      max={100}
                      step={5}
                      className="flex-1"
                    />
                    <span className="text-xs font-medium w-[40px] text-right">
                      {reduction > 0 ? `-${reduction}%` : "—"}
                    </span>
                    {reduction > 0 && (
                      <span className="text-xs text-primary w-[60px] text-right">{fmtPct(adjusted)}</span>
                    )}
                  </div>
                );
              })}
              {Object.values(variableItemReductions).some(v => v > 0) && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Minus className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-bold text-primary">
                    De {fmtPct(totalVariablePercent)} para {fmtPct(adjustedVariablePercent)}
                  </span>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Results */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 border-t">
          <div className="p-3 rounded-lg bg-muted/50 space-y-1">
            <p className="text-[10px] text-muted-foreground">Faturamento</p>
            <p className="text-lg font-bold">{fmt(revenue)}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 space-y-1">
            <p className="text-[10px] text-muted-foreground">Custos Variáveis</p>
            <p className="text-lg font-bold text-orange-500">- {fmt(variableCostsAmount)}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 space-y-1">
            <p className="text-[10px] text-muted-foreground">Custos Fixos</p>
            <p className="text-lg font-bold text-destructive">- {fmt(adjustedFixed)}</p>
          </div>
          <div className={`p-3 rounded-lg space-y-1 ${profit >= 0 ? "bg-green-500/10 border border-green-500/20" : "bg-destructive/10 border border-destructive/20"}`}>
            <p className="text-[10px] text-muted-foreground">Lucro Líquido</p>
            <p className={`text-lg font-bold ${profit >= 0 ? "text-green-500" : "text-destructive"}`}>{fmt(profit)}</p>
            <p className="text-[10px] text-muted-foreground">Margem: {fmtPct(profitMargin)}</p>
          </div>
        </div>

        {/* Break-even */}
        <div className="p-4 rounded-lg border space-y-2">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Ponto de Equilíbrio</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground">Atual</p>
              <p className="text-lg font-bold">{fmt(breakEven)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Com reduções</p>
              <p className="text-lg font-bold text-primary">{fmt(adjustedBreakEven)}</p>
              {adjustedBreakEven < breakEven && (
                <p className="text-[10px] text-green-500">↓ {fmt(breakEven - adjustedBreakEven)} a menos</p>
              )}
            </div>
          </div>
        </div>

        {/* Revenue scenarios */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Cenários de Faturamento</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[50000, 80000, 100000, 120000, 150000, 200000, 250000, 300000].map(rev => {
              const vc = rev * (adjustedVariablePercent / 100);
              const p = rev - vc - adjustedFixed;
              return (
                <button
                  key={rev}
                  onClick={() => setSimRevenue(String(rev))}
                  className={`p-2 rounded-lg border text-xs text-left transition-all hover:border-primary/50 ${
                    parseFloat(simRevenue) === rev ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <p className="text-muted-foreground">{fmt(rev)}</p>
                  <p className={`font-bold ${p >= 0 ? "text-green-500" : "text-destructive"}`}>{fmt(p)}</p>
                  <p className="text-[10px] text-muted-foreground">{rev > 0 ? fmtPct((p / rev) * 100) : "—"}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Reverse Simulator */}
        <Separator />
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Simulador Reverso — Quanto preciso cortar?</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-medium">Faturamento Previsto (R$)</Label>
              <Input
                type="number"
                value={reverseRevenue}
                onChange={e => setReverseRevenue(e.target.value)}
                placeholder="Ex: 80000"
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Lucro Esperado (R$)</Label>
              <Input
                type="number"
                value={targetProfit}
                onChange={e => setTargetProfit(e.target.value)}
                placeholder="0 = empatar"
                className="h-9"
              />
            </div>
          </div>

          {/* Cut mode selector */}
          <div className="flex gap-2">
            {([
              { key: "fixed" as const, label: "Cortar Custo Fixo", icon: DollarSign },
              { key: "variable" as const, label: "Cortar Custo Variável", icon: Percent },
              { key: "both" as const, label: "Cortar Ambos", icon: ArrowDownToLine },
            ]).map(opt => (
              <Button
                key={opt.key}
                variant={cutMode === opt.key ? "default" : "outline"}
                size="sm"
                className="gap-1.5 text-xs flex-1"
                onClick={() => setCutMode(opt.key)}
              >
                <opt.icon className="h-3.5 w-3.5" />
                {opt.label}
              </Button>
            ))}
          </div>

          {(() => {
            const revRev = parseFloat(reverseRevenue) || 0;
            const profitGoal = parseFloat(targetProfit) || 0;
            if (revRev <= 0) return (
              <p className="text-xs text-muted-foreground text-center py-4">
                Digite o faturamento previsto para ver o resultado.
              </p>
            );

            const currentVarCost = revRev * (totalVariablePercent / 100);
            const currentProfit = revRev - currentVarCost - totalFixedCosts;
            const gap = profitGoal - currentProfit;

            if (gap <= 0) {
              return (
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-bold text-green-500">Meta já atingida!</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-2">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Lucro projetado</p>
                        <p className="text-lg font-bold text-green-500">{fmt(currentProfit)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Margem líquida</p>
                        <p className="text-lg font-bold">{fmtPct((currentProfit / revRev) * 100)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Sobra da meta</p>
                        <p className="text-lg font-bold text-green-500">+{fmt(Math.abs(gap))}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            // Current situation card
            const situationCard = (
              <Card className="border-destructive/20">
                <CardContent className="pt-4 pb-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Lucro atual projetado</p>
                      <p className="text-lg font-bold text-destructive">{fmt(currentProfit)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Meta de lucro</p>
                      <p className="text-lg font-bold">{fmt(profitGoal)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Precisa cortar</p>
                      <p className="text-lg font-bold text-destructive">{fmt(gap)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );

            if (cutMode === "fixed") {
              const newFixed = totalFixedCosts - gap;
              const possible = newFixed >= 0;
              const reductionPct = totalFixedCosts > 0 ? (gap / totalFixedCosts) * 100 : 0;
              return (
                <div className="space-y-3">
                  {situationCard}
                  <Card className={possible ? "border-primary/30" : "border-destructive/30"}>
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <span className="text-sm font-bold">Resultado: Cortar Custos Fixos</span>
                      </div>
                      {possible ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-[10px] text-muted-foreground">Custo fixo atual</p>
                            <p className="text-lg font-bold">{fmt(totalFixedCosts)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                            <p className="text-[10px] text-muted-foreground">Cortar</p>
                            <p className="text-lg font-bold text-destructive">- {fmt(gap)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                            <p className="text-[10px] text-muted-foreground">Novo custo fixo</p>
                            <p className="text-lg font-bold text-primary">{fmt(newFixed)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-[10px] text-muted-foreground">Redução de</p>
                            <p className="text-lg font-bold">{fmtPct(reductionPct)}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-destructive">
                          Inviável — o corte de {fmt(gap)} excede o total de custos fixos ({fmt(totalFixedCosts)}).
                          Considere cortar variáveis também.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            }

            if (cutMode === "variable") {
              const newVarPct = revRev > 0 ? ((revRev - profitGoal - totalFixedCosts) / revRev) * 100 : 0;
              const varCutInReais = revRev * ((totalVariablePercent - newVarPct) / 100);
              const possible = newVarPct >= 0 && newVarPct <= totalVariablePercent;
              const reductionPct = totalVariablePercent > 0 ? ((totalVariablePercent - newVarPct) / totalVariablePercent) * 100 : 0;
              return (
                <div className="space-y-3">
                  {situationCard}
                  <Card className={possible ? "border-primary/30" : "border-destructive/30"}>
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-primary" />
                        <span className="text-sm font-bold">Resultado: Cortar Custos Variáveis</span>
                      </div>
                      {possible ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-[10px] text-muted-foreground">Variável atual</p>
                            <p className="text-lg font-bold">{fmtPct(totalVariablePercent)}</p>
                            <p className="text-[10px] text-muted-foreground">({fmt(currentVarCost)})</p>
                          </div>
                          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                            <p className="text-[10px] text-muted-foreground">Cortar</p>
                            <p className="text-lg font-bold text-destructive">- {fmtPct(totalVariablePercent - newVarPct)}</p>
                            <p className="text-[10px] text-muted-foreground">(- {fmt(varCutInReais)})</p>
                          </div>
                          <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                            <p className="text-[10px] text-muted-foreground">Novo variável</p>
                            <p className="text-lg font-bold text-primary">{fmtPct(newVarPct)}</p>
                            <p className="text-[10px] text-muted-foreground">({fmt(revRev * (newVarPct / 100))})</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-[10px] text-muted-foreground">Redução de</p>
                            <p className="text-lg font-bold">{fmtPct(reductionPct)}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-destructive">
                          Inviável — não é possível atingir a meta cortando apenas variáveis.
                          Considere cortar fixos também.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            }

            // Both mode - split proportionally
            const totalCostValue = totalFixedCosts + currentVarCost;
            const fixedShare = totalCostValue > 0 ? totalFixedCosts / totalCostValue : 0.5;
            const varShare = 1 - fixedShare;
            const fixedCut = gap * fixedShare;
            const varCut = gap * varShare;
            const newFixedBoth = totalFixedCosts - fixedCut;
            const newVarCostBoth = currentVarCost - varCut;
            const newVarPctBoth = revRev > 0 ? (newVarCostBoth / revRev) * 100 : 0;
            const possibleBoth = newFixedBoth >= 0 && newVarPctBoth >= 0;
            const fixedReductionPct = totalFixedCosts > 0 ? (fixedCut / totalFixedCosts) * 100 : 0;
            const varReductionPct = totalVariablePercent > 0 ? ((totalVariablePercent - newVarPctBoth) / totalVariablePercent) * 100 : 0;

            return (
              <div className="space-y-3">
                {situationCard}
                <Card className={possibleBoth ? "border-primary/30" : "border-destructive/30"}>
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <ArrowDownToLine className="h-4 w-4 text-primary" />
                      <span className="text-sm font-bold">Resultado: Cortar Ambos (proporcional)</span>
                      <Badge variant="secondary" className="text-[9px]">
                        Fixo {fmtPct(fixedShare * 100)} / Var {fmtPct(varShare * 100)}
                      </Badge>
                    </div>
                    {possibleBoth ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                            <p className="text-[10px] text-muted-foreground">Cortar em fixos</p>
                            <p className="text-lg font-bold text-destructive">- {fmt(fixedCut)}</p>
                            <p className="text-[10px] text-muted-foreground">(-{fmtPct(fixedReductionPct)})</p>
                          </div>
                          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                            <p className="text-[10px] text-muted-foreground">Cortar em variáveis</p>
                            <p className="text-lg font-bold text-destructive">- {fmt(varCut)}</p>
                            <p className="text-[10px] text-muted-foreground">(-{fmtPct(varReductionPct)})</p>
                          </div>
                          <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                            <p className="text-[10px] text-muted-foreground">Corte total</p>
                            <p className="text-lg font-bold text-primary">{fmt(gap)}</p>
                          </div>
                        </div>
                        <Separator />
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-[10px] text-muted-foreground">Custo fixo: {fmt(totalFixedCosts)} →</p>
                            <p className="text-sm font-bold text-primary">{fmt(newFixedBoth)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <p className="text-[10px] text-muted-foreground">Custo variável: {fmtPct(totalVariablePercent)} →</p>
                            <p className="text-sm font-bold text-primary">{fmtPct(newVarPctBoth)}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-destructive">
                        Inviável — o corte de {fmt(gap)} excede a soma dos custos. Revise o faturamento ou a meta de lucro.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
}
