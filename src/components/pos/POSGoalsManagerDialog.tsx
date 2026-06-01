import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, Plus, Target, User, Store, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { parseLocalDate } from "@/lib/businessDays";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface StoreRow { id: string; name: string }
interface SellerRow { id: string; name: string; store_id: string | null }
interface GoalRow {
  id: string;
  store_id: string;
  seller_id: string | null;
  goal_type: string;
  goal_value: number;
  period: string;
  period_start: string | null;
  period_end: string | null;
  is_active: boolean;
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function POSGoalsManagerDialog({ open, onClose, onSaved }: Props) {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Form state — store goal
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");
  const [storeForm, setStoreForm] = useState({ store_id: "", value: "", start: monthStart, end: monthEnd });
  const [sellerForm, setSellerForm] = useState({ store_id: "", seller_id: "", value: "", start: monthStart, end: monthEnd });

  const load = async () => {
    setLoading(true);
    const [storesRes, sellersRes, goalsRes] = await Promise.all([
      supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name"),
      supabase.from("pos_sellers").select("id, name, store_id").eq("is_active", true).order("name"),
      supabase.from("pos_goals").select("id, store_id, seller_id, goal_type, goal_value, period, period_start, period_end, is_active")
        .eq("is_active", true).order("created_at", { ascending: false }),
    ]);
    setStores(storesRes.data || []);
    setSellers(sellersRes.data || []);
    setGoals((goalsRes.data || []) as any);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); }, [open]);

  const saveStoreGoal = async () => {
    if (!storeForm.store_id || !storeForm.value) { toast.error("Preencha loja e valor"); return; }
    const val = parseFloat(storeForm.value.replace(",", "."));
    if (isNaN(val) || val <= 0) { toast.error("Valor inválido"); return; }
    const { error } = await supabase.from("pos_goals").insert({
      store_id: storeForm.store_id, seller_id: null,
      goal_type: "revenue", goal_value: val,
      period: "custom", period_start: storeForm.start, period_end: storeForm.end, is_active: true,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Meta da loja criada");
    setStoreForm({ ...storeForm, value: "" });
    await load(); onSaved();
  };

  const saveSellerGoal = async () => {
    if (!sellerForm.store_id || !sellerForm.seller_id || !sellerForm.value) { toast.error("Preencha todos os campos"); return; }
    const val = parseFloat(sellerForm.value.replace(",", "."));
    if (isNaN(val) || val <= 0) { toast.error("Valor inválido"); return; }
    const { error } = await supabase.from("pos_goals").insert({
      store_id: sellerForm.store_id, seller_id: sellerForm.seller_id,
      goal_type: "seller_revenue", goal_value: val,
      period: "custom", period_start: sellerForm.start, period_end: sellerForm.end, is_active: true,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Meta do vendedor criada");
    setSellerForm({ ...sellerForm, value: "" });
    await load(); onSaved();
  };

  const removeGoal = async (id: string) => {
    if (!confirm("Desativar esta meta?")) return;
    const { error } = await supabase.from("pos_goals").update({ is_active: false }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Meta removida");
    await load(); onSaved();
  };

  const storeName = (id: string) => stores.find(s => s.id === id)?.name || "—";
  const sellerName = (id: string | null) => id ? sellers.find(s => s.id === id)?.name || "—" : null;
  const filteredSellers = sellers.filter(s => !sellerForm.store_id || s.store_id === sellerForm.store_id);

  const storeGoals = goals.filter(g => !g.seller_id && (g.goal_type === "revenue" || g.goal_type === "avg_ticket" || g.goal_type === "items_sold"));
  const sellerGoals = goals.filter(g => g.seller_id);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-black text-zinc-100 border border-zinc-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <Target className="h-5 w-5 text-zinc-300" />
            Gerenciar metas
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="store">
          <TabsList className="bg-zinc-800 border border-zinc-700">
            <TabsTrigger value="store" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white">
              <Store className="h-3.5 w-3.5 mr-2" /> Lojas
            </TabsTrigger>
            <TabsTrigger value="seller" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white">
              <User className="h-3.5 w-3.5 mr-2" /> Vendedores
            </TabsTrigger>
          </TabsList>

          {/* STORE GOALS */}
          <TabsContent value="store" className="space-y-4 mt-4">
            <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
              <div className="md:col-span-2">
                <Label className="text-xs text-zinc-400">Loja</Label>
                <Select value={storeForm.store_id} onValueChange={(v) => setStoreForm({ ...storeForm, store_id: v })}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Meta R$</Label>
                <Input value={storeForm.value} onChange={(e) => setStoreForm({ ...storeForm, value: e.target.value })}
                  placeholder="50000" className="bg-zinc-900 border-zinc-700 text-zinc-100" />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Início</Label>
                <Input type="date" value={storeForm.start} onChange={(e) => setStoreForm({ ...storeForm, start: e.target.value })}
                  className="bg-zinc-900 border-zinc-700 text-zinc-100" />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Fim</Label>
                <Input type="date" value={storeForm.end} onChange={(e) => setStoreForm({ ...storeForm, end: e.target.value })}
                  className="bg-zinc-900 border-zinc-700 text-zinc-100" />
              </div>
              <Button onClick={saveStoreGoal} className="md:col-span-5 bg-gradient-to-r from-zinc-300 to-zinc-400 text-zinc-900 hover:from-zinc-200 hover:to-zinc-300">
                <Plus className="h-4 w-4 mr-1" /> Adicionar meta da loja
              </Button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {loading ? <Loader2 className="h-5 w-5 animate-spin mx-auto text-zinc-400" /> : storeGoals.length === 0 ? (
                <p className="text-center text-zinc-500 text-sm py-4">Nenhuma meta de loja ativa</p>
              ) : storeGoals.map(g => (
                <div key={g.id} className="flex items-center justify-between bg-zinc-800/40 border border-zinc-700 rounded-md px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-100 truncate">{storeName(g.store_id)}</p>
                    <p className="text-[11px] text-zinc-400">
                      {g.goal_type} · {g.period}
                      {g.period_start && ` · ${format(parseLocalDate(g.period_start), "dd/MM")}—${g.period_end ? format(parseLocalDate(g.period_end), "dd/MM") : "?"}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-400">{BRL(Number(g.goal_value))}</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeGoal(g.id)} className="ml-2 h-7 w-7 text-zinc-400 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* SELLER GOALS */}
          <TabsContent value="seller" className="space-y-4 mt-4">
            <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
              <div className="md:col-span-2">
                <Label className="text-xs text-zinc-400">Loja</Label>
                <Select value={sellerForm.store_id} onValueChange={(v) => setSellerForm({ ...sellerForm, store_id: v, seller_id: "" })}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100"><SelectValue placeholder="Loja" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs text-zinc-400">Vendedor</Label>
                <Select value={sellerForm.seller_id} onValueChange={(v) => setSellerForm({ ...sellerForm, seller_id: v })}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100"><SelectValue placeholder="Vendedor" /></SelectTrigger>
                  <SelectContent>{filteredSellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Meta R$</Label>
                <Input value={sellerForm.value} onChange={(e) => setSellerForm({ ...sellerForm, value: e.target.value })}
                  placeholder="10000" className="bg-zinc-900 border-zinc-700 text-zinc-100" />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Início</Label>
                <Input type="date" value={sellerForm.start} onChange={(e) => setSellerForm({ ...sellerForm, start: e.target.value })}
                  className="bg-zinc-900 border-zinc-700 text-zinc-100" />
              </div>
              <div className="md:col-span-1">
                <Label className="text-xs text-zinc-400">Fim</Label>
                <Input type="date" value={sellerForm.end} onChange={(e) => setSellerForm({ ...sellerForm, end: e.target.value })}
                  className="bg-zinc-900 border-zinc-700 text-zinc-100" />
              </div>
              <Button onClick={saveSellerGoal} className="md:col-span-6 bg-gradient-to-r from-zinc-300 to-zinc-400 text-zinc-900 hover:from-zinc-200 hover:to-zinc-300">
                <Plus className="h-4 w-4 mr-1" /> Adicionar meta do vendedor
              </Button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {loading ? <Loader2 className="h-5 w-5 animate-spin mx-auto text-zinc-400" /> : sellerGoals.length === 0 ? (
                <p className="text-center text-zinc-500 text-sm py-4">Nenhuma meta de vendedor ativa</p>
              ) : sellerGoals.map(g => (
                <div key={g.id} className="flex items-center justify-between bg-zinc-800/40 border border-zinc-700 rounded-md px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-100 truncate">{sellerName(g.seller_id)} <span className="text-zinc-500 font-normal">· {storeName(g.store_id)}</span></p>
                    <p className="text-[11px] text-zinc-400">
                      {g.period}
                      {g.period_start && ` · ${format(new Date(g.period_start), "dd/MM")}—${g.period_end ? format(new Date(g.period_end), "dd/MM") : "?"}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-400">{BRL(Number(g.goal_value))}</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeGoal(g.id)} className="ml-2 h-7 w-7 text-zinc-400 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
