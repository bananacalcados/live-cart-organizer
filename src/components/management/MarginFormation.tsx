import { useState, useEffect, useMemo } from "react";
import {
  Calculator, Plus, Trash2, Save, Loader2, Building2, Pencil,
  TrendingUp, AlertTriangle, DollarSign, Percent, Target, BarChart3, Copy, Share2
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
  max_budget: number | null;
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

interface DraftVariableCost {
  tempId: string;
  description: string;
  percentage: string;
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number) => `${v.toFixed(2)}%`;

export function MarginFormation({ stores }: Props) {
  const [selectedStore, setSelectedStore] = useState<string>(stores[0]?.id || "");
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [storeFixedCosts, setStoreFixedCosts] = useState<StoreFixedCost[]>([]);
  const [variableCosts, setVariableCosts] = useState<VariableCost[]>([]);
  const [loading, setLoading] = useState(true);

  // Consolidated view
  const [allStoreFixedCosts, setAllStoreFixedCosts] = useState<StoreFixedCost[]>([]);
  const [allVariableCosts, setAllVariableCosts] = useState<VariableCost[]>([]);
  const [consolidatedLoading, setConsolidatedLoading] = useState(false);

  const loadConsolidated = async () => {
    setConsolidatedLoading(true);
    const [sfcRes, vcRes] = await Promise.all([
      supabase.from("cost_center_store_fixed_costs").select("*"),
      supabase.from("cost_center_variable_costs").select("*"),
    ]);
    setAllStoreFixedCosts((sfcRes.data || []) as StoreFixedCost[]);
    setAllVariableCosts((vcRes.data || []) as VariableCost[]);
    setConsolidatedLoading(false);
  };

  // Load consolidated data on mount
  useEffect(() => { loadConsolidated(); }, []);

  const saving = false; // kept for interface compat

  // Master list management
  const [showAddFixed, setShowAddFixed] = useState(false);
  const [newFixed, setNewFixed] = useState({ name: "", description: "", category: "" });
  const [editingFixed, setEditingFixed] = useState<FixedCost | null>(null);

  // Variable costs - batch drafts
  const [drafts, setDrafts] = useState<DraftVariableCost[]>([]);
  const [savingDrafts, setSavingDrafts] = useState(false);

  // Share variable costs dialog
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTargetStore, setShareTargetStore] = useState("");
  const [shareItems, setShareItems] = useState<{ id: string; description: string; percentage: string; selected: boolean }[]>([]);
  const [savingShare, setSavingShare] = useState(false);

  // Simulator
  const [simRevenue, setSimRevenue] = useState("100000");
  const [simFixedReduction, setSimFixedReduction] = useState(0);
  const [simVariableReduction, setSimVariableReduction] = useState(0);

  // Track dirty fixed cost amounts for batch save
  const [dirtyFixedAmounts, setDirtyFixedAmounts] = useState<Map<string, number>>(new Map());

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
    setDirtyFixedAmounts(new Map());
    setDrafts([]);
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
    if (dirtyFixedAmounts.has(fixedCostId)) return dirtyFixedAmounts.get(fixedCostId)!;
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
      const newActive = !existing.is_active;
      // Update locally first
      setStoreFixedCosts(prev => prev.map(s => s.id === existing.id ? { ...s, is_active: newActive } : s));
      await supabase.from("cost_center_store_fixed_costs").update({ is_active: newActive }).eq("id", existing.id);
    } else {
      const tempItem: StoreFixedCost = { id: crypto.randomUUID(), fixed_cost_id: fixedCostId, store_id: selectedStore, amount: 0, is_active: true };
      setStoreFixedCosts(prev => [...prev, tempItem]);
      const { data } = await supabase.from("cost_center_store_fixed_costs").insert({
        fixed_cost_id: fixedCostId, store_id: selectedStore, amount: 0, is_active: true,
      }).select().single();
      if (data) {
        setStoreFixedCosts(prev => prev.map(s => s.id === tempItem.id ? { ...data } as StoreFixedCost : s));
      }
    }
  };

  const updateStoreAmountLocal = (fixedCostId: string, amount: number) => {
    setDirtyFixedAmounts(prev => new Map(prev).set(fixedCostId, amount));
    setStoreFixedCosts(prev => {
      const idx = prev.findIndex(s => s.fixed_cost_id === fixedCostId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], amount };
        return next;
      }
      return [...prev, { id: 'temp-' + fixedCostId, fixed_cost_id: fixedCostId, store_id: selectedStore, amount, is_active: true }];
    });
  };

  const saveFixedAmountOnBlur = async (fixedCostId: string) => {
    const amount = dirtyFixedAmounts.get(fixedCostId);
    if (amount === undefined) return;
    const existing = storeFixedCosts.find(s => s.fixed_cost_id === fixedCostId);
    if (existing && !existing.id.startsWith('temp-')) {
      await supabase.from("cost_center_store_fixed_costs").update({ amount }).eq("id", existing.id);
    } else {
      const { data } = await supabase.from("cost_center_store_fixed_costs").insert({
        fixed_cost_id: fixedCostId, store_id: selectedStore, amount, is_active: true,
      }).select().single();
      if (data) {
        setStoreFixedCosts(prev => prev.map(s => s.fixed_cost_id === fixedCostId ? { ...data } as StoreFixedCost : s));
      }
    }
    setDirtyFixedAmounts(prev => {
      const next = new Map(prev);
      next.delete(fixedCostId);
      return next;
    });
  };

  // Master list CRUD
  const addFixedCost = async () => {
    if (!newFixed.name.trim()) return;
    const { data } = await supabase.from("cost_center_fixed_costs").insert({
      name: newFixed.name, description: newFixed.description || null,
      category: newFixed.category || null, sort_order: fixedCosts.length + 1,
    }).select().single();
    if (data) setFixedCosts(prev => [...prev, data as FixedCost]);
    setNewFixed({ name: "", description: "", category: "" });
    setShowAddFixed(false);
    toast.success("Custo fixo adicionado!");
  };

  const updateFixedCost = async () => {
    if (!editingFixed) return;
    await supabase.from("cost_center_fixed_costs").update({
      name: editingFixed.name, description: editingFixed.description, category: editingFixed.category,
    }).eq("id", editingFixed.id);
    setFixedCosts(prev => prev.map(fc => fc.id === editingFixed.id ? editingFixed : fc));
    setEditingFixed(null);
    toast.success("Custo fixo atualizado!");
  };

  const deleteFixedCost = async (id: string) => {
    await supabase.from("cost_center_store_fixed_costs").delete().eq("fixed_cost_id", id);
    await supabase.from("cost_center_fixed_costs").delete().eq("id", id);
    setFixedCosts(prev => prev.filter(fc => fc.id !== id));
    setStoreFixedCosts(prev => prev.filter(s => s.fixed_cost_id !== id));
    toast.success("Custo fixo removido!");
  };

  // Variable costs - drafts
  const addDraftRow = () => {
    setDrafts(prev => [...prev, { tempId: crypto.randomUUID(), description: "", percentage: "" }]);
  };

  const updateDraft = (tempId: string, field: "description" | "percentage", value: string) => {
    setDrafts(prev => prev.map(d => d.tempId === tempId ? { ...d, [field]: value } : d));
  };

  const removeDraft = (tempId: string) => {
    setDrafts(prev => prev.filter(d => d.tempId !== tempId));
  };

  const saveAllDrafts = async () => {
    const valid = drafts.filter(d => d.description.trim() && d.percentage);
    if (valid.length === 0) { toast.error("Preencha ao menos um custo variável."); return; }
    setSavingDrafts(true);
    const rows = valid.map(d => ({
      store_id: selectedStore,
      description: d.description.trim(),
      percentage: parseFloat(d.percentage) || 0,
    }));
    const { data, error } = await supabase.from("cost_center_variable_costs").insert(rows).select();
    if (error) { toast.error("Erro ao salvar: " + error.message); setSavingDrafts(false); return; }
    setVariableCosts(prev => [...prev, ...(data as VariableCost[])]);
    setDrafts([]);
    setSavingDrafts(false);
    toast.success(`${valid.length} custo(s) variável(is) adicionado(s)!`);
  };

  const deleteVariableCost = async (id: string) => {
    await supabase.from("cost_center_variable_costs").delete().eq("id", id);
    setVariableCosts(prev => prev.filter(vc => vc.id !== id));
    toast.success("Custo variável removido!");
  };

  // Share variable costs to another store
  const openShareDialog = () => {
    setShareItems(variableCosts.map(vc => ({
      id: vc.id, description: vc.description, percentage: String(vc.percentage), selected: true,
    })));
    setShareTargetStore("");
    setShareDialogOpen(true);
  };

  const saveSharedCosts = async () => {
    if (!shareTargetStore) { toast.error("Selecione a loja destino."); return; }
    const selected = shareItems.filter(s => s.selected);
    if (selected.length === 0) { toast.error("Selecione ao menos um custo."); return; }
    setSavingShare(true);
    const rows = selected.map(s => ({
      store_id: shareTargetStore,
      description: s.description,
      percentage: parseFloat(s.percentage) || 0,
    }));
    const { error } = await supabase.from("cost_center_variable_costs").insert(rows);
    if (error) { toast.error("Erro: " + error.message); setSavingShare(false); return; }
    setSavingShare(false);
    setShareDialogOpen(false);
    const targetName = stores.find(s => s.id === shareTargetStore)?.name || "outra loja";
    toast.success(`${selected.length} custo(s) copiado(s) para ${targetName}!`);
  };

  // Calculations
  const totalFixedCosts = useMemo(() => {
    return storeFixedCosts.filter(s => s.is_active).reduce((sum, s) => sum + s.amount, 0);
  }, [storeFixedCosts]);

  const totalVariablePercent = useMemo(() => {
    return variableCosts.filter(v => v.is_active).reduce((sum, v) => sum + v.percentage, 0);
  }, [variableCosts]);

  const contributionMarginPercent = 100 - totalVariablePercent;
  const breakEven = contributionMarginPercent > 0 ? totalFixedCosts / (contributionMarginPercent / 100) : 0;

  // Simulator calculations
  const revenue = parseFloat(simRevenue) || 0;
  const adjustedFixed = totalFixedCosts * (1 - simFixedReduction / 100);
  const adjustedVariablePercent = totalVariablePercent * (1 - simVariableReduction / 100);
  const variableCostsAmount = revenue * (adjustedVariablePercent / 100);
  const profit = revenue - variableCostsAmount - adjustedFixed;
  const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const adjustedBreakEven = (100 - adjustedVariablePercent) > 0 ? adjustedFixed / ((100 - adjustedVariablePercent) / 100) : 0;

  const storeName = stores.find(s => s.id === selectedStore)?.name || "Loja";
  const otherStores = stores.filter(s => s.id !== selectedStore);

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
          <TabsTrigger value="consolidated" onClick={() => loadConsolidated()}>Consolidado</TabsTrigger>
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

          {groupedFixedCosts.map(([category, costs]) => {
            // Calculate total spent in this category for this store
            const categoryTotal = costs.reduce((sum, fc) => {
              const sfc = storeFixedCosts.find(s => s.fixed_cost_id === fc.id);
              return sum + (sfc?.is_active ? (sfc.amount || 0) : 0);
            }, 0);
            // Get max_budget from the first cost in category that has it set (category-level budget)
            const categoryBudget = costs.reduce((budget, fc) => budget ?? fc.max_budget, null as number | null);
            const isOverBudget = categoryBudget !== null && categoryBudget > 0 && categoryTotal > categoryBudget;

            return (
            <Card key={category} className={isOverBudget ? 'border-destructive/50' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">{category}</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Verba máx:</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Sem limite"
                      value={categoryBudget ?? ""}
                      onChange={async (e) => {
                        const val = e.target.value ? parseFloat(e.target.value) : null;
                        // Update all costs in this category with the budget value
                        const ids = costs.map(fc => fc.id);
                        setFixedCosts(prev => prev.map(fc => ids.includes(fc.id) ? { ...fc, max_budget: val } : fc));
                        for (const id of ids) {
                          await supabase.from("cost_center_fixed_costs").update({ max_budget: val }).eq("id", id);
                        }
                      }}
                      className="h-7 text-xs w-[120px]"
                    />
                    {categoryBudget !== null && categoryBudget > 0 && (
                      <span className={`text-xs font-medium ${isOverBudget ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {fmt(categoryTotal)} / {fmt(categoryBudget)}
                      </span>
                    )}
                  </div>
                </div>
                {isOverBudget && (
                  <div className="flex items-center gap-1.5 mt-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                    <span className="text-xs text-destructive font-medium">
                      Custos acima da verba em {fmt(categoryTotal - categoryBudget!)}! Reduza os custos desta categoria.
                    </span>
                  </div>
                )}
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
                              onChange={e => updateStoreAmountLocal(fc.id, parseFloat(e.target.value) || 0)}
                              onBlur={() => saveFixedAmountOnBlur(fc.id)}
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
            );
          })}

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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground">
              Custos variáveis de <strong>{storeName}</strong> — percentuais sobre o faturamento.
            </p>
            <div className="flex gap-2">
              {variableCosts.length > 0 && otherStores.length > 0 && (
                <Button size="sm" variant="outline" className="gap-1" onClick={openShareDialog}>
                  <Share2 className="h-3.5 w-3.5" /> Compartilhar com outra loja
                </Button>
              )}
              <Button size="sm" className="gap-1" onClick={addDraftRow}>
                <Plus className="h-3.5 w-3.5" /> Adicionar Custo
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="pt-4">
              {variableCosts.length === 0 && drafts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">Nenhum custo variável cadastrado.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right w-[120px]">% do Faturamento</TableHead>
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

                    {/* Draft rows */}
                    {drafts.map(d => (
                      <TableRow key={d.tempId} className="bg-primary/5">
                        <TableCell>
                          <Input
                            value={d.description}
                            onChange={e => updateDraft(d.tempId, "description", e.target.value)}
                            placeholder="Ex: Imposto sobre vendas"
                            className="h-7 text-xs"
                            autoFocus
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={d.percentage}
                            onChange={e => updateDraft(d.tempId, "percentage", e.target.value)}
                            placeholder="6.00"
                            className="h-7 text-xs text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeDraft(d.tempId)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}

                    {(variableCosts.length > 0 || drafts.length > 0) && (
                      <TableRow className="border-t-2">
                        <TableCell className="font-bold text-xs">TOTAL</TableCell>
                        <TableCell className="text-right font-bold text-primary text-xs">
                          {fmtPct(totalVariablePercent + drafts.reduce((s, d) => s + (parseFloat(d.percentage) || 0), 0))}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Draft action bar */}
          {drafts.length > 0 && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/30 bg-primary/5">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{drafts.length} novo(s)</Badge>
                <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={addDraftRow}>
                  <Plus className="h-3 w-3" /> Mais um
                </Button>
              </div>
              <Button size="sm" className="gap-1" onClick={saveAllDrafts} disabled={savingDrafts}>
                {savingDrafts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar todos
              </Button>
            </div>
          )}

          {/* Share Variable Costs Dialog */}
          <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Share2 className="h-4 w-4" /> Compartilhar Custos Variáveis
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="text-xs font-medium">Loja destino *</Label>
                  <Select value={shareTargetStore} onValueChange={setShareTargetStore}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
                    <SelectContent>
                      {otherStores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs font-medium mb-2 block">Custos a copiar (ajuste os percentuais se necessário)</Label>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {shareItems.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-2 p-2 rounded border">
                        <Checkbox
                          checked={item.selected}
                          onCheckedChange={(checked) => setShareItems(prev =>
                            prev.map((s, i) => i === idx ? { ...s, selected: !!checked } : s)
                          )}
                        />
                        <span className="text-xs flex-1">{item.description}</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.percentage}
                          onChange={e => setShareItems(prev =>
                            prev.map((s, i) => i === idx ? { ...s, percentage: e.target.value } : s)
                          )}
                          className="h-7 w-20 text-xs text-right"
                          disabled={!item.selected}
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Button className="w-full gap-2" onClick={saveSharedCosts} disabled={savingShare}>
                  {savingShare ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  Copiar {shareItems.filter(s => s.selected).length} custo(s) para a loja
                </Button>
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
              <div>
                <Label className="text-xs font-medium">Faturamento Mensal (R$)</Label>
                <Input type="number" value={simRevenue} onChange={e => setSimRevenue(e.target.value)} className="h-10 text-lg font-bold" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label className="text-xs font-medium">Redução de Custos Fixos: {simFixedReduction}%</Label>
                  <Slider value={[simFixedReduction]} onValueChange={v => setSimFixedReduction(v[0])} max={50} step={1} />
                  <p className="text-[10px] text-muted-foreground">
                    De {fmt(totalFixedCosts)} para {fmt(adjustedFixed)} (economia de {fmt(totalFixedCosts - adjustedFixed)})
                  </p>
                </div>
                <div className="space-y-3">
                  <Label className="text-xs font-medium">Redução de Custos Variáveis: {simVariableReduction}%</Label>
                  <Slider value={[simVariableReduction]} onValueChange={v => setSimVariableReduction(v[0])} max={50} step={1} />
                  <p className="text-[10px] text-muted-foreground">
                    De {fmtPct(totalVariablePercent)} para {fmtPct(adjustedVariablePercent)}
                  </p>
                </div>
              </div>

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

        {/* Consolidated View */}
        <TabsContent value="consolidated" className="space-y-4">
          {consolidatedLoading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando consolidado...
            </div>
          ) : (
            <>
              {/* Consolidated KPI Cards */}
              {(() => {
                const storeMetrics = stores.map(store => {
                  const sfc = allStoreFixedCosts.filter(s => s.store_id === store.id && s.is_active);
                  const vc = allVariableCosts.filter(v => v.store_id === store.id && v.is_active);
                  const totalFixed = sfc.reduce((sum, s) => sum + s.amount, 0);
                  const totalVarPct = vc.reduce((sum, v) => sum + v.percentage, 0);
                  const contribMargin = 100 - totalVarPct;
                  const be = contribMargin > 0 ? totalFixed / (contribMargin / 100) : 0;
                  return { store, totalFixed, totalVarPct, contribMargin, breakEven: be };
                });
                const grandFixed = storeMetrics.reduce((s, m) => s + m.totalFixed, 0);
                const avgVarPct = storeMetrics.length > 0 ? storeMetrics.reduce((s, m) => s + m.totalVarPct, 0) / storeMetrics.length : 0;
                const avgContrib = 100 - avgVarPct;
                const grandBreakEven = avgContrib > 0 ? grandFixed / (avgContrib / 100) : 0;

                return (
                  <div className="space-y-4">
                    {/* Grand totals */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground font-medium">Custos Fixos Total</span>
                            <DollarSign className="h-3.5 w-3.5 text-destructive" />
                          </div>
                          <p className="text-lg font-bold text-destructive">{fmt(grandFixed)}</p>
                          <p className="text-[10px] text-muted-foreground">soma das {stores.length} lojas</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground font-medium">Custos Variáveis (média)</span>
                            <Percent className="h-3.5 w-3.5 text-orange-500" />
                          </div>
                          <p className="text-lg font-bold">{fmtPct(avgVarPct)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground font-medium">Margem Contribuição (média)</span>
                            <TrendingUp className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <p className="text-lg font-bold text-primary">{fmtPct(avgContrib)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-primary">
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground font-medium">Ponto de Equilíbrio Total</span>
                            <Target className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <p className="text-lg font-bold text-primary">{fmt(grandBreakEven)}</p>
                          <p className="text-[10px] text-muted-foreground">faturamento mínimo consolidado</p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Per-store comparison table */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-primary" />
                          Comparativo por Loja
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Loja</TableHead>
                              <TableHead className="text-right">Custos Fixos</TableHead>
                              <TableHead className="text-right">Custos Variáveis</TableHead>
                              <TableHead className="text-right">Margem Contribuição</TableHead>
                              <TableHead className="text-right">Ponto de Equilíbrio</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {storeMetrics.map(m => (
                              <TableRow key={m.store.id}>
                                <TableCell className="font-medium text-sm">{m.store.name}</TableCell>
                                <TableCell className="text-right text-sm text-destructive font-medium">{fmt(m.totalFixed)}</TableCell>
                                <TableCell className="text-right text-sm">{fmtPct(m.totalVarPct)}</TableCell>
                                <TableCell className="text-right text-sm text-primary font-medium">{fmtPct(m.contribMargin)}</TableCell>
                                <TableCell className="text-right text-sm font-bold">{fmt(m.breakEven)}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2 bg-muted/30">
                              <TableCell className="font-bold text-sm">TOTAL / MÉDIA</TableCell>
                              <TableCell className="text-right text-sm text-destructive font-bold">{fmt(grandFixed)}</TableCell>
                              <TableCell className="text-right text-sm font-bold">{fmtPct(avgVarPct)}</TableCell>
                              <TableCell className="text-right text-sm text-primary font-bold">{fmtPct(avgContrib)}</TableCell>
                              <TableCell className="text-right text-sm font-bold">{fmt(grandBreakEven)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>

                    {/* Fixed costs breakdown by category across stores */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-destructive" />
                          Custos Fixos por Categoria
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Categoria</TableHead>
                              {stores.map(s => (
                                <TableHead key={s.id} className="text-right">{s.name}</TableHead>
                              ))}
                              <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(() => {
                              const catMap = new Map<string, Map<string, number>>();
                              fixedCosts.forEach(fc => {
                                const cat = fc.category || "Outros";
                                if (!catMap.has(cat)) catMap.set(cat, new Map());
                                const catStores = catMap.get(cat)!;
                                stores.forEach(store => {
                                  const sfc = allStoreFixedCosts.find(s => s.fixed_cost_id === fc.id && s.store_id === store.id && s.is_active);
                                  const prev = catStores.get(store.id) || 0;
                                  catStores.set(store.id, prev + (sfc?.amount || 0));
                                });
                              });
                              const cats = [...catMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
                              return cats.map(([cat, storeMap]) => {
                                const total = stores.reduce((s, st) => s + (storeMap.get(st.id) || 0), 0);
                                return (
                                  <TableRow key={cat}>
                                    <TableCell className="font-medium text-xs">{cat}</TableCell>
                                    {stores.map(s => (
                                      <TableCell key={s.id} className="text-right text-xs">{fmt(storeMap.get(s.id) || 0)}</TableCell>
                                    ))}
                                    <TableCell className="text-right text-xs font-bold">{fmt(total)}</TableCell>
                                  </TableRow>
                                );
                              });
                            })()}
                            <TableRow className="border-t-2 bg-muted/30">
                              <TableCell className="font-bold text-xs">TOTAL</TableCell>
                              {stores.map(s => {
                                const storeTotal = allStoreFixedCosts
                                  .filter(sfc => sfc.store_id === s.id && sfc.is_active)
                                  .reduce((sum, sfc) => sum + sfc.amount, 0);
                                return <TableCell key={s.id} className="text-right text-xs font-bold text-destructive">{fmt(storeTotal)}</TableCell>;
                              })}
                              <TableCell className="text-right text-xs font-bold text-destructive">{fmt(grandFixed)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>

                    {/* Variable costs comparison */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Percent className="h-4 w-4 text-orange-500" />
                          Custos Variáveis por Loja
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {stores.map(store => {
                            const vc = allVariableCosts.filter(v => v.store_id === store.id && v.is_active);
                            const total = vc.reduce((s, v) => s + v.percentage, 0);
                            return (
                              <div key={store.id} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium">{store.name}</span>
                                  <Badge variant="secondary" className="text-xs">{fmtPct(total)}</Badge>
                                </div>
                                <div className="space-y-1">
                                  {vc.map(v => (
                                    <div key={v.id} className="flex justify-between text-xs text-muted-foreground">
                                      <span>{v.description}</span>
                                      <span className="font-medium">{fmtPct(v.percentage)}</span>
                                    </div>
                                  ))}
                                  {vc.length === 0 && <p className="text-xs text-muted-foreground italic">Nenhum custo variável</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                );
              })()}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
