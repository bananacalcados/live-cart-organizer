import { useState, useEffect, useMemo } from "react";
import {
  Calculator, Plus, Trash2, Save, Loader2, Building2, Pencil,
  TrendingUp, AlertTriangle, DollarSign, Percent, Target, BarChart3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  stores: { id: string; name: string }[];
}

interface FixedCost {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sort_order: number | null;
}

interface StoreFixedCost {
  id: string;
  fixed_cost_id: string;
  store_id: string;
  amount: number;
  is_active: boolean;
}

interface VariableCost {
  id: string;
  store_id: string;
  description: string;
  percentage: number;
  is_active: boolean;
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number) => `${v.toFixed(2)}%`;

export function MarginFormation({ stores }: Props) {
  const [selectedStore, setSelectedStore] = useState<string>(stores[0]?.id || "");
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [storeFixedCosts, setStoreFixedCosts] = useState<StoreFixedCost[]>([]);
  const [variableCosts, setVariableCosts] = useState<VariableCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Master list management
  const [showAddFixed, setShowAddFixed] = useState(false);
  const [newFixed, setNewFixed] = useState({ name: "", description: "", category: "" });
  const [editingFixed, setEditingFixed] = useState<FixedCost | null>(null);

  // Variable costs
  const [showAddVariable, setShowAddVariable] = useState(false);
  const [newVariable, setNewVariable] = useState({ description: "", percentage: "" });

  // Simulator
  const [simRevenue, setSimRevenue] = useState("100000");
  const [simFixedReduction, setSimFixedReduction] = useState(0);
  const [simVariableReduction, setSimVariableReduction] = useState(0);

  useEffect(() => {
    loadData();
  }, [selectedStore]);

  const loadData = async () => {
    setLoading(true);
    const [fcRes, sfcRes, vcRes] = await Promise.all([
      supabase.from("cost_center_fixed_costs").select("*").order("sort_order"),
      supabase.from("cost_center_store_fixed_costs").select("*").eq("store_id", selectedStore),
      supabase.from("cost_center_variable_costs").select("*").eq("store_id", selectedStore),
    ]);
    setFixedCosts((fcRes.data || []) as FixedCost[]);
    setStoreFixedCosts((sfcRes.data || []) as StoreFixedCost[]);
    setVariableCosts((vcRes.data || []) as VariableCost[]);
    setLoading(false);
  };

  // Group fixed costs by category
  const groupedFixedCosts = useMemo(() => {
    const map = new Map<string, FixedCost[]>();
    fixedCosts.forEach(fc => {
      const cat = fc.category || "Outros";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(fc);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [fixedCosts]);

  const getStoreAmount = (fixedCostId: string) => {
    const sfc = storeFixedCosts.find(s => s.fixed_cost_id === fixedCostId);
    return sfc?.amount ?? 0;
  };

  const isStoreActive = (fixedCostId: string) => {
    const sfc = storeFixedCosts.find(s => s.fixed_cost_id === fixedCostId);
    return sfc?.is_active ?? false;
  };

  const toggleStoreFixedCost = async (fixedCostId: string) => {
    const existing = storeFixedCosts.find(s => s.fixed_cost_id === fixedCostId);
    if (existing) {
      await supabase.from("cost_center_store_fixed_costs").update({ is_active: !existing.is_active }).eq("id", existing.id);
    } else {
      await supabase.from("cost_center_store_fixed_costs").insert({
        fixed_cost_id: fixedCostId,
        store_id: selectedStore,
        amount: 0,
        is_active: true,
      });
    }
    loadData();
  };

  const updateStoreAmount = async (fixedCostId: string, amount: number) => {
    const existing = storeFixedCosts.find(s => s.fixed_cost_id === fixedCostId);
    if (existing) {
      await supabase.from("cost_center_store_fixed_costs").update({ amount }).eq("id", existing.id);
    } else {
      await supabase.from("cost_center_store_fixed_costs").insert({
        fixed_cost_id: fixedCostId,
        store_id: selectedStore,
        amount,
        is_active: true,
      });
    }
    loadData();
  };

  // Master list CRUD
  const addFixedCost = async () => {
    if (!newFixed.name.trim()) return;
    await supabase.from("cost_center_fixed_costs").insert({
      name: newFixed.name,
      description: newFixed.description || null,
      category: newFixed.category || null,
      sort_order: fixedCosts.length + 1,
    });
    setNewFixed({ name: "", description: "", category: "" });
    setShowAddFixed(false);
    loadData();
    toast.success("Custo fixo adicionado!");
  };

  const updateFixedCost = async () => {
    if (!editingFixed) return;
    await supabase.from("cost_center_fixed_costs").update({
      name: editingFixed.name,
      description: editingFixed.description,
      category: editingFixed.category,
    }).eq("id", editingFixed.id);
    setEditingFixed(null);
    loadData();
    toast.success("Custo fixo atualizado!");
  };

  const deleteFixedCost = async (id: string) => {
    await supabase.from("cost_center_store_fixed_costs").delete().eq("fixed_cost_id", id);
    await supabase.from("cost_center_fixed_costs").delete().eq("id", id);
    loadData();
    toast.success("Custo fixo removido!");
  };

  // Variable costs
  const addVariableCost = async () => {
    if (!newVariable.description.trim() || !newVariable.percentage) return;
    await supabase.from("cost_center_variable_costs").insert({
      store_id: selectedStore,
      description: newVariable.description,
      percentage: parseFloat(newVariable.percentage) || 0,
    });
    setNewVariable({ description: "", percentage: "" });
    setShowAddVariable(false);
    loadData();
    toast.success("Custo variável adicionado!");
  };

  const deleteVariableCost = async (id: string) => {
    await supabase.from("cost_center_variable_costs").delete().eq("id", id);
    loadData();
  };

  // Calculations
  const totalFixedCosts = useMemo(() => {
    return storeFixedCosts.filter(s => s.is_active).reduce((sum, s) => sum + s.amount, 0);
  }, [storeFixedCosts]);

  const totalVariablePercent = useMemo(() => {
    return variableCosts.filter(v => v.is_active).reduce((sum, v) => sum + v.percentage, 0);
  }, [variableCosts]);

  // Break-even: Revenue where profit = 0
  // Profit = Revenue - (Revenue * variablePercent/100) - FixedCosts = 0
  // Revenue * (1 - variablePercent/100) = FixedCosts
  // Revenue = FixedCosts / (1 - variablePercent/100)
  const contributionMarginPercent = 100 - totalVariablePercent;
  const breakEven = contributionMarginPercent > 0
    ? totalFixedCosts / (contributionMarginPercent / 100)
    : 0;

  // Simulator calculations
  const revenue = parseFloat(simRevenue) || 0;
  const adjustedFixed = totalFixedCosts * (1 - simFixedReduction / 100);
  const adjustedVariablePercent = totalVariablePercent * (1 - simVariableReduction / 100);
  const variableCostsAmount = revenue * (adjustedVariablePercent / 100);
  const profit = revenue - variableCostsAmount - adjustedFixed;
  const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const adjustedBreakEven = (100 - adjustedVariablePercent) > 0
    ? adjustedFixed / ((100 - adjustedVariablePercent) / 100)
    : 0;

  const storeName = stores.find(s => s.id === selectedStore)?.name || "Loja";

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Store selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-bold">Formação de Margem</h3>
        </div>
        <Select value={selectedStore} onValueChange={setSelectedStore}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
          <SelectContent>
            {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Custos Fixos/mês</span>
              <DollarSign className="h-3.5 w-3.5 text-destructive" />
            </div>
            <p className="text-lg font-bold text-destructive">{fmt(totalFixedCosts)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Custos Variáveis</span>
              <Percent className="h-3.5 w-3.5 text-orange-500" />
            </div>
            <p className="text-lg font-bold">{fmtPct(totalVariablePercent)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Margem de Contribuição</span>
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold text-primary">{fmtPct(contributionMarginPercent)}</p>
          </CardContent>
        </Card>
        <Card className="border-primary">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Ponto de Equilíbrio</span>
              <Target className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold text-primary">{fmt(breakEven)}</p>
            <p className="text-[10px] text-muted-foreground">faturamento mínimo/mês</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="fixed" className="space-y-4">
        <TabsList>
          <TabsTrigger value="fixed">Custos Fixos</TabsTrigger>
          <TabsTrigger value="variable">Custos Variáveis</TabsTrigger>
          <TabsTrigger value="simulator">Simulador de Lucro</TabsTrigger>
        </TabsList>

        {/* Fixed Costs */}
        <TabsContent value="fixed" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Selecione quais custos fixos se aplicam a <strong>{storeName}</strong> e informe o valor mensal.
            </p>
            <Button size="sm" className="gap-1" onClick={() => setShowAddFixed(true)}>
              <Plus className="h-3.5 w-3.5" /> Novo Custo Fixo
            </Button>
          </div>

          {groupedFixedCosts.map(([category, costs]) => (
            <Card key={category}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{category}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Ativo</TableHead>
                      <TableHead>Custo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="w-[140px]">Valor (R$/mês)</TableHead>
                      <TableHead className="w-20">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costs.map(fc => {
                      const active = isStoreActive(fc.id);
                      const amount = getStoreAmount(fc.id);
                      return (
                        <TableRow key={fc.id} className={active ? "" : "opacity-50"}>
                          <TableCell>
                            <Checkbox checked={active} onCheckedChange={() => toggleStoreFixedCost(fc.id)} />
                          </TableCell>
                          <TableCell className="font-medium text-xs">{fc.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fc.description || "—"}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={amount || ""}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                // Update locally for responsiveness
                                setStoreFixedCosts(prev => {
                                  const idx = prev.findIndex(s => s.fixed_cost_id === fc.id);
                                  if (idx >= 0) {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], amount: val };
                                    return next;
                                  }
                                  return [...prev, { id: 'temp', fixed_cost_id: fc.id, store_id: selectedStore, amount: val, is_active: true }];
                                });
                              }}
                              onBlur={e => updateStoreAmount(fc.id, parseFloat(e.target.value) || 0)}
                              className="h-7 text-xs w-full"
                              disabled={!active}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingFixed(fc)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteFixedCost(fc.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}

          {/* Add Fixed Cost Dialog */}
          <Dialog open={showAddFixed} onOpenChange={setShowAddFixed}>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo Custo Fixo</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Nome *</Label>
                  <Input value={newFixed.name} onChange={e => setNewFixed(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Aluguel" className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">Descrição</Label>
                  <Input value={newFixed.description} onChange={e => setNewFixed(p => ({ ...p, description: e.target.value }))} className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">Categoria</Label>
                  <Input value={newFixed.category} onChange={e => setNewFixed(p => ({ ...p, category: e.target.value }))} placeholder="Ex: Imóvel, Pessoal, Operacional" className="h-9" />
                </div>
                <Button className="w-full" onClick={addFixedCost}>Adicionar</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Edit Fixed Cost Dialog */}
          <Dialog open={!!editingFixed} onOpenChange={v => { if (!v) setEditingFixed(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Editar Custo Fixo</DialogTitle></DialogHeader>
              {editingFixed && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Nome</Label>
                    <Input value={editingFixed.name} onChange={e => setEditingFixed(p => p ? { ...p, name: e.target.value } : p)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Descrição</Label>
                    <Input value={editingFixed.description || ""} onChange={e => setEditingFixed(p => p ? { ...p, description: e.target.value } : p)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Categoria</Label>
                    <Input value={editingFixed.category || ""} onChange={e => setEditingFixed(p => p ? { ...p, category: e.target.value } : p)} className="h-9" />
                  </div>
                  <Button className="w-full" onClick={updateFixedCost}>Salvar</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Variable Costs */}
        <TabsContent value="variable" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Custos variáveis de <strong>{storeName}</strong> — percentuais sobre o faturamento.
            </p>
            <Button size="sm" className="gap-1" onClick={() => setShowAddVariable(true)}>
              <Plus className="h-3.5 w-3.5" /> Novo Custo Variável
            </Button>
          </div>

          <Card>
            <CardContent className="pt-4">
              {variableCosts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">Nenhum custo variável cadastrado.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right w-[100px]">% do Faturamento</TableHead>
                      <TableHead className="w-16">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variableCosts.map(vc => (
                      <TableRow key={vc.id}>
                        <TableCell className="font-medium text-xs">{vc.description}</TableCell>
                        <TableCell className="text-right font-bold text-xs">{fmtPct(vc.percentage)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteVariableCost(vc.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell className="font-bold text-xs">TOTAL</TableCell>
                      <TableCell className="text-right font-bold text-primary text-xs">{fmtPct(totalVariablePercent)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Dialog open={showAddVariable} onOpenChange={setShowAddVariable}>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo Custo Variável</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Descrição *</Label>
                  <Input value={newVariable.description} onChange={e => setNewVariable(p => ({ ...p, description: e.target.value }))} placeholder="Ex: Imposto sobre vendas (Simples)" className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">Percentual (% sobre faturamento) *</Label>
                  <Input type="number" step="0.01" value={newVariable.percentage} onChange={e => setNewVariable(p => ({ ...p, percentage: e.target.value }))} placeholder="Ex: 6.00" className="h-9" />
                </div>
                <Button className="w-full" onClick={addVariableCost}>Adicionar</Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Simulator */}
        <TabsContent value="simulator" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calculator className="h-4 w-4 text-primary" />
                Simulador de Lucro — {storeName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Revenue input */}
              <div>
                <Label className="text-xs font-medium">Faturamento Mensal (R$)</Label>
                <Input
                  type="number"
                  value={simRevenue}
                  onChange={e => setSimRevenue(e.target.value)}
                  className="h-10 text-lg font-bold"
                />
              </div>

              {/* Reduction sliders */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label className="text-xs font-medium">Redução de Custos Fixos: {simFixedReduction}%</Label>
                  <Slider
                    value={[simFixedReduction]}
                    onValueChange={v => setSimFixedReduction(v[0])}
                    max={50}
                    step={1}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    De {fmt(totalFixedCosts)} para {fmt(adjustedFixed)} (economia de {fmt(totalFixedCosts - adjustedFixed)})
                  </p>
                </div>
                <div className="space-y-3">
                  <Label className="text-xs font-medium">Redução de Custos Variáveis: {simVariableReduction}%</Label>
                  <Slider
                    value={[simVariableReduction]}
                    onValueChange={v => setSimVariableReduction(v[0])}
                    max={50}
                    step={1}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    De {fmtPct(totalVariablePercent)} para {fmtPct(adjustedVariablePercent)}
                  </p>
                </div>
              </div>

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

              {/* Break-even comparison */}
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
