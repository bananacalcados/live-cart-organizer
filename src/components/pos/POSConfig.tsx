import { useState, useEffect, useRef, useCallback } from "react";
import { Settings, Store, Users, Save, Plus, Trash2, Receipt, RefreshCw, Loader2, CheckCircle, AlertCircle, Phone, Trophy, Target, ListChecks, Check, Sparkles, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Props {
  storeId: string;
}

interface SellerRow {
  id: string;
  name: string;
  is_active: boolean;
}

export function POSConfig({ storeId }: Props) {
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [showAddSeller, setShowAddSeller] = useState(false);
  const [newSellerName, setNewSellerName] = useState("");
  const [showAddStore, setShowAddStore] = useState(false);
  const [newStore, setNewStore] = useState({ name: "", tiny_token: "", address: "" });
  const [autoEmit, setAutoEmit] = useState(false);
  const [autoEmitMinValue, setAutoEmitMinValue] = useState("");
  const [autoEmitMethods, setAutoEmitMethods] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ status: string; products_synced: number; completed_at: string; total_products?: number } | null>(null);
  const [productCount, setProductCount] = useState(0);
  const [syncProgress, setSyncProgress] = useState<{ synced: number; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // WhatsApp numbers config
  const [allWhatsAppNumbers, setAllWhatsAppNumbers] = useState<{ id: string; label: string; phone_display: string; provider: string }[]>([]);
  const [linkedNumberIds, setLinkedNumberIds] = useState<Set<string>>(new Set());
  const [savingNumbers, setSavingNumbers] = useState(false);

  // Prizes
  const [prizes, setPrizes] = useState<{ id: string; name: string; description: string | null; min_points: number; prize_type: string; is_active: boolean }[]>([]);
  const [showAddPrize, setShowAddPrize] = useState(false);
  const [newPrize, setNewPrize] = useState({ name: "", description: "", min_points: "100", prize_type: "weekly" });

  // Seller Tasks
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ seller_id: "", title: "", description: "", customer_phone: "", customer_name: "", task_type: "contact", points_reward: "5", due_date: "" });
  const [generatingTasks, setGeneratingTasks] = useState(false);

  useEffect(() => {
    loadSellers();
    loadInvoiceConfig();
    loadSyncInfo();
    loadWhatsAppNumbers();
    loadPrizes();
    loadTasks();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [storeId]);

  const loadWhatsAppNumbers = async () => {
    const [{ data: allNums }, { data: linked }] = await Promise.all([
      supabase.from('whatsapp_numbers').select('id, label, phone_display, provider').eq('is_active', true),
      supabase.from('pos_store_whatsapp_numbers').select('whatsapp_number_id').eq('store_id', storeId),
    ]);
    setAllWhatsAppNumbers(allNums || []);
    setLinkedNumberIds(new Set((linked || []).map((l: any) => l.whatsapp_number_id)));
  };

  const toggleWhatsAppNumber = (numberId: string) => {
    setLinkedNumberIds(prev => {
      const next = new Set(prev);
      if (next.has(numberId)) next.delete(numberId);
      else next.add(numberId);
      return next;
    });
  };

  const saveWhatsAppNumbers = async () => {
    setSavingNumbers(true);
    try {
      await supabase.from('pos_store_whatsapp_numbers').delete().eq('store_id', storeId);
      const rows = Array.from(linkedNumberIds).map(whatsapp_number_id => ({ store_id: storeId, whatsapp_number_id }));
      if (rows.length > 0) {
        const { error } = await supabase.from('pos_store_whatsapp_numbers').insert(rows);
        if (error) throw error;
      }
      toast.success("Números vinculados salvos!");
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setSavingNumbers(false);
    }
  };

  const loadSellers = async () => {
    const { data } = await supabase.from('pos_sellers').select('*').eq('store_id', storeId).order('name');
    setSellers(data || []);
  };

  const loadInvoiceConfig = async () => {
    const { data } = await supabase.from('pos_invoice_config').select('*').eq('store_id', storeId).maybeSingle();
    if (data) {
      setAutoEmit(data.auto_emit_on_sale);
      setAutoEmitMinValue(String(data.auto_emit_min_value || 0));
      setAutoEmitMethods((data as any).auto_emit_payment_methods || []);
    }
  };

  const loadSyncInfo = async () => {
    const { data: log } = await supabase
      .from('pos_product_sync_log')
      .select('status, products_synced, completed_at, total_products')
      .eq('store_id', storeId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastSync(log);

    const { count } = await supabase
      .from('pos_products')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId);
    setProductCount(count || 0);
  };

  // ─── Prizes ─────────────────────────────
  const loadPrizes = async () => {
    const { data } = await supabase.from('pos_prizes').select('*').eq('store_id', storeId).order('min_points');
    setPrizes(data || []);
  };

  const addPrize = async () => {
    if (!newPrize.name.trim()) return;
    try {
      const { error } = await supabase.from('pos_prizes').insert({
        store_id: storeId,
        name: newPrize.name,
        description: newPrize.description || null,
        min_points: parseInt(newPrize.min_points) || 100,
        prize_type: newPrize.prize_type,
      });
      if (error) throw error;
      toast.success("Prêmio adicionado!");
      setNewPrize({ name: "", description: "", min_points: "100", prize_type: "weekly" });
      setShowAddPrize(false);
      loadPrizes();
    } catch { toast.error("Erro ao adicionar prêmio"); }
  };

  const removePrize = async (id: string) => {
    await supabase.from('pos_prizes').delete().eq('id', id);
    loadPrizes();
  };

  const togglePrize = async (id: string, isActive: boolean) => {
    await supabase.from('pos_prizes').update({ is_active: !isActive }).eq('id', id);
    loadPrizes();
  };

  // ─── Seller Tasks ─────────────────────────────
  const loadTasks = async () => {
    const { data } = await supabase.from('pos_seller_tasks').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(50);
    setTasks(data || []);
  };

  const addTask = async () => {
    if (!newTask.title.trim() || !newTask.seller_id) { toast.error("Preencha vendedora e título"); return; }
    try {
      const { error } = await supabase.from('pos_seller_tasks').insert({
        store_id: storeId,
        seller_id: newTask.seller_id,
        title: newTask.title,
        description: newTask.description || null,
        customer_phone: newTask.customer_phone || null,
        customer_name: newTask.customer_name || null,
        task_type: newTask.task_type,
        points_reward: parseInt(newTask.points_reward) || 5,
        due_date: newTask.due_date || null,
        source: 'manual',
      });
      if (error) throw error;
      toast.success("Tarefa criada!");
      setNewTask({ seller_id: "", title: "", description: "", customer_phone: "", customer_name: "", task_type: "contact", points_reward: "5", due_date: "" });
      setShowAddTask(false);
      loadTasks();
    } catch { toast.error("Erro ao criar tarefa"); }
  };

  const completeTask = async (taskId: string, pointsReward: number, sellerId: string) => {
    try {
      await supabase.from('pos_seller_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', taskId);
      // Add points to gamification
      const { data: gam } = await supabase.from('pos_gamification').select('id, weekly_points, total_points').eq('seller_id', sellerId).eq('store_id', storeId).maybeSingle();
      if (gam) {
        await supabase.from('pos_gamification').update({
          weekly_points: (gam.weekly_points || 0) + pointsReward,
          total_points: (gam.total_points || 0) + pointsReward,
        }).eq('id', gam.id);
      }
      toast.success(`Tarefa concluída! +${pointsReward} pts`);
      loadTasks();
    } catch { toast.error("Erro ao concluir tarefa"); }
  };

  const deleteTask = async (id: string) => {
    await supabase.from('pos_seller_tasks').delete().eq('id', id);
    loadTasks();
  };

  const generateRfmTasks = async () => {
    setGeneratingTasks(true);
    try {
      // Fetch at-risk / sleeping customers from zoppy_customers
      const { data: atRiskCustomers } = await supabase
        .from('zoppy_customers')
        .select('first_name, last_name, phone, rfm_segment, total_spent, last_purchase_at')
        .in('rfm_segment', ['Em Risco', 'Quase Dormindo', 'Não Pode Perder'])
        .not('phone', 'is', null)
        .order('total_spent', { ascending: false })
        .limit(20);

      if (!atRiskCustomers || atRiskCustomers.length === 0) {
        toast.info("Nenhum cliente em risco encontrado");
        setGeneratingTasks(false);
        return;
      }

      // Distribute among active sellers round-robin
      const activeSellers = sellers.filter(s => s.is_active);
      if (activeSellers.length === 0) { toast.error("Nenhuma vendedora ativa"); setGeneratingTasks(false); return; }

      const taskTypeMap: Record<string, { title: string; points: number }> = {
        'Em Risco': { title: 'Resgatar cliente em risco', points: 10 },
        'Quase Dormindo': { title: 'Reativar cliente quase dormindo', points: 8 },
        'Não Pode Perder': { title: 'Contato VIP - não pode perder', points: 15 },
      };

      const newTasks = atRiskCustomers.map((c, i) => {
        const seller = activeSellers[i % activeSellers.length];
        const info = taskTypeMap[c.rfm_segment || ''] || { title: 'Contato com cliente', points: 5 };
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        return {
          store_id: storeId,
          seller_id: seller.id,
          title: info.title,
          description: `${name} - Última compra: ${c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString('pt-BR') : 'N/A'} - Total gasto: R$ ${(c.total_spent || 0).toFixed(2)}`,
          customer_phone: c.phone,
          customer_name: name,
          task_type: 'contact',
          points_reward: info.points,
          source: 'rfm_auto',
          rfm_segment: c.rfm_segment,
          due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        };
      });

      const { error } = await supabase.from('pos_seller_tasks').insert(newTasks);
      if (error) throw error;
      toast.success(`${newTasks.length} tarefas geradas automaticamente!`);
      loadTasks();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao gerar tarefas");
    } finally {
      setGeneratingTasks(false);
    }
  };

  const addSeller = async () => {
    if (!newSellerName.trim()) return;
    try {
      const { error } = await supabase.from('pos_sellers').insert({ store_id: storeId, name: newSellerName });
      if (error) throw error;
      toast.success("Vendedora adicionada!");
      setNewSellerName("");
      setShowAddSeller(false);
      loadSellers();
    } catch (e) {
      toast.error("Erro ao adicionar");
    }
  };

  const removeSeller = async (id: string) => {
    await supabase.from('pos_sellers').delete().eq('id', id);
    loadSellers();
  };

  const addStore = async () => {
    if (!newStore.name.trim() || !newStore.tiny_token.trim()) {
      toast.error("Nome e token são obrigatórios");
      return;
    }
    try {
      const { error } = await supabase.from('pos_stores').insert(newStore);
      if (error) throw error;
      toast.success("Loja adicionada! Recarregue para vê-la.");
      setNewStore({ name: "", tiny_token: "", address: "" });
      setShowAddStore(false);
    } catch (e) {
      toast.error("Erro ao adicionar loja");
    }
  };

  const saveInvoiceConfig = async () => {
    try {
      const payload = {
        auto_emit_on_sale: autoEmit,
        auto_emit_min_value: parseFloat(autoEmitMinValue) || 0,
        auto_emit_payment_methods: autoEmitMethods,
      };
      const existing = await supabase.from('pos_invoice_config').select('id').eq('store_id', storeId).maybeSingle();
      if (existing.data) {
        await supabase.from('pos_invoice_config').update(payload as any).eq('id', existing.data.id);
      } else {
        await supabase.from('pos_invoice_config').insert({ store_id: storeId, ...payload } as any);
      }
      toast.success("Configuração salva!");
    } catch (e) {
      toast.error("Erro ao salvar");
    }
  };

  // Track how long a "running" status has been unchanged
  const lastRunningCheckRef = useRef<{ synced: number; since: number } | null>(null);

  const triggerResume = async (resumePage: number, resumeLogId: string) => {
    console.log('Triggering resume from page', resumePage, 'logId', resumeLogId);
    toast.info(`Continuando sincronização da página ${resumePage}...`);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-sync-products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          store_id: storeId,
          resume_page: resumePage,
          resume_log_id: resumeLogId,
        }),
      });
    } catch (e) {
      console.error('Resume fetch error:', e);
    }
  };

  const pollSyncProgress = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    lastRunningCheckRef.current = null;
    pollRef.current = setInterval(async () => {
      const { data: log } = await supabase
        .from('pos_product_sync_log')
        .select('id, status, products_synced, total_products, completed_at, error_message, started_at')
        .eq('store_id', storeId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (log) {
        const synced = log.products_synced || 0;
        const total = log.total_products || 0;
        setSyncProgress({ synced, total });

        if (log.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          lastRunningCheckRef.current = null;
          setSyncing(false);
          setSyncProgress(null);
          setLastSync(log);
          loadSyncInfo();
          toast.success(`Sync concluído! ${synced} produtos sincronizados.`);
          } else if (log.status === 'partial') {
          // Auto-resume: the edge function saved progress before timeout
          try {
            const resumeInfo = JSON.parse(log.error_message || '{}');
            if (resumeInfo.resume_page && resumeInfo.resume_log_id) {
              triggerResume(resumeInfo.resume_page, resumeInfo.resume_log_id);
            }
          } catch (e) {
            console.error('Resume parse error:', e);
          }
        } else if (log.status === 'running') {
          // Detect stale "running" — function was killed before saving "partial"
          const now = Date.now();
          if (!lastRunningCheckRef.current || lastRunningCheckRef.current.synced !== synced) {
            lastRunningCheckRef.current = { synced, since: now };
          } else {
            const staleDuration = now - lastRunningCheckRef.current.since;
            if (staleDuration > 90_000) {
              console.warn('Detected stale running sync, restarting...');
              const estimatedPage = Math.max(1, Math.floor(synced / 100) + 1);
              await supabase.from('pos_product_sync_log').update({
                status: 'partial',
                error_message: JSON.stringify({ resume_page: estimatedPage, resume_log_id: log.id }),
              }).eq('id', log.id);
              lastRunningCheckRef.current = null;
              toast.info(`Sync travou, retomando da página ${estimatedPage}...`);
              triggerResume(estimatedPage, log.id);
            }
          }
        } else if (log.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          lastRunningCheckRef.current = null;
          setSyncing(false);
          setSyncProgress(null);
          setLastSync(log);
          toast.error("Erro durante a sincronização");
        }
      }
    }, 3000);
  };

  const syncProducts = async () => {
    setSyncing(true);
    setSyncProgress({ synced: 0, total: 0 });
    toast.info("Sincronizando produtos do Tiny ERP...");
    try {
      fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-sync-products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ store_id: storeId }),
      });
      pollSyncProgress();
    } catch (e) {
      toast.error("Erro ao sincronizar");
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const progressPercent = syncProgress
    ? syncProgress.total > 0
      ? Math.min(100, Math.round((syncProgress.synced / syncProgress.total) * 100))
      : 0
    : 0;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-pos-white flex items-center gap-2">
            <Settings className="h-5 w-5 text-pos-orange" /> Configurações
          </h2>
        </div>

        {/* Product Sync */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 text-pos-orange" /> Sincronização de Produtos</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-pos-white">Produtos no banco local</p>
                <p className="text-2xl font-bold text-pos-orange">{productCount}</p>
              </div>
              <Button
                className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2 h-12 px-6"
                onClick={syncProducts}
                disabled={syncing}
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {syncing ? 'Sincronizando...' : 'Sincronizar Agora'}
              </Button>
            </div>

            {/* Progress Bar */}
            {syncing && syncProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-pos-white/70">
                  <span>Progresso da sincronização</span>
                  <span className="font-mono font-bold text-pos-orange">
                    {syncProgress.total > 0
                      ? `${syncProgress.synced} / ${syncProgress.total} (${progressPercent}%)`
                      : `${syncProgress.synced} produtos...`
                    }
                  </span>
                </div>
                <Progress value={syncProgress.total > 0 ? progressPercent : undefined} className="h-3 bg-pos-white/10" />
                <p className="text-[10px] text-pos-white/40">
                  ⏱ Tempo estimado: ~{syncProgress.total > 0 ? Math.ceil((syncProgress.total - syncProgress.synced) * 0.4 / 60) : '?'} min restante(s)
                </p>
              </div>
            )}

            {!syncing && lastSync && (
              <div className="flex items-center gap-2 text-xs text-pos-white/50">
                {lastSync.status === 'completed' ? (
                  <CheckCircle className="h-3 w-3 text-green-400" />
                ) : lastSync.status === 'error' ? (
                  <AlertCircle className="h-3 w-3 text-red-400" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                Último sync: {lastSync.completed_at ? new Date(lastSync.completed_at).toLocaleString('pt-BR') : 'em andamento'}
                {lastSync.products_synced > 0 && ` • ${lastSync.products_synced} produtos`}
              </div>
            )}
            <p className="text-[10px] text-pos-white/30">
              Sincroniza todos os produtos do Tiny ERP para o banco local, permitindo busca instantânea no PDV.
            </p>
          </CardContent>
        </Card>

        {/* Stores */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><Store className="h-4 w-4 text-pos-orange" /> Lojas</span>
              <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddStore(true)}>
                <Plus className="h-3 w-3" /> Nova Loja
              </Button>
            </CardTitle>
          </CardHeader>
        </Card>

        {/* WhatsApp Numbers per Store */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-pos-white">
              <Phone className="h-4 w-4 text-green-400" /> Instâncias WhatsApp
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-pos-white/50">Selecione quais números de WhatsApp esta loja pode utilizar.</p>
            {allWhatsAppNumbers.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhum número cadastrado no sistema.</p>
            ) : (
              <div className="space-y-2">
                {allWhatsAppNumbers.map(num => (
                  <div key={num.id} className="flex items-center gap-3 p-2 rounded-lg bg-pos-white/5">
                    <Checkbox
                      id={`wn-${num.id}`}
                      checked={linkedNumberIds.has(num.id)}
                      onCheckedChange={() => toggleWhatsAppNumber(num.id)}
                    />
                    <label htmlFor={`wn-${num.id}`} className="flex-1 cursor-pointer">
                      <span className="text-sm text-pos-white">{num.label}</span>
                      <span className="text-xs text-pos-white/40 ml-2">{num.phone_display}</span>
                      {num.provider === 'zapi' && (
                        <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">Z-API</span>
                      )}
                      {num.provider === 'meta' && (
                        <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">Meta</span>
                      )}
                    </label>
                  </div>
                ))}
              </div>
            )}
            <Button
              className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2"
              onClick={saveWhatsAppNumbers}
              disabled={savingNumbers}
            >
              <Save className="h-4 w-4" /> {savingNumbers ? 'Salvando...' : 'Salvar'}
            </Button>
          </CardContent>
        </Card>

        {/* Sellers */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><Users className="h-4 w-4 text-pos-orange" /> Vendedoras</span>
              <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddSeller(true)}>
                <Plus className="h-3 w-3" /> Adicionar
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sellers.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhuma vendedora cadastrada</p>
            ) : sellers.map(s => (
              <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-pos-white/5">
                <span className="text-sm text-pos-white">{s.name}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => removeSeller(s.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ─── Prizes Config ─── */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><Trophy className="h-4 w-4 text-pos-orange" /> Prêmios por Pontuação</span>
              <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddPrize(true)}>
                <Plus className="h-3 w-3" /> Novo Prêmio
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {prizes.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhum prêmio configurado. Adicione metas com pontuação mínima.</p>
            ) : prizes.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-white/10">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-pos-white">{p.name}</span>
                    <Badge className={`text-[10px] ${p.is_active ? 'bg-green-500/20 text-green-400' : 'bg-pos-white/10 text-pos-white/40'}`}>
                      {p.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                    <Badge className="text-[10px] bg-pos-orange/20 text-pos-orange">
                      {p.prize_type === 'weekly' ? 'Semanal' : 'Mensal'}
                    </Badge>
                  </div>
                  {p.description && <p className="text-xs text-pos-white/50 mt-0.5">{p.description}</p>}
                  <p className="text-xs text-pos-orange font-bold mt-1">Mínimo: {p.min_points} pts</p>
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={p.is_active} onCheckedChange={() => togglePrize(p.id, p.is_active)} />
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => removePrize(p.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ─── Seller Tasks ─── */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-pos-orange" /> Tarefas de Contato</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 gap-1" onClick={generateRfmTasks} disabled={generatingTasks}>
                  {generatingTasks ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Gerar por RFM
                </Button>
                <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddTask(true)}>
                  <Plus className="h-3 w-3" /> Manual
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhuma tarefa. Crie manualmente ou gere automaticamente a partir de clientes RFM em risco.</p>
            ) : tasks.map(t => {
              const sellerName = sellers.find(s => s.id === t.seller_id)?.name || t.seller_id;
              return (
                <div key={t.id} className={`p-3 rounded-lg border ${t.status === 'completed' ? 'bg-green-500/5 border-green-500/20' : 'bg-pos-white/5 border-pos-white/10'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${t.status === 'completed' ? 'text-green-400 line-through' : 'text-pos-white'}`}>{t.title}</span>
                        <Badge className="text-[10px] bg-pos-white/10 text-pos-white/60">{sellerName}</Badge>
                        <Badge className="text-[10px] bg-pos-orange/20 text-pos-orange">{t.points_reward} pts</Badge>
                        {t.source === 'rfm_auto' && <Badge className="text-[10px] bg-violet-500/20 text-violet-400">Auto RFM</Badge>}
                        {t.rfm_segment && <Badge className="text-[10px] bg-red-500/20 text-red-400">{t.rfm_segment}</Badge>}
                      </div>
                      {t.description && <p className="text-xs text-pos-white/50 mt-1">{t.description}</p>}
                      {t.customer_name && <p className="text-xs text-pos-white/60 mt-0.5">👤 {t.customer_name} {t.customer_phone ? `• 📞 ${t.customer_phone}` : ''}</p>}
                      {t.due_date && <p className="text-xs text-pos-white/40 mt-0.5">📅 Prazo: {new Date(t.due_date).toLocaleDateString('pt-BR')}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {t.status !== 'completed' && (
                        <Button size="icon" className="h-7 w-7 bg-green-500/20 text-green-400 hover:bg-green-500/30" onClick={() => completeTask(t.id, t.points_reward, t.seller_id)}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={() => deleteTask(t.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-pos-white">
              <Receipt className="h-4 w-4 text-pos-orange" /> Emissão Automática de NF
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-pos-white">Emitir NFC-e automaticamente</p>
                <p className="text-xs text-pos-white/40">Ao finalizar cada venda</p>
              </div>
              <Switch checked={autoEmit} onCheckedChange={setAutoEmit} />
            </div>
            {autoEmit && (
              <>
                <div>
                  <Label className="text-pos-white/70 text-xs">Valor mínimo para emissão automática</Label>
                  <Input type="number" value={autoEmitMinValue} onChange={e => setAutoEmitMinValue(e.target.value)} placeholder="0,00" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs mb-2 block">Formas de pagamento que geram NFC-e</Label>
                  <p className="text-[10px] text-pos-white/40 mb-3">Marque quais formas de pagamento devem emitir nota fiscal automaticamente</p>
                  <div className="space-y-2">
                    {[
                      { key: 'pix', label: 'PIX' },
                      { key: 'credito', label: 'Cartão de Crédito' },
                      { key: 'debito', label: 'Cartão de Débito' },
                      { key: 'dinheiro', label: 'Dinheiro' },
                      { key: 'crediario', label: 'Crediário' },
                      { key: 'transferencia', label: 'Transferência' },
                      { key: 'boleto', label: 'Boleto' },
                    ].map(method => {
                      const isChecked = autoEmitMethods.includes(method.key);
                      return (
                        <div key={method.key} className="flex items-center justify-between p-2 rounded-lg bg-pos-white/5">
                          <span className="text-sm text-pos-white">{method.label}</span>
                          <Switch
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              setAutoEmitMethods(prev =>
                                checked ? [...prev, method.key] : prev.filter(m => m !== method.key)
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" onClick={saveInvoiceConfig}>
              <Save className="h-4 w-4" /> Salvar
            </Button>
          </CardContent>
        </Card>

        {/* Add Seller Dialog */}
        <Dialog open={showAddSeller} onOpenChange={setShowAddSeller}>
          <DialogContent className="bg-pos-black border-pos-orange/30">
            <DialogHeader><DialogTitle className="text-pos-white">Adicionar Vendedora</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input value={newSellerName} onChange={e => setNewSellerName(e.target.value)} placeholder="Nome da vendedora" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={addSeller}>Adicionar</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Store Dialog */}
        <Dialog open={showAddStore} onOpenChange={setShowAddStore}>
          <DialogContent className="bg-pos-black border-pos-orange/30">
            <DialogHeader><DialogTitle className="text-pos-white">Adicionar Loja</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-pos-white/70 text-xs">Nome da Loja</Label>
                <Input value={newStore.name} onChange={e => setNewStore(s => ({ ...s, name: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Token da API Tiny</Label>
                <Input value={newStore.tiny_token} onChange={e => setNewStore(s => ({ ...s, tiny_token: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Endereço (opcional)</Label>
                <Input value={newStore.address} onChange={e => setNewStore(s => ({ ...s, address: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={addStore}>Adicionar Loja</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Prize Dialog */}
        <Dialog open={showAddPrize} onOpenChange={setShowAddPrize}>
          <DialogContent className="bg-pos-black border-pos-orange/30">
            <DialogHeader><DialogTitle className="text-pos-white">Novo Prêmio</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-pos-white/70 text-xs">Nome do Prêmio</Label>
                <Input value={newPrize.name} onChange={e => setNewPrize(s => ({ ...s, name: e.target.value }))} placeholder="Ex: Folga extra" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Descrição (opcional)</Label>
                <Input value={newPrize.description} onChange={e => setNewPrize(s => ({ ...s, description: e.target.value }))} placeholder="Detalhes do prêmio" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Pontuação Mínima</Label>
                <Input type="number" value={newPrize.min_points} onChange={e => setNewPrize(s => ({ ...s, min_points: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Tipo</Label>
                <Select value={newPrize.prize_type} onValueChange={v => setNewPrize(s => ({ ...s, prize_type: v }))}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={addPrize}>Criar Prêmio</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Task Dialog */}
        <Dialog open={showAddTask} onOpenChange={setShowAddTask}>
          <DialogContent className="bg-pos-black border-pos-orange/30 max-w-lg">
            <DialogHeader><DialogTitle className="text-pos-white">Nova Tarefa de Contato</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-pos-white/70 text-xs">Vendedora</Label>
                <Select value={newTask.seller_id} onValueChange={v => setNewTask(s => ({ ...s, seller_id: v }))}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {sellers.filter(s => s.is_active).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Título da Tarefa</Label>
                <Input value={newTask.title} onChange={e => setNewTask(s => ({ ...s, title: e.target.value }))} placeholder="Ex: Ligar para cliente - oferta sandália" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Descrição (opcional)</Label>
                <Textarea value={newTask.description} onChange={e => setNewTask(s => ({ ...s, description: e.target.value }))} placeholder="Detalhes ou script de contato" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange min-h-[60px]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-pos-white/70 text-xs">Nome do Cliente</Label>
                  <Input value={newTask.customer_name} onChange={e => setNewTask(s => ({ ...s, customer_name: e.target.value }))} placeholder="Maria Silva" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Telefone</Label>
                  <Input value={newTask.customer_phone} onChange={e => setNewTask(s => ({ ...s, customer_phone: e.target.value }))} placeholder="33999..." className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-pos-white/70 text-xs">Tipo</Label>
                  <Select value={newTask.task_type} onValueChange={v => setNewTask(s => ({ ...s, task_type: v }))}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contact">Contato / Oferta</SelectItem>
                      <SelectItem value="post_sale">Pós-Venda</SelectItem>
                      <SelectItem value="reactivation">Reativação</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Pontos</Label>
                  <Input type="number" value={newTask.points_reward} onChange={e => setNewTask(s => ({ ...s, points_reward: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Prazo (opcional)</Label>
                <Input type="date" value={newTask.due_date} onChange={e => setNewTask(s => ({ ...s, due_date: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={addTask}>Criar Tarefa</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
