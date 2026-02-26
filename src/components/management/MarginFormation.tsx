import { useState, useEffect, useMemo } from "react";
import {
  Plus, Trash2, Save, Loader2, Building2, Pencil,
  TrendingUp, AlertTriangle, DollarSign, Percent, Target, BarChart3, Copy, Share2,
  Scissors, Check, X
} from "lucide-react";
import { ProfitSimulator } from "./ProfitSimulator";
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

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  stores: { id: string; name: string; revenue_target?: number }[];
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
  const [editingRevenueTarget, setEditingRevenueTarget] = useState(false);
  const [revenueTargetInput, setRevenueTargetInput] = useState("");

  // Consolidated view
  const [allStoreFixedCosts, setAllStoreFixedCosts] = useState<StoreFixedCost[]>([]);
  const [allVariableCosts, setAllVariableCosts] = useState<VariableCost[]>([]);
  const [consolidatedLoading, setConsolidatedLoading] = useState(false);

  // Planned reductions (R$ for fixed, percentage points for variable)
  const [fixedCutValues, setFixedCutValues] = useState<Record<string, number>>({});
  const [variableCutValues, setVariableCutValues] = useState<Record<string, number>>({});
  const [fixedCutDescriptions, setFixedCutDescriptions] = useState<Record<string, string>>({});
  const [variableCutDescriptions, setVariableCutDescriptions] = useState<Record<string, string>>({});

  // All stores' planned cuts for consolidated view
  const [allFixedCuts, setAllFixedCuts] = useState<{ store_id: string; fixed_cost_id: string; reduction_amount: number; description?: string }[]>([]);
  const [allVariableCuts, setAllVariableCuts] = useState<{ store_id: string; variable_cost_id: string; reduction_percentage: number; description?: string }[]>([]);

  // Inline editing for variable costs
  const [editingVarId, setEditingVarId] = useState<string | null>(null);
  const [editingVarDesc, setEditingVarDesc] = useState("");
  const [editingVarPct, setEditingVarPct] = useState("");

  const loadConsolidated = async () => {
    setConsolidatedLoading(true);
    const [sfcRes, vcRes, fcutsRes, vcutsRes] = await Promise.all([
      supabase.from("cost_center_store_fixed_costs").select("*"),
      supabase.from("cost_center_variable_costs").select("*"),
      supabase.from("cost_center_planned_fixed_cuts").select("*"),
      supabase.from("cost_center_planned_variable_cuts").select("*"),
    ]);
    setAllStoreFixedCosts((sfcRes.data || []) as StoreFixedCost[]);
    setAllVariableCosts((vcRes.data || []) as VariableCost[]);
    setAllFixedCuts((fcutsRes.data || []).map((r: any) => ({ store_id: r.store_id, fixed_cost_id: r.fixed_cost_id, reduction_amount: Number(r.reduction_amount), description: r.description || '' })));
    setAllVariableCuts((vcutsRes.data || []).map((r: any) => ({ store_id: r.store_id, variable_cost_id: r.variable_cost_id, reduction_percentage: Number(r.reduction_percentage), description: r.description || '' })));
    setConsolidatedLoading(false);
  };

  useEffect(() => { loadConsolidated(); }, []);

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

  // Track dirty fixed cost amounts for batch save
  const [dirtyFixedAmounts, setDirtyFixedAmounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    loadData();
  }, [selectedStore]);

  const loadData = async () => {
    setLoading(true);
    const [fcRes, sfcRes, vcRes, fcutsRes, vcutsRes] = await Promise.all([
      supabase.from("cost_center_fixed_costs").select("*").order("sort_order"),
      supabase.from("cost_center_store_fixed_costs").select("*").eq("store_id", selectedStore),
      supabase.from("cost_center_variable_costs").select("*").eq("store_id", selectedStore),
      supabase.from("cost_center_planned_fixed_cuts").select("*").eq("store_id", selectedStore),
      supabase.from("cost_center_planned_variable_cuts").select("*").eq("store_id", selectedStore),
    ]);
    setFixedCosts((fcRes.data || []) as FixedCost[]);
    setStoreFixedCosts((sfcRes.data || []) as StoreFixedCost[]);
    setVariableCosts((vcRes.data || []) as VariableCost[]);
    
    // Load saved cuts
    const savedFixedCuts: Record<string, number> = {};
    const savedFixedCutDescs: Record<string, string> = {};
    (fcutsRes.data || []).forEach((r: any) => {
      if (Number(r.reduction_amount) > 0) savedFixedCuts[r.fixed_cost_id] = Number(r.reduction_amount);
      if (r.description) savedFixedCutDescs[r.fixed_cost_id] = r.description;
    });
    setFixedCutValues(savedFixedCuts);
    setFixedCutDescriptions(savedFixedCutDescs);

    const savedVarCuts: Record<string, number> = {};
    const savedVarCutDescs: Record<string, string> = {};
    (vcutsRes.data || []).forEach((r: any) => {
      if (Number(r.reduction_percentage) > 0) savedVarCuts[r.variable_cost_id] = Number(r.reduction_percentage);
      if (r.description) savedVarCutDescs[r.variable_cost_id] = r.description;
    });
    setVariableCutValues(savedVarCuts);
    setVariableCutDescriptions(savedVarCutDescs);

    setDirtyFixedAmounts(new Map());
    setDrafts([]);
    setLoading(false);
  };

  // Save fixed cut to DB (debounced on blur)
  const saveFixedCut = async (fixedCostId: string, value: number, description?: string) => {
    if (value > 0) {
      await supabase.from("cost_center_planned_fixed_cuts").upsert({
        store_id: selectedStore,
        fixed_cost_id: fixedCostId,
        reduction_amount: value,
        description: description ?? fixedCutDescriptions[fixedCostId] ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "store_id,fixed_cost_id" });
    } else {
      await supabase.from("cost_center_planned_fixed_cuts")
        .delete()
        .eq("store_id", selectedStore)
        .eq("fixed_cost_id", fixedCostId);
    }
  };

  // Save variable cut to DB (debounced on blur)
  const saveVariableCut = async (variableCostId: string, value: number, description?: string) => {
    if (value > 0) {
      await supabase.from("cost_center_planned_variable_cuts").upsert({
        store_id: selectedStore,
        variable_cost_id: variableCostId,
        reduction_percentage: value,
        description: description ?? variableCutDescriptions[variableCostId] ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "store_id,variable_cost_id" });
    } else {
      await supabase.from("cost_center_planned_variable_cuts")
        .delete()
        .eq("store_id", selectedStore)
        .eq("variable_cost_id", variableCostId);
    }
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

  // Variable costs - inline editing
  const startEditingVar = (vc: VariableCost) => {
    setEditingVarId(vc.id);
    setEditingVarDesc(vc.description);
    setEditingVarPct(String(vc.percentage));
  };

  const cancelEditingVar = () => {
    setEditingVarId(null);
    setEditingVarDesc("");
    setEditingVarPct("");
  };

  const saveEditingVar = async () => {
    if (!editingVarId) return;
    const desc = editingVarDesc.trim();
    const pct = parseFloat(editingVarPct) || 0;
    if (!desc) { toast.error("Descrição obrigatória."); return; }
    await supabase.from("cost_center_variable_costs").update({ description: desc, percentage: pct }).eq("id", editingVarId);
    setVariableCosts(prev => prev.map(vc => vc.id === editingVarId ? { ...vc, description: desc, percentage: pct } : vc));
    cancelEditingVar();
    toast.success("Custo variável atualizado!");
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

  // Planned savings
  const totalFixedSavings = useMemo(() => {
    return Object.entries(fixedCutValues).reduce((sum, [fcId, cutVal]) => {
      if (cutVal > 0 && isStoreActive(fcId)) return sum + cutVal;
      return sum;
    }, 0);
  }, [fixedCutValues, storeFixedCosts]);

  const totalVariableSavingsPct = useMemo(() => {
    return Object.entries(variableCutValues).reduce((sum, [vcId, cutVal]) => {
      const vc = variableCosts.find(v => v.id === vcId);
      if (vc && cutVal > 0 && vc.is_active) return sum + cutVal;
      return sum;
    }, 0);
  }, [variableCutValues, variableCosts]);

  // Build fixed cost items for simulator
  const storeFixedCostItems = useMemo(() => {
    return fixedCosts.map(fc => {
      const sfc = storeFixedCosts.find(s => s.fixed_cost_id === fc.id && s.is_active);
      return { id: fc.id, name: fc.name, category: fc.category, amount: sfc?.amount || 0 };
    }).filter(item => item.amount > 0);
  }, [fixedCosts, storeFixedCosts]);

  const storeVariableCostItems = useMemo(() => {
    return variableCosts.filter(v => v.is_active).map(v => ({
      id: v.id, description: v.description, percentage: v.percentage,
    }));
  }, [variableCosts]);

  const currentStore = stores.find(s => s.id === selectedStore);
  const storeName = currentStore?.name || "Loja";
  const storeRevenueTarget = currentStore?.revenue_target ?? 100000;
  const otherStores = stores.filter(s => s.id !== selectedStore);




  const saveRevenueTarget = async () => {
    const val = parseFloat(revenueTargetInput) || 0;
    if (val <= 0) { toast.error("Meta deve ser maior que zero"); return; }
    await supabase.from("pos_stores").update({ revenue_target: val }).eq("id", selectedStore);
    // Update local stores reference
    if (currentStore) (currentStore as any).revenue_target = val;
    setEditingRevenueTarget(false);
    toast.success("Meta de faturamento atualizada!");
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Store selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-bold">Formação de Margem</h3>
        </div>
        <div className="flex items-center gap-3">
          {/* Revenue Target */}
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Meta:</span>
            {editingRevenueTarget ? (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={revenueTargetInput}
                  onChange={e => setRevenueTargetInput(e.target.value)}
                  className="h-7 w-[120px] text-xs"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveRevenueTarget(); if (e.key === 'Escape') setEditingRevenueTarget(false); }}
                />
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={saveRevenueTarget}><Check className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingRevenueTarget(false)}><X className="h-3 w-3" /></Button>
              </div>
            ) : (
              <button
                onClick={() => { setRevenueTargetInput(String(storeRevenueTarget)); setEditingRevenueTarget(true); }}
                className="text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                {fmt(storeRevenueTarget)}
              </button>
            )}
          </div>
          <Select value={selectedStore} onValueChange={s => { setSelectedStore(s); setEditingRevenueTarget(false); }}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
            <SelectContent>
              {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
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
            <p className="text-[10px] text-muted-foreground">Limite: {fmt(breakEven * (totalVariablePercent / 100))}/mês</p>
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
            const categoryTotal = costs.reduce((sum, fc) => {
              const sfc = storeFixedCosts.find(s => s.fixed_cost_id === fc.id);
              return sum + (sfc?.is_active ? (sfc.amount || 0) : 0);
            }, 0);
            const categoryBudget = costs.reduce((budget, fc) => budget ?? fc.max_budget, null as number | null);
            const isOverBudget = categoryBudget !== null && categoryBudget > 0 && categoryTotal > categoryBudget;
            const categoryCuts = costs.reduce((sum, fc) => sum + (fixedCutValues[fc.id] || 0), 0);

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
                      <TableHead className="w-[130px]">Valor (R$/mês)</TableHead>
                       <TableHead className="w-[130px]">
                        <div className="flex items-center gap-1">
                          <Scissors className="h-3 w-3 text-primary" />
                          <span>Redução (R$)</span>
                        </div>
                      </TableHead>
                      <TableHead className="w-[180px]">Como reduzir</TableHead>
                      <TableHead className="w-20">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costs.map(fc => {
                      const active = isStoreActive(fc.id);
                      const amount = getStoreAmount(fc.id);
                      const cutVal = fixedCutValues[fc.id] || 0;
                      const cutDesc = fixedCutDescriptions[fc.id] || '';
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
                            <Input
                              type="number"
                              step="0.01"
                              value={cutVal || ""}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                setFixedCutValues(prev => ({ ...prev, [fc.id]: Math.min(val, amount) }));
                              }}
                              onBlur={() => saveFixedCut(fc.id, fixedCutValues[fc.id] || 0)}
                              placeholder="0"
                              className="h-7 text-xs w-full"
                              disabled={!active || amount <= 0}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={cutDesc}
                              onChange={e => setFixedCutDescriptions(prev => ({ ...prev, [fc.id]: e.target.value }))}
                              onBlur={() => {
                                if (cutVal > 0) saveFixedCut(fc.id, cutVal, fixedCutDescriptions[fc.id]);
                              }}
                              placeholder="Descreva como..."
                              className="h-7 text-xs w-full"
                              disabled={!active || amount <= 0}
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
                {categoryCuts > 0 && (
                  <div className="flex items-center justify-end gap-2 mt-2 text-xs">
                    <Scissors className="h-3 w-3 text-primary" />
                    <span className="text-primary font-medium">Economia na categoria: {fmt(categoryCuts)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
            );
          })}

          {/* Fixed costs savings summary */}
          {totalFixedSavings > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Scissors className="h-4 w-4 text-primary" />
                    <span className="text-sm font-bold">Economia Total em Custos Fixos</span>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary">{fmt(totalFixedSavings)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      De {fmt(totalFixedCosts)} para {fmt(totalFixedCosts - totalFixedSavings)}/mês
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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
                      <TableHead className="text-right w-[130px]">Limite R$/mês</TableHead>
                      <TableHead className="w-[130px]">
                        <div className="flex items-center gap-1">
                          <Scissors className="h-3 w-3 text-primary" />
                          <span>Redução (%)</span>
                        </div>
                      </TableHead>
                      <TableHead className="w-[180px]">Como reduzir</TableHead>
                      <TableHead className="w-24">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variableCosts.map(vc => {
                      const isEditing = editingVarId === vc.id;
                      const cutVal = variableCutValues[vc.id] || 0;
                      const cutDesc = variableCutDescriptions[vc.id] || '';
                      return (
                        <TableRow key={vc.id}>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                value={editingVarDesc}
                                onChange={e => setEditingVarDesc(e.target.value)}
                                className="h-7 text-xs"
                                autoFocus
                              />
                            ) : (
                              <span className="font-medium text-xs">{vc.description}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={editingVarPct}
                                onChange={e => setEditingVarPct(e.target.value)}
                                className="h-7 text-xs text-right"
                              />
                            ) : (
                              <span className="font-bold text-xs">{fmtPct(vc.percentage)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {fmt(breakEven * (vc.percentage / 100))}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={cutVal || ""}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                setVariableCutValues(prev => ({ ...prev, [vc.id]: Math.min(val, vc.percentage) }));
                              }}
                              onBlur={() => saveVariableCut(vc.id, variableCutValues[vc.id] || 0)}
                              placeholder="0"
                              className="h-7 text-xs w-full"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={cutDesc}
                              onChange={e => setVariableCutDescriptions(prev => ({ ...prev, [vc.id]: e.target.value }))}
                              onBlur={() => {
                                if (cutVal > 0) saveVariableCut(vc.id, cutVal, variableCutDescriptions[vc.id]);
                              }}
                              placeholder="Descreva como..."
                              className="h-7 text-xs w-full"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {isEditing ? (
                                <>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-green-500" onClick={saveEditingVar}>
                                    <Check className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={cancelEditingVar}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => startEditingVar(vc)}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteVariableCost(vc.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}

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
                        <TableCell />
                        <TableCell />
                        <TableCell />
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
                        <TableCell className="text-right font-bold text-primary text-xs">
                          {fmt(breakEven * ((totalVariablePercent + drafts.reduce((s, d) => s + (parseFloat(d.percentage) || 0), 0)) / 100))}
                        </TableCell>
                        <TableCell className="text-xs font-bold text-primary text-right">
                          {totalVariableSavingsPct > 0 && `- ${fmtPct(totalVariableSavingsPct)}`}
                        </TableCell>
                        <TableCell />
                        <TableCell />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Variable costs savings summary */}
          {totalVariableSavingsPct > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Scissors className="h-4 w-4 text-primary" />
                    <span className="text-sm font-bold">Economia Total em Custos Variáveis</span>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary">- {fmtPct(totalVariableSavingsPct)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      De {fmtPct(totalVariablePercent)} para {fmtPct(totalVariablePercent - totalVariableSavingsPct)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Economia em R$ (no PE): {fmt(breakEven * (totalVariableSavingsPct / 100))}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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
          <ProfitSimulator
            title={`Simulador de Lucro — ${storeName}`}
            fixedCostItems={storeFixedCostItems}
            variableCostItems={storeVariableCostItems}
            totalFixedCosts={totalFixedCosts}
            totalVariablePercent={totalVariablePercent}
            initialRevenue={storeRevenueTarget}
            plannedFixedCuts={fixedCutValues}
            plannedVariableCuts={variableCutValues}
            plannedCutDetails={(() => {
              const details: { type: 'fixed' | 'variable'; costName: string; storeName: string; cutValue: string; description: string }[] = [];
              Object.entries(fixedCutValues).forEach(([fcId, val]) => {
                if (val > 0) {
                  const fc = fixedCosts.find(f => f.id === fcId);
                  details.push({ type: 'fixed', costName: fc?.name || '', storeName, cutValue: fmt(val), description: fixedCutDescriptions[fcId] || '' });
                }
              });
              Object.entries(variableCutValues).forEach(([vcId, val]) => {
                if (val > 0) {
                  const vc = variableCosts.find(v => v.id === vcId);
                  details.push({ type: 'variable', costName: vc?.description || '', storeName, cutValue: `- ${fmtPct(val)}`, description: variableCutDescriptions[vcId] || '' });
                }
              });
              return details;
            })()}
          />
        </TabsContent>

        {/* Consolidated View */}
        <TabsContent value="consolidated" className="space-y-4">
          {consolidatedLoading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando consolidado...
            </div>
          ) : (
            <>
              {(() => {
                const storeMetrics = stores.map(store => {
                  const sfc = allStoreFixedCosts.filter(s => s.store_id === store.id && s.is_active);
                  const vc = allVariableCosts.filter(v => v.store_id === store.id && v.is_active);
                  const totalFixed = sfc.reduce((sum, s) => sum + s.amount, 0);
                  const totalVarPct = vc.reduce((sum, v) => sum + v.percentage, 0);
                  const contribMargin = 100 - totalVarPct;
                  const be = contribMargin > 0 ? totalFixed / (contribMargin / 100) : 0;

                  // Store-level cuts
                  const storeFixedCutTotal = allFixedCuts
                    .filter(c => c.store_id === store.id)
                    .reduce((sum, c) => sum + c.reduction_amount, 0);
                  const storeVarCutPct = allVariableCuts
                    .filter(c => c.store_id === store.id)
                    .reduce((sum, c) => sum + c.reduction_percentage, 0);

                  return { store, totalFixed, totalVarPct, contribMargin, breakEven: be, storeFixedCutTotal, storeVarCutPct };
                });
                const grandFixed = storeMetrics.reduce((s, m) => s + m.totalFixed, 0);
                const avgVarPct = storeMetrics.length > 0 ? storeMetrics.reduce((s, m) => s + m.totalVarPct, 0) / storeMetrics.length : 0;
                const avgContrib = 100 - avgVarPct;
                const grandBreakEven = avgContrib > 0 ? grandFixed / (avgContrib / 100) : 0;

                // Consolidated cuts: sum all stores
                const consolidatedFixedCutTotal = storeMetrics.reduce((s, m) => s + m.storeFixedCutTotal, 0);
                const consolidatedVarCutPct = storeMetrics.length > 0
                  ? storeMetrics.reduce((s, m) => s + m.storeVarCutPct, 0) / storeMetrics.length
                  : 0;

                // Build consolidated items for simulator
                const consolidatedFixedItems = fixedCosts.map(fc => {
                  const totalAmount = allStoreFixedCosts
                    .filter(s => s.fixed_cost_id === fc.id && s.is_active)
                    .reduce((sum, s) => sum + s.amount, 0);
                  return { id: fc.id, name: fc.name, category: fc.category, amount: totalAmount };
                }).filter(item => item.amount > 0);

                // Build consolidated planned fixed cuts: sum R$ across stores for same fixed_cost_id
                const consolidatedPlannedFixedCuts: Record<string, number> = {};
                allFixedCuts.forEach(c => {
                  consolidatedPlannedFixedCuts[c.fixed_cost_id] = (consolidatedPlannedFixedCuts[c.fixed_cost_id] || 0) + c.reduction_amount;
                });

                // Merge variable costs across stores (average by description)
                const vcMap = new Map<string, { id: string; description: string; totalPct: number; count: number }>();
                allVariableCosts.filter(v => v.is_active).forEach(v => {
                  const key = v.description.toLowerCase().trim();
                  const existing = vcMap.get(key);
                  if (existing) {
                    existing.totalPct += v.percentage;
                    existing.count += 1;
                  } else {
                    vcMap.set(key, { id: v.id, description: v.description, totalPct: v.percentage, count: 1 });
                  }
                });
                const consolidatedVariableItems = [...vcMap.values()].map(v => ({
                  id: v.id, description: v.description, percentage: v.totalPct / v.count,
                }));

                // Build consolidated planned variable cuts: average % across stores for same description
                const vcCutMap = new Map<string, { totalCut: number; count: number; id: string }>();
                allVariableCuts.forEach(c => {
                  // Find the variable cost to get its description
                  const vc = allVariableCosts.find(v => v.id === c.variable_cost_id);
                  if (!vc) return;
                  const key = vc.description.toLowerCase().trim();
                  const existing = vcCutMap.get(key);
                  if (existing) {
                    existing.totalCut += c.reduction_percentage;
                    existing.count += 1;
                  } else {
                    // Find the consolidated item id
                    const consolItem = consolidatedVariableItems.find(ci => ci.description.toLowerCase().trim() === key);
                    vcCutMap.set(key, { totalCut: c.reduction_percentage, count: 1, id: consolItem?.id || c.variable_cost_id });
                  }
                });
                const consolidatedPlannedVarCuts: Record<string, number> = {};
                vcCutMap.forEach((val) => {
                  consolidatedPlannedVarCuts[val.id] = val.totalCut / val.count;
                });

                return (
                  <div className="space-y-4">
                    {/* Grand totals */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground font-medium">Total Fixos</span>
                            <DollarSign className="h-3.5 w-3.5 text-destructive" />
                          </div>
                          <p className="text-lg font-bold text-destructive">{fmt(grandFixed)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground font-medium">Média Variáveis</span>
                            <Percent className="h-3.5 w-3.5 text-orange-500" />
                          </div>
                          <p className="text-lg font-bold">{fmtPct(avgVarPct)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground font-medium">Margem Contrib.</span>
                            <TrendingUp className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <p className="text-lg font-bold text-primary">{fmtPct(avgContrib)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-primary">
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground font-medium">PE Consolidado</span>
                            <Target className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <p className="text-lg font-bold text-primary">{fmt(grandBreakEven)}</p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Consolidated savings summary */}
                    {(consolidatedFixedCutTotal > 0 || consolidatedVarCutPct > 0) && (
                      <Card className="border-primary/30 bg-primary/5">
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Scissors className="h-4 w-4 text-primary" />
                            <span className="text-sm font-bold">Economia Consolidada (soma de todas as lojas)</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            {consolidatedFixedCutTotal > 0 && (
                              <div>
                                <p className="text-[10px] text-muted-foreground">Custos Fixos</p>
                                <p className="text-lg font-bold text-primary">- {fmt(consolidatedFixedCutTotal)}</p>
                                <p className="text-[10px] text-muted-foreground">{fmt(grandFixed)} → {fmt(grandFixed - consolidatedFixedCutTotal)}/mês</p>
                              </div>
                            )}
                            {consolidatedVarCutPct > 0 && (
                              <div>
                                <p className="text-[10px] text-muted-foreground">Custos Variáveis (média)</p>
                                <p className="text-lg font-bold text-primary">- {fmtPct(consolidatedVarCutPct)}</p>
                                <p className="text-[10px] text-muted-foreground">{fmtPct(avgVarPct)} → {fmtPct(avgVarPct - consolidatedVarCutPct)}</p>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Per-store table */}
                    <Card>
                      <CardContent className="pt-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Loja</TableHead>
                              <TableHead className="text-right">Custos Fixos</TableHead>
                              <TableHead className="text-right">% Variável</TableHead>
                              <TableHead className="text-right">Margem</TableHead>
                              <TableHead className="text-right">Ponto Equilíbrio</TableHead>
                              <TableHead className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Scissors className="h-3 w-3 text-primary" />
                                  <span>Redução Fixo</span>
                                </div>
                              </TableHead>
                              <TableHead className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Scissors className="h-3 w-3 text-primary" />
                                  <span>Redução Var.</span>
                                </div>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {storeMetrics.map(m => (
                              <TableRow key={m.store.id}>
                                <TableCell className="font-medium text-xs">{m.store.name}</TableCell>
                                <TableCell className="text-right text-xs text-destructive">{fmt(m.totalFixed)}</TableCell>
                                <TableCell className="text-right text-xs">{fmtPct(m.totalVarPct)}</TableCell>
                                <TableCell className="text-right text-xs text-primary">{fmtPct(m.contribMargin)}</TableCell>
                                <TableCell className="text-right text-xs font-bold">{fmt(m.breakEven)}</TableCell>
                                <TableCell className="text-right text-xs text-primary font-medium">
                                  {m.storeFixedCutTotal > 0 ? `- ${fmt(m.storeFixedCutTotal)}` : "—"}
                                </TableCell>
                                <TableCell className="text-right text-xs text-primary font-medium">
                                  {m.storeVarCutPct > 0 ? `- ${fmtPct(m.storeVarCutPct)}` : "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2 font-bold">
                              <TableCell className="text-xs">CONSOLIDADO</TableCell>
                              <TableCell className="text-right text-xs text-destructive">{fmt(grandFixed)}</TableCell>
                              <TableCell className="text-right text-xs">{fmtPct(avgVarPct)}</TableCell>
                              <TableCell className="text-right text-xs text-primary">{fmtPct(avgContrib)}</TableCell>
                              <TableCell className="text-right text-xs">{fmt(grandBreakEven)}</TableCell>
                              <TableCell className="text-right text-xs text-primary">
                                {consolidatedFixedCutTotal > 0 ? `- ${fmt(consolidatedFixedCutTotal)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs text-primary">
                                {consolidatedVarCutPct > 0 ? `- ${fmtPct(consolidatedVarCutPct)}` : "—"}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>

                    {/* Consolidated simulator */}
                    <ProfitSimulator
                      title="Simulador Consolidado"
                      fixedCostItems={consolidatedFixedItems}
                      variableCostItems={consolidatedVariableItems}
                      totalFixedCosts={grandFixed}
                      totalVariablePercent={avgVarPct}
                      initialRevenue={stores.reduce((sum, s) => sum + (s.revenue_target ?? 100000), 0)}
                      plannedFixedCuts={consolidatedPlannedFixedCuts}
                      plannedVariableCuts={consolidatedPlannedVarCuts}
                      plannedCutDetails={(() => {
                        const details: { type: 'fixed' | 'variable'; costName: string; storeName: string; cutValue: string; description: string }[] = [];
                        allFixedCuts.filter(c => c.reduction_amount > 0).forEach(c => {
                          const fc = fixedCosts.find(f => f.id === c.fixed_cost_id);
                          const sName = stores.find(s => s.id === c.store_id)?.name || c.store_id;
                          details.push({ type: 'fixed', costName: fc?.name || '', storeName: sName, cutValue: fmt(c.reduction_amount), description: c.description || '' });
                        });
                        allVariableCuts.filter(c => c.reduction_percentage > 0).forEach(c => {
                          const vc = allVariableCosts.find(v => v.id === c.variable_cost_id);
                          const sName = stores.find(s => s.id === c.store_id)?.name || c.store_id;
                          details.push({ type: 'variable', costName: vc?.description || '', storeName: sName, cutValue: `- ${fmtPct(c.reduction_percentage)}`, description: c.description || '' });
                        });
                        return details;
                      })()}
                    />
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
