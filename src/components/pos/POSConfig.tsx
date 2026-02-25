import { useState, useEffect, useRef, useCallback } from "react";
import { Settings, Store, Users, Save, Plus, Trash2, Receipt, RefreshCw, Loader2, CheckCircle, AlertCircle, Phone, Trophy, Target, ListChecks, Check, Sparkles, Calendar, Star, Gift, Pencil, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
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
  pin_code?: string | null;
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

  // Prize Wheel Segments
  const [wheelSegments, setWheelSegments] = useState<any[]>([]);
  const [showAddSegment, setShowAddSegment] = useState(false);
  const [newSegment, setNewSegment] = useState({ label: "", color: "#FF6B00", prize_type: "discount_percent", prize_value: "10", probability: "10", expiry_days: "30" });

  // Loyalty Config
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true);
  const [pointsPerReal, setPointsPerReal] = useState("0.1");
  const [pointsExpiryDays, setPointsExpiryDays] = useState("365");
  const [wheelEnabled, setWheelEnabled] = useState(false);
  const [loyaltyConfigId, setLoyaltyConfigId] = useState<string | null>(null);
  const [savingLoyalty, setSavingLoyalty] = useState(false);

  // Loyalty Prize Tiers
  const [loyaltyTiers, setLoyaltyTiers] = useState<any[]>([]);
  const [showAddTier, setShowAddTier] = useState(false);
  const [newTier, setNewTier] = useState({ name: "", min_points: "50", prize_type: "discount_percent", prize_value: "10", prize_label: "", color: "#FFD700" });

  // WhatsApp Pricing Rules
  const [pickupDiscount, setPickupDiscount] = useState("10");
  const [deliveryFee, setDeliveryFee] = useState("0");
  const [storeMarkup, setStoreMarkup] = useState("0");
  const [pricingActive, setPricingActive] = useState(true);
  const [savingPricing, setSavingPricing] = useState(false);

  // Goals
  const [goals, setGoals] = useState<any[]>([]);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newGoal, setNewGoal] = useState({ goal_type: "revenue", goal_value: "", period: "daily", seller_id: "all", goal_category: "", goal_brand: "", period_start: "", period_end: "", prize_label: "", prize_value: "", prize_type: "" });
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);

  // Commission Tiers (new goal-based model)
  const [commissionTiers, setCommissionTiers] = useState<any[]>([]);
  const [showAddCommTier, setShowAddCommTier] = useState(false);
  const [commGoalValue, setCommGoalValue] = useState("");
  const [newCommTier, setNewCommTier] = useState({ achievement_percent: "", commission_percent: "" });

  // Seller selection for RFM tasks (persisted)
  const [selectedTaskSellers, setSelectedTaskSellers] = useState<Set<string>>(new Set());

  const SEGMENT_COLORS = ["#FF6B00", "#E91E63", "#9C27B0", "#3F51B5", "#00BCD4", "#4CAF50", "#FFEB3B", "#FF5722", "#795548", "#607D8B"];

  // Load persisted seller selection
  useEffect(() => {
    const loadPersistedSellers = async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', `pos_task_sellers_${storeId}`)
        .maybeSingle();
      if (data?.value && Array.isArray(data.value)) {
        setSelectedTaskSellers(new Set(data.value as string[]));
      }
    };
    loadPersistedSellers();
  }, [storeId]);

  // Persist seller selection when it changes
  const updateSelectedTaskSellers = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setSelectedTaskSellers(prev => {
      const next = updater(prev);
      // Persist to app_settings
      supabase
        .from('app_settings')
        .upsert({ key: `pos_task_sellers_${storeId}`, value: [...next] as any }, { onConflict: 'key' })
        .then();
      return next;
    });
  }, [storeId]);

  useEffect(() => {
    loadSellers();
    loadInvoiceConfig();
    loadSyncInfo();
    loadWhatsAppNumbers();
    loadPrizes();
    loadTasks();
    loadWheelSegments();
    loadLoyaltyConfig();
    loadLoyaltyTiers();
    loadPricingRules();
    loadGoals();
    loadCategoriesAndBrands();
    loadCommissionTiers();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [storeId]);

  const loadPricingRules = async () => {
    const { data } = await supabase
      .from("pos_product_pricing_rules" as any)
      .select("*")
      .eq("store_id", storeId)
      .maybeSingle();
    if (data) {
      const d = data as any;
      setPickupDiscount(String(d.pickup_discount_percent || 10));
      setDeliveryFee(String(d.delivery_fee || 0));
      setStoreMarkup(String(d.physical_store_markup_percent || 0));
      setPricingActive(d.is_active !== false);
    }
  };

  const savePricingRules = async () => {
    setSavingPricing(true);
    try {
      const payload = {
        store_id: storeId,
        pickup_discount_percent: parseFloat(pickupDiscount) || 0,
        delivery_fee: parseFloat(deliveryFee) || 0,
        physical_store_markup_percent: parseFloat(storeMarkup) || 0,
        is_active: pricingActive,
      };
      await supabase.from("pos_product_pricing_rules" as any).upsert(payload, { onConflict: "store_id" });
      toast.success("Precificação salva!");
    } catch { toast.error("Erro ao salvar"); }
    finally { setSavingPricing(false); }
  };

  const loadGoals = async () => {
    const { data } = await supabase.from('pos_goals').select('*').eq('store_id', storeId).order('created_at', { ascending: false });
    setGoals(data || []);
  };

  const loadCommissionTiers = async () => {
    const { data } = await supabase.from('pos_seller_commission_tiers' as any).select('*').eq('store_id', storeId).order('tier_order');
    setCommissionTiers(data || []);
    // Load goal value from first tier
    if (data && data.length > 0) {
      setCommGoalValue(String((data as any[])[0].goal_value || ''));
    }
  };

  const addCommissionTier = async () => {
    if (!newCommTier.achievement_percent || !newCommTier.commission_percent) return;
    try {
      await supabase.from('pos_seller_commission_tiers' as any).insert({
        store_id: storeId,
        tier_order: commissionTiers.length,
        goal_value: parseFloat(commGoalValue) || 0,
        achievement_percent: parseFloat(newCommTier.achievement_percent) || 0,
        commission_percent: parseFloat(newCommTier.commission_percent) || 0,
        min_revenue: 0,
        max_revenue: null,
      });
      toast.success("Faixa de comissão adicionada!");
      setNewCommTier({ achievement_percent: "", commission_percent: "" });
      setShowAddCommTier(false);
      loadCommissionTiers();
    } catch { toast.error("Erro ao adicionar faixa"); }
  };

  const saveCommGoalValue = async () => {
    if (commissionTiers.length === 0) return;
    const goalVal = parseFloat(commGoalValue) || 0;
    for (const tier of commissionTiers) {
      await supabase.from('pos_seller_commission_tiers' as any).update({ goal_value: goalVal }).eq('id', tier.id);
    }
    toast.success("Meta atualizada!");
    loadCommissionTiers();
  };

  const deleteCommissionTier = async (id: string) => {
    await supabase.from('pos_seller_commission_tiers' as any).delete().eq('id', id);
    loadCommissionTiers();
  };

  const loadCategoriesAndBrands = async () => {
    const { data: catData } = await supabase.from('pos_products').select('category').eq('store_id', storeId).eq('is_active', true).not('category', 'is', null);
    const { data: brandData } = await supabase.from('pos_products').select('brand' as any).eq('store_id', storeId).eq('is_active', true).not('brand' as any, 'is', null);
    const cats = [...new Set((catData || []).map((r: any) => r.category).filter(Boolean))].sort();
    const brs = [...new Set((brandData || []).map((r: any) => r.brand).filter(Boolean))].sort();
    setCategories(cats as string[]);
    setBrands(brs as string[]);
  };

  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);

  const saveGoal = async (overrides?: Partial<typeof newGoal>) => {
    const g = { ...newGoal, ...overrides };
    if (!g.goal_value) return;

    // Handle month-based periods inline
    let period = g.period;
    let periodStart = g.period_start || null;
    let periodEnd = g.period_end || null;

    if (period.startsWith('month_')) {
      const parts = period.split('_');
      const year = parseInt(parts[1]);
      const month = parseInt(parts[2]) - 1; // 0-indexed
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      // Use local date components to avoid UTC shift
      periodStart = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      periodEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      period = 'custom';
    }

    try {
      const parsedValue = parseFloat(g.goal_value);
      if (isNaN(parsedValue) || parsedValue <= 0) {
        toast.error("Valor da meta deve ser um número positivo");
        return;
      }

      const payload: any = {
        store_id: storeId,
        goal_type: g.goal_type,
        goal_value: parsedValue,
        period,
        seller_id: g.seller_id === 'all' ? null : g.seller_id,
        is_active: true,
        goal_category: g.goal_category || null,
        goal_brand: g.goal_brand || null,
        period_start: periodStart,
        period_end: periodEnd,
        prize_label: g.prize_label || null,
        prize_value: g.prize_value ? parseFloat(g.prize_value) : null,
        prize_type: g.prize_type || null,
      };

      if (editingGoalId) {
        const { error } = await supabase.from('pos_goals').update(payload).eq('id', editingGoalId);
        if (error) throw error;
        toast.success("Meta atualizada!");
      } else {
        const { error } = await supabase.from('pos_goals').insert(payload);
        if (error) throw error;
        toast.success("Meta adicionada!");
      }
      setNewGoal({ goal_type: "revenue", goal_value: "", period: "daily", seller_id: "all", goal_category: "", goal_brand: "", period_start: "", period_end: "", prize_label: "", prize_value: "", prize_type: "" });
      setEditingGoalId(null);
      setShowAddGoal(false);
      loadGoals();
    } catch (err: any) { toast.error("Erro ao salvar meta: " + (err?.message || "Erro desconhecido")); }
  };

  const startEditGoal = (goal: any) => {
    // Detect if it's a month-based custom period
    let period = goal.period;
    if (period === 'custom' && goal.period_start && goal.period_end) {
      const start = new Date(goal.period_start + 'T12:00:00');
      const end = new Date(goal.period_end + 'T12:00:00');
      // Check if it's a full month (start is 1st, end is last day)
      if (start.getDate() === 1) {
        const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
        if (end.getDate() === lastDay && start.getMonth() === end.getMonth()) {
          period = `month_${start.getFullYear()}_${start.getMonth() + 1}`;
        }
      }
    }

    setNewGoal({
      goal_type: goal.goal_type,
      goal_value: String(goal.goal_value),
      period,
      seller_id: goal.seller_id || 'all',
      goal_category: goal.goal_category || '',
      goal_brand: goal.goal_brand || '',
      period_start: goal.period_start || '',
      period_end: goal.period_end || '',
      prize_label: goal.prize_label || '',
      prize_value: goal.prize_value ? String(goal.prize_value) : '',
      prize_type: goal.prize_type || '',
    });
    setEditingGoalId(goal.id);
    setShowAddGoal(true);
  };

  const deleteGoal = async (id: string) => {
    await supabase.from('pos_goals').delete().eq('id', id);
    loadGoals();
  };

  const loadLoyaltyConfig = async () => {
    // Load global config (store_id IS NULL) first, fallback to store-specific
    let { data } = await supabase.from('loyalty_config').select('*').is('store_id', null).maybeSingle() as any;
    if (!data) {
      const res = await supabase.from('loyalty_config').select('*').eq('store_id', storeId).maybeSingle() as any;
      data = res.data;
    }
    if (data) {
      setLoyaltyConfigId(data.id);
      setLoyaltyEnabled(data.is_enabled);
      setPointsPerReal(String(data.points_per_real));
      setPointsExpiryDays(String(data.points_expiry_days));
      setWheelEnabled(data.wheel_enabled);
    }
  };

  const saveLoyaltyConfig = async () => {
    setSavingLoyalty(true);
    try {
      const payload = {
        is_enabled: loyaltyEnabled,
        points_per_real: parseFloat(pointsPerReal) || 0.1,
        points_expiry_days: parseInt(pointsExpiryDays) || 365,
        wheel_enabled: wheelEnabled,
      };
      if (loyaltyConfigId) {
        await supabase.from('loyalty_config').update(payload).eq('id', loyaltyConfigId);
      } else {
        // Create global config (store_id = null)
        const { data } = await supabase.from('loyalty_config').insert({ store_id: null, ...payload } as any).select('id').single();
        if (data) setLoyaltyConfigId(data.id);
      }
      toast.success("Configuração de fidelidade salva (global - todas as lojas)!");
    } catch { toast.error("Erro ao salvar"); }
    finally { setSavingLoyalty(false); }
  };

  const loadLoyaltyTiers = async () => {
    // Global tiers first, fallback to store-specific
    let { data } = await supabase.from('loyalty_prize_tiers').select('*').is('store_id', null).order('min_points') as any;
    if (!data || data.length === 0) {
      const res = await supabase.from('loyalty_prize_tiers').select('*').eq('store_id', storeId).order('min_points') as any;
      data = res.data;
    }
    setLoyaltyTiers(data || []);
  };

  const addLoyaltyTier = async () => {
    if (!newTier.name.trim() || !newTier.prize_label.trim()) return;
    try {
      // Save globally (store_id = null)
      const { error } = await supabase.from('loyalty_prize_tiers').insert({
        store_id: null,
        name: newTier.name,
        min_points: parseInt(newTier.min_points) || 50,
        prize_type: newTier.prize_type,
        prize_value: parseFloat(newTier.prize_value) || 0,
        prize_label: newTier.prize_label,
        color: newTier.color,
        sort_order: loyaltyTiers.length,
      } as any);
      if (error) throw error;
      toast.success("Tier adicionado (global)!");
      setNewTier({ name: "", min_points: "50", prize_type: "discount_percent", prize_value: "10", prize_label: "", color: "#FFD700" });
      setShowAddTier(false);
      loadLoyaltyTiers();
    } catch { toast.error("Erro ao adicionar tier"); }
  };


  const removeLoyaltyTier = async (id: string) => {
    await supabase.from('loyalty_prize_tiers').delete().eq('id', id);
    loadLoyaltyTiers();
  };

  const toggleLoyaltyTier = async (id: string, isActive: boolean) => {
    await supabase.from('loyalty_prize_tiers').update({ is_active: !isActive }).eq('id', id);
    loadLoyaltyTiers();
  };

  const loadWheelSegments = async () => {
    const { data } = await supabase.from('prize_wheel_segments').select('*').eq('store_id', storeId).order('sort_order') as any;
    setWheelSegments(data || []);
  };

  const addWheelSegment = async () => {
    if (!newSegment.label.trim()) return;
    try {
      const { error } = await supabase.from('prize_wheel_segments').insert({
        store_id: storeId,
        label: newSegment.label,
        color: newSegment.color,
        prize_type: newSegment.prize_type,
        prize_value: parseFloat(newSegment.prize_value) || 0,
        probability: parseFloat(newSegment.probability) || 10,
        expiry_days: parseInt(newSegment.expiry_days) || 30,
        sort_order: wheelSegments.length,
      } as any);
      if (error) throw error;
      toast.success("Segmento adicionado!");
      setNewSegment({ label: "", color: SEGMENT_COLORS[(wheelSegments.length + 1) % SEGMENT_COLORS.length], prize_type: "discount_percent", prize_value: "10", probability: "10", expiry_days: "30" });
      setShowAddSegment(false);
      loadWheelSegments();
    } catch { toast.error("Erro ao adicionar segmento"); }
  };

  const removeWheelSegment = async (id: string) => {
    await supabase.from('prize_wheel_segments').delete().eq('id', id);
    loadWheelSegments();
  };

  const toggleWheelSegment = async (id: string, isActive: boolean) => {
    await supabase.from('prize_wheel_segments').update({ is_active: !isActive }).eq('id', id);
    loadWheelSegments();
  };

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
    const { data } = await supabase.from('pos_sellers').select('id, name, is_active, pin_code').eq('store_id', storeId).order('name');
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

  const TINY_SHOPIFY_STORE_ID = '2bd2c08d-321c-47ee-98a9-e27e936818ab';

  const RFM_STRATEGIES: Record<string, { title: string; contact_type: string; offer: string; script: string; points: number }> = {
    'Campeões': { title: 'Pós-Venda / Lançamento', contact_type: 'pos_venda', offer: 'Acesso antecipado a novidades', script: 'Oi [nome], temos novidades exclusivas pra você!', points: 10 },
    'Leais': { title: 'Lançamento / Convite', contact_type: 'lancamento', offer: 'Convite para evento exclusivo', script: 'Vem conhecer nossa nova coleção em primeira mão!', points: 8 },
    'Potenciais': { title: 'Oferta Moderada', contact_type: 'oferta', offer: 'R$ 30 off em compras acima de R$ 150', script: 'Sentimos sua falta! Temos R$ 30 de desconto esperando você', points: 8 },
    'Em Risco': { title: 'Oferta Agressiva', contact_type: 'oferta', offer: 'R$ 50 off em compras acima de R$ 100', script: 'Faz tempo que você não aparece! R$ 50 de desconto só pra você', points: 12 },
    'Quase Dormindo': { title: 'Resgate Urgente', contact_type: 'resgate', offer: 'R$ 50 off em compras acima de R$ 100', script: 'Você é muito especial pra gente! Desconto exclusivo te esperando', points: 10 },
    'Não Pode Perder': { title: 'VIP Resgate', contact_type: 'resgate', offer: 'R$ 80 off em compras acima de R$ 150', script: 'Volta pra gente! Desconto VIP de R$ 80 só pra você', points: 15 },
    'Hibernando': { title: 'Reativação', contact_type: 'reativacao', offer: 'R$ 50 off em compras acima de R$ 100', script: 'Oi [nome]! Muito tempo sem te ver. Presente de R$ 50 pra você', points: 8 },
    'Novos': { title: 'Boas-vindas / Pós-Venda', contact_type: 'pos_venda', offer: 'Obrigado pela primeira compra', script: 'Que bom ter você como cliente! Como foi sua experiência?', points: 5 },
    'Promissores': { title: 'Cross-sell', contact_type: 'oferta', offer: 'R$ 30 off na próxima compra', script: 'Vem conhecer nossos lançamentos! Desconto especial pra você', points: 8 },
  };

  const generateRfmTasks = async () => {
    setGeneratingTasks(true);
    try {
      // Fetch ALL segments for comprehensive contact strategies
      const { data: rfmCustomers } = await supabase
        .from('zoppy_customers')
        .select('first_name, last_name, phone, rfm_segment, total_spent, last_purchase_at, total_orders')
        .not('phone', 'is', null)
        .not('rfm_segment', 'is', null)
        .order('total_spent', { ascending: false })
        .limit(50);

      if (!rfmCustomers || rfmCustomers.length === 0) {
        toast.info("Nenhum cliente RFM encontrado");
        setGeneratingTasks(false);
        return;
      }

      // Determine which sellers to assign tasks to
      const taskSellers = selectedTaskSellers.size > 0 
        ? sellers.filter(s => s.is_active && selectedTaskSellers.has(s.id))
        : sellers.filter(s => s.is_active);
      
      if (taskSellers.length === 0) { toast.error("Nenhuma vendedora selecionada/ativa"); setGeneratingTasks(false); return; }

      // For each customer, find the store where they bought most (physical stores only)
      const phones = rfmCustomers.map(c => c.phone).filter(Boolean);
      const { data: salesByPhone } = await supabase
        .from('pos_sales' as any)
        .select('customer_phone, store_id, seller_id')
        .in('customer_phone', phones)
        .eq('status', 'completed')
        .neq('store_id', TINY_SHOPIFY_STORE_ID);

      // Map phone -> most frequent store
      const phoneStoreMap = new Map<string, string>();
      if (salesByPhone) {
        const phoneStoreCounts = new Map<string, Map<string, number>>();
        for (const sale of salesByPhone as any[]) {
          if (!sale.customer_phone) continue;
          const suffix = sale.customer_phone.replace(/\D/g, '').slice(-8);
          if (!phoneStoreCounts.has(suffix)) phoneStoreCounts.set(suffix, new Map());
          const storeMap = phoneStoreCounts.get(suffix)!;
          storeMap.set(sale.store_id, (storeMap.get(sale.store_id) || 0) + 1);
        }
        for (const [phone, stores] of phoneStoreCounts) {
          let maxStore = '';
          let maxCount = 0;
          for (const [sid, count] of stores) {
            if (count > maxCount) { maxStore = sid; maxCount = count; }
          }
          phoneStoreMap.set(phone, maxStore);
        }
      }

      // Filter customers to this store only
      const filteredCustomers = rfmCustomers.filter(c => {
        const suffix = (c.phone || '').replace(/\D/g, '').slice(-8);
        const assignedStore = phoneStoreMap.get(suffix);
        // If no purchase history, include them (new customers)
        return !assignedStore || assignedStore === storeId;
      });

      if (filteredCustomers.length === 0) {
        toast.info("Nenhum cliente atribuído a esta loja");
        setGeneratingTasks(false);
        return;
      }

      const newTasks = filteredCustomers.map((c, i) => {
        const seller = taskSellers[i % taskSellers.length];
        const segment = c.rfm_segment || 'Novos';
        const strategy = RFM_STRATEGIES[segment] || RFM_STRATEGIES['Novos'];
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        const avgTicket = c.total_orders && c.total_orders > 0 ? (c.total_spent || 0) / c.total_orders : 0;
        return {
          store_id: storeId,
          seller_id: seller.id,
          title: `${strategy.title} - ${segment}`,
          description: `${name} - Última compra: ${c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString('pt-BR') : 'N/A'} - Total gasto: R$ ${(c.total_spent || 0).toFixed(2)} - Ticket médio: R$ ${avgTicket.toFixed(2)}\n\n📋 Script: "${strategy.script.replace('[nome]', c.first_name || name)}"\n💰 Oferta: ${strategy.offer}`,
          customer_phone: c.phone,
          customer_name: name,
          task_type: 'contact',
          points_reward: strategy.points,
          source: 'rfm_auto',
          rfm_segment: segment,
          contact_strategy: strategy.contact_type,
          offer_description: strategy.offer,
          avg_ticket: avgTicket,
          due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        };
      });

      const { error } = await supabase.from('pos_seller_tasks').insert(newTasks);
      if (error) throw error;
      toast.success(`${newTasks.length} tarefas geradas com estratégias de contato!`);
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

  const toggleSellerActive = async (id: string, currentActive: boolean) => {
    const { error } = await supabase.from('pos_sellers').update({ is_active: !currentActive }).eq('id', id);
    if (error) { toast.error("Erro ao atualizar"); return; }
    toast.success(!currentActive ? "Vendedora ativada!" : "Vendedora desativada!");
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
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 font-bold gap-1 text-xs" onClick={async () => {
                  setSyncing(true);
                  try {
                    const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-sellers`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
                      body: JSON.stringify({ store_id: storeId }),
                    });
                    const data = await resp.json();
                    if (data.success) {
                      toast.success(`${data.sellers?.length || 0} vendedoras sincronizadas do Tiny!`);
                      loadSellers();
                    } else {
                      toast.error(data.error || "Erro ao sincronizar");
                    }
                  } catch { toast.error("Erro de conexão"); }
                  finally { setSyncing(false); }
                }} disabled={syncing}>
                  {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Sincronizar Tiny
                </Button>
                <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddSeller(true)}>
                  <Plus className="h-3 w-3" /> Adicionar
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sellers.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhuma vendedora cadastrada</p>
            ) : sellers.map(s => (
              <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-pos-white/5 gap-2">
                <span className="text-sm text-pos-white flex-1">{s.name}</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    maxLength={4}
                    placeholder="PIN"
                    value={s.pin_code || ''}
                    onChange={async (e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setSellers(prev => prev.map(sel => sel.id === s.id ? { ...sel, pin_code: val } : sel));
                      if (val.length === 4 || val.length === 0) {
                        await supabase.from('pos_sellers').update({ pin_code: val || null } as any).eq('id', s.id);
                      }
                    }}
                    className="w-16 h-7 text-xs text-center bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange"
                  />
                  <Switch checked={s.is_active} onCheckedChange={() => toggleSellerActive(s.id, s.is_active)} />
                </div>
              </div>
            ))}
            <p className="text-[10px] text-pos-white/30">PIN de 4 dígitos para acesso ao painel privado. O toggle salva automaticamente.</p>
          </CardContent>
        </Card>

        {/* ─── Goals Config ─── */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><Target className="h-4 w-4 text-pos-orange" /> Metas da Loja</span>
              <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddGoal(true)}>
                <Plus className="h-3 w-3" /> Nova Meta
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {goals.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhuma meta configurada.</p>
            ) : goals.map(g => {
              const sellerName = g.seller_id ? sellers.find(s => s.id === g.seller_id)?.name : "Loja Toda";
              const typeLabel = 
                g.goal_type === 'revenue' ? 'Faturamento' : 
                g.goal_type === 'avg_ticket' ? 'Ticket Médio' : 
                g.goal_type === 'items_sold' ? 'Itens por Venda' : 'Faturamento Vendedor';
              const periodLabel = g.period === 'daily' ? 'Diária' : g.period === 'weekly' ? 'Semanal' : 'Mensal';
              
              return (
                <div key={g.id} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-white/10">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-pos-white">
                        {g.goal_type === 'revenue' ? 'Faturamento' : 
                         g.goal_type === 'avg_ticket' ? 'Ticket Médio' : 
                         g.goal_type === 'items_sold' ? 'Itens por Venda' : 
                         g.goal_type === 'seller_revenue' ? 'Faturamento Vendedor' :
                         g.goal_type === 'category_units' ? `Categoria: ${g.goal_category || ''}` :
                         g.goal_type === 'brand_units' ? `Marca: ${g.goal_brand || ''}` : 'Meta'}
                      </span>
                      <Badge className="text-[10px] bg-pos-orange/20 text-pos-orange">
                        {g.period === 'daily' ? 'Diária' : g.period === 'weekly' ? 'Semanal' : g.period === 'monthly' ? 'Mensal' : g.period === 'custom' && g.period_start ? `${new Date(g.period_start).toLocaleDateString('pt-BR', {day:'2-digit',month:'short'})} - ${new Date(g.period_end).toLocaleDateString('pt-BR', {day:'2-digit',month:'short'})}` : 'Personalizado'}
                      </Badge>
                      <Badge className="text-[10px] bg-pos-white/10 text-pos-white/60">{sellerName}</Badge>
                    </div>
                    <p className="text-lg font-bold text-pos-white mt-1">
                      {g.goal_type.includes('revenue') || g.goal_type === 'avg_ticket' 
                        ? `R$ ${g.goal_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` 
                        : `${g.goal_value} pares`}
                    </p>
                    {g.prize_label && (
                      <p className="text-xs text-yellow-400 mt-1">🏆 Prêmio: {g.prize_label}{g.prize_value ? ` (R$ ${g.prize_value})` : ''}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-pos-orange hover:text-pos-orange/80" onClick={() => startEditGoal(g)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" onClick={() => deleteGoal(g.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* ─── Commission Tiers Config (Goal-based) ─── */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-green-400" /> Comissão por Meta</span>
              <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddCommTier(true)}>
                <Plus className="h-3 w-3" /> Nova Faixa
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-pos-white/50">Defina o valor da meta e as faixas de comissão por % de atingimento. A vendedora só ganha comissão se atingir pelo menos a faixa mínima.</p>
            
            {/* Goal Value */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-pos-white/70 text-xs">Valor da Meta (R$)</Label>
                <Input type="number" value={commGoalValue} onChange={e => setCommGoalValue(e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange text-lg font-bold" placeholder="35000" />
              </div>
              <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-10" onClick={saveCommGoalValue} disabled={commissionTiers.length === 0}>
                <Save className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Tiers */}
            {commissionTiers.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhuma faixa configurada. Adicione faixas de atingimento.</p>
            ) : commissionTiers.sort((a: any, b: any) => Number(a.achievement_percent) - Number(b.achievement_percent)).map((tier: any) => (
              <div key={tier.id} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-white/10">
                <div>
                  <p className="text-sm text-pos-white">
                    Atingir <span className="text-pos-orange font-bold">{Number(tier.achievement_percent)}%</span> da meta
                    {commGoalValue ? ` (R$ ${(Number(tier.achievement_percent) / 100 * parseFloat(commGoalValue)).toLocaleString('pt-BR', { minimumFractionDigits: 0 })})` : ''}
                  </p>
                  <p className="text-lg font-bold text-green-400">{Number(tier.commission_percent)}% de comissão</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" onClick={() => deleteCommissionTier(tier.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {showAddCommTier && (
              <div className="p-3 rounded-lg bg-pos-white/5 border border-pos-orange/30 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-pos-white/70 text-xs">% Atingimento</Label>
                    <Input type="number" value={newCommTier.achievement_percent} onChange={e => setNewCommTier(p => ({ ...p, achievement_percent: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" placeholder="80" />
                  </div>
                  <div>
                    <Label className="text-pos-white/70 text-xs">% Comissão</Label>
                    <Input type="number" step="0.1" value={newCommTier.commission_percent} onChange={e => setNewCommTier(p => ({ ...p, commission_percent: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" placeholder="0.8" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={addCommissionTier}>Salvar Faixa</Button>
                  <Button size="sm" variant="outline" className="border-pos-white/20 text-pos-white/60" onClick={() => setShowAddCommTier(false)}>Cancelar</Button>
                </div>
              </div>
            )}
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

        {/* ─── Loyalty Points Config ─── */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2"><Star className="h-4 w-4 text-yellow-400" /> Programa de Fidelidade (Global - Todas as Lojas)</span>
              <Switch checked={loyaltyEnabled} onCheckedChange={setLoyaltyEnabled} />
            </CardTitle>
          </CardHeader>
          {loyaltyEnabled && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-pos-white/70 text-xs">Pontos por R$ 1,00 gasto</Label>
                  <Input type="number" step="0.01" value={pointsPerReal} onChange={e => setPointsPerReal(e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                  <p className="text-[10px] text-pos-white/40 mt-1">Ex: 0.1 = 1 ponto a cada R$10</p>
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Validade dos pontos (dias)</Label>
                  <Input type="number" value={pointsExpiryDays} onChange={e => setPointsExpiryDays(e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
              </div>
              <div className={cn(
                "flex items-center justify-between p-4 rounded-xl border-2 transition-all",
                wheelEnabled
                  ? "bg-pos-orange/10 border-pos-orange shadow-lg shadow-pos-orange/20"
                  : "bg-pos-white/5 border-pos-white/10"
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center text-lg", wheelEnabled ? "bg-pos-orange/20" : "bg-pos-white/10")}>
                    🎰
                  </div>
                  <div>
                    <p className={cn("text-sm font-bold", wheelEnabled ? "text-pos-orange" : "text-pos-white")}>Roleta de Prêmios</p>
                    <p className="text-xs text-pos-white/40">Ativar roleta para situações especiais (eventos)</p>
                  </div>
                </div>
                <Switch checked={wheelEnabled} onCheckedChange={setWheelEnabled} />
              </div>
              <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" onClick={saveLoyaltyConfig} disabled={savingLoyalty}>
                <Save className="h-4 w-4" /> {savingLoyalty ? 'Salvando...' : 'Salvar Config Fidelidade'}
              </Button>
            </CardContent>
          )}
        </Card>

        {/* ─── Loyalty Prize Tiers ─── */}
        {loyaltyEnabled && (
          <Card className="bg-pos-white/5 border-pos-orange/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between text-pos-white">
                <span className="flex items-center gap-2"><Gift className="h-4 w-4 text-yellow-400" /> Prêmios por Pontos (Tiers)</span>
                <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddTier(true)}>
                  <Plus className="h-3 w-3" /> Novo Tier
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-pos-white/50">Quanto mais pontos o cliente acumular, melhor o prêmio. Configure os tiers de recompensa.</p>
              {loyaltyTiers.length === 0 ? (
                <p className="text-xs text-pos-white/40">Nenhum tier configurado. Adicione tiers para definir os prêmios.</p>
              ) : loyaltyTiers.map((tier: any) => (
                <div key={tier.id} className="flex items-center gap-3 p-3 rounded-lg bg-pos-white/5 border border-pos-white/10">
                  <div className="h-8 w-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: tier.color }}>
                    {tier.min_points}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-pos-white">{tier.name}</span>
                      <Badge className={`text-[10px] ${tier.is_active ? 'bg-green-500/20 text-green-400' : 'bg-pos-white/10 text-pos-white/40'}`}>
                        {tier.is_active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </div>
                    <p className="text-xs text-pos-white/50 mt-0.5">
                      {tier.prize_label} · Mínimo: {tier.min_points} pts ·
                      {tier.prize_type === 'discount_percent' ? ` ${tier.prize_value}% desc` :
                       tier.prize_type === 'discount_fixed' ? ` R$${Number(tier.prize_value).toFixed(2)} desc` :
                       tier.prize_type === 'free_shipping' ? ' Frete grátis' : ` ${tier.prize_label}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={tier.is_active} onCheckedChange={() => toggleLoyaltyTier(tier.id, tier.is_active)} />
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => removeLoyaltyTier(tier.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ─── Prize Wheel Config ─── */}
        <Card className="bg-pos-white/5 border-pos-orange/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between text-pos-white">
              <span className="flex items-center gap-2">🎰 Roleta de Prêmios</span>
              <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowAddSegment(true)}>
                <Plus className="h-3 w-3" /> Novo Segmento
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-pos-white/50">Configure os segmentos da roleta que aparece após cada venda. Cada segmento tem uma probabilidade de ser sorteado.</p>
            {wheelSegments.length === 0 ? (
              <p className="text-xs text-pos-white/40">Nenhum segmento configurado. A roleta não aparecerá no PDV.</p>
            ) : wheelSegments.map((seg: any) => (
              <div key={seg.id} className="flex items-center gap-3 p-3 rounded-lg bg-pos-white/5 border border-pos-white/10">
                <div className="h-8 w-8 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-pos-white">{seg.label}</span>
                    <Badge className={`text-[10px] ${seg.is_active ? 'bg-green-500/20 text-green-400' : 'bg-pos-white/10 text-pos-white/40'}`}>
                      {seg.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </div>
                  <div className="flex gap-3 text-xs text-pos-white/50 mt-0.5">
                    <span>
                      {seg.prize_type === 'discount_percent' ? `${seg.prize_value}% desconto` :
                       seg.prize_type === 'discount_fixed' ? `R$ ${Number(seg.prize_value).toFixed(2)} desconto` :
                       seg.prize_type === 'free_shipping' ? 'Frete grátis' :
                       seg.prize_type === 'gift' ? `Brinde: ${seg.prize_value}` :
                       seg.label}
                    </span>
                    <span>Prob: {seg.probability}%</span>
                    <span>Validade: {seg.expiry_days}d</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={seg.is_active} onCheckedChange={() => toggleWheelSegment(seg.id, seg.is_active)} />
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => removeWheelSegment(seg.id)}>
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
            {/* Seller selection for RFM generation */}
            <div className="p-3 rounded-lg bg-pos-white/5 border border-pos-white/10">
              <p className="text-xs text-pos-white/50 mb-2">Selecione as vendedoras que receberão as tarefas RFM (vazio = todas ativas):</p>
              <div className="flex flex-wrap gap-2">
                {sellers.filter(s => s.is_active).map(s => (
                  <button
                    key={s.id}
                    onClick={() => updateSelectedTaskSellers(prev => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                      selectedTaskSellers.has(s.id)
                        ? "bg-pos-orange text-pos-black border-pos-orange"
                        : "bg-pos-white/5 text-pos-white/60 border-pos-white/20 hover:border-pos-orange/50"
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
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

        {/* Add Goal Dialog */}
        <Dialog open={showAddGoal} onOpenChange={(open) => { setShowAddGoal(open); if (!open) { setEditingGoalId(null); setNewGoal({ goal_type: "revenue", goal_value: "", period: "daily", seller_id: "all", goal_category: "", goal_brand: "", period_start: "", period_end: "", prize_label: "", prize_value: "", prize_type: "" }); } }}>
          <DialogContent className="bg-pos-black border-pos-orange/30 max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-pos-white">{editingGoalId ? 'Editar Meta' : 'Nova Meta'}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-pos-white/70 text-xs">Tipo de Meta</Label>
                <Select value={newGoal.goal_type} onValueChange={v => setNewGoal(s => ({ ...s, goal_type: v }))}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revenue">Faturamento Loja</SelectItem>
                    <SelectItem value="avg_ticket">Ticket Médio</SelectItem>
                    <SelectItem value="items_sold">Itens por Venda</SelectItem>
                    <SelectItem value="seller_revenue">Faturamento Vendedor</SelectItem>
                    <SelectItem value="category_units">Pares por Categoria</SelectItem>
                    <SelectItem value="brand_units">Pares por Marca</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Category selector for category_units */}
              {newGoal.goal_type === 'category_units' && (
                <div>
                  <Label className="text-pos-white/70 text-xs">Categoria do Tiny</Label>
                  <Select value={newGoal.goal_category} onValueChange={v => setNewGoal(s => ({ ...s, goal_category: v }))}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {categories.length === 0 && <p className="text-[10px] text-pos-white/40 mt-1">Sincronize os produtos primeiro para carregar categorias.</p>}
                </div>
              )}

              {/* Brand selector for brand_units */}
              {newGoal.goal_type === 'brand_units' && (
                <div>
                  <Label className="text-pos-white/70 text-xs">Marca</Label>
                  {brands.length > 0 ? (
                    <Select value={newGoal.goal_brand} onValueChange={v => setNewGoal(s => ({ ...s, goal_brand: v }))}>
                      <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione a marca" /></SelectTrigger>
                      <SelectContent>
                        {brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={newGoal.goal_brand} onChange={e => setNewGoal(s => ({ ...s, goal_brand: e.target.value }))} placeholder="Ex: Nike, Adidas" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                  )}
                </div>
              )}

              <div>
                <Label className="text-pos-white/70 text-xs">Período</Label>
                <Select value={newGoal.period} onValueChange={v => setNewGoal(s => ({ ...s, period: v }))}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Diária</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="custom">Período Personalizado</SelectItem>
                    {/* Pre-defined months */}
                    {Array.from({ length: 6 }, (_, i) => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + i);
                      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                      const value = `month_${d.getFullYear()}_${d.getMonth() + 1}`;
                      return <SelectItem key={value} value={value}>{label.charAt(0).toUpperCase() + label.slice(1)}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Custom date range */}
              {(newGoal.period === 'custom' || newGoal.period.startsWith('month_')) && newGoal.period === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-pos-white/70 text-xs">Data Início</Label>
                    <Input type="date" value={newGoal.period_start} onChange={e => setNewGoal(s => ({ ...s, period_start: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                  </div>
                  <div>
                    <Label className="text-pos-white/70 text-xs">Data Fim</Label>
                    <Input type="date" value={newGoal.period_end} onChange={e => setNewGoal(s => ({ ...s, period_end: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                  </div>
                </div>
              )}

              <div>
                <Label className="text-pos-white/70 text-xs">Aplicar a</Label>
                <Select value={newGoal.seller_id} onValueChange={v => setNewGoal(s => ({ ...s, seller_id: v }))}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Loja Toda</SelectItem>
                    {sellers.filter(s => s.is_active).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Valor da Meta</Label>
                <Input type="number" value={newGoal.goal_value} onChange={e => setNewGoal(s => ({ ...s, goal_value: e.target.value }))} placeholder={newGoal.goal_type.includes('units') ? "Ex: 10 pares" : "Ex: 5000"} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>

              {/* Prize/Commission section */}
              <div className="border-t border-pos-orange/20 pt-4 space-y-3">
                <p className="text-xs font-bold text-yellow-400 flex items-center gap-1"><Gift className="h-3 w-3" /> Prêmio / Comissão (opcional)</p>
                <div>
                  <Label className="text-pos-white/70 text-xs">Descrição do Prêmio</Label>
                  <Input value={newGoal.prize_label} onChange={e => setNewGoal(s => ({ ...s, prize_label: e.target.value }))} placeholder="Ex: Bônus de R$100, Folga extra" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-pos-white/70 text-xs">Tipo</Label>
                    <Select value={newGoal.prize_type} onValueChange={v => setNewGoal(s => ({ ...s, prize_type: v }))}>
                      <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bonus">Bônus em R$</SelectItem>
                        <SelectItem value="commission_percent">Comissão %</SelectItem>
                        <SelectItem value="gift">Presente / Brinde</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-pos-white/70 text-xs">Valor (R$ ou %)</Label>
                    <Input type="number" value={newGoal.prize_value} onChange={e => setNewGoal(s => ({ ...s, prize_value: e.target.value }))} placeholder="100" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                  </div>
                </div>
              </div>

              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={() => {
                saveGoal();
              }}>{editingGoalId ? 'Atualizar Meta' : 'Salvar Meta'}</Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={showAddSegment} onOpenChange={setShowAddSegment}>
          <DialogContent className="bg-pos-black border-pos-orange/30">
            <DialogHeader><DialogTitle className="text-pos-white">Novo Segmento da Roleta</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-pos-white/70 text-xs">Nome do Prêmio (aparece na roleta)</Label>
                <Input value={newSegment.label} onChange={e => setNewSegment(s => ({ ...s, label: e.target.value }))} placeholder="Ex: 10% OFF" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Cor do Segmento</Label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {SEGMENT_COLORS.map(c => (
                    <button key={c} className={`h-8 w-8 rounded-full border-2 transition-all ${newSegment.color === c ? 'border-white scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} onClick={() => setNewSegment(s => ({ ...s, color: c }))} />
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Tipo de Prêmio</Label>
                <Select value={newSegment.prize_type} onValueChange={v => setNewSegment(s => ({ ...s, prize_type: v }))}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="discount_percent">Desconto %</SelectItem>
                    <SelectItem value="discount_fixed">Desconto R$</SelectItem>
                    <SelectItem value="free_shipping">Frete Grátis</SelectItem>
                    <SelectItem value="gift">Brinde / Presente</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-pos-white/70 text-xs">Valor</Label>
                  <Input type="number" value={newSegment.prize_value} onChange={e => setNewSegment(s => ({ ...s, prize_value: e.target.value }))} placeholder="10" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Prob. %</Label>
                  <Input type="number" value={newSegment.probability} onChange={e => setNewSegment(s => ({ ...s, probability: e.target.value }))} placeholder="10" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Validade (dias)</Label>
                  <Input type="number" value={newSegment.expiry_days} onChange={e => setNewSegment(s => ({ ...s, expiry_days: e.target.value }))} placeholder="30" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
              </div>
              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={addWheelSegment}>Criar Segmento</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Loyalty Tier Dialog */}
        <Dialog open={showAddTier} onOpenChange={setShowAddTier}>
          <DialogContent className="bg-pos-black border-pos-orange/30">
            <DialogHeader><DialogTitle className="text-pos-white">Novo Tier de Prêmio</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-pos-white/70 text-xs">Nome do Tier</Label>
                <Input value={newTier.name} onChange={e => setNewTier(s => ({ ...s, name: e.target.value }))} placeholder="Ex: Bronze, Prata, Ouro" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Pontos Mínimos</Label>
                <Input type="number" value={newTier.min_points} onChange={e => setNewTier(s => ({ ...s, min_points: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Tipo de Prêmio</Label>
                <Select value={newTier.prize_type} onValueChange={v => setNewTier(s => ({ ...s, prize_type: v }))}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="discount_percent">Desconto %</SelectItem>
                    <SelectItem value="discount_fixed">Desconto R$</SelectItem>
                    <SelectItem value="free_shipping">Frete Grátis</SelectItem>
                    <SelectItem value="gift">Brinde / Presente</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-pos-white/70 text-xs">Valor do Prêmio</Label>
                  <Input type="number" value={newTier.prize_value} onChange={e => setNewTier(s => ({ ...s, prize_value: e.target.value }))} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
                </div>
                <div>
                  <Label className="text-pos-white/70 text-xs">Cor</Label>
                  <div className="flex gap-1.5 flex-wrap mt-1">
                    {["#FFD700", "#C0C0C0", "#CD7F32", "#E91E63", "#9C27B0", "#3F51B5", "#00BCD4", "#4CAF50"].map(c => (
                      <button key={c} className={`h-7 w-7 rounded-full border-2 ${newTier.color === c ? 'border-white scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} onClick={() => setNewTier(s => ({ ...s, color: c }))} />
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-pos-white/70 text-xs">Descrição do Prêmio (aparece pro cliente)</Label>
                <Input value={newTier.prize_label} onChange={e => setNewTier(s => ({ ...s, prize_label: e.target.value }))} placeholder="Ex: 10% de desconto na próxima compra" className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
              </div>
              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={addLoyaltyTier}>Criar Tier</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* WhatsApp Pricing Rules */}
      <Card className="bg-pos-white/5 border-pos-orange/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-pos-orange flex items-center gap-2">
            <Phone className="h-4 w-4" />
            Precificação WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-pos-white/60">Configure os preços diferenciados nos botões ao enviar produtos pelo WhatsApp.</p>
          <div className="flex items-center justify-between">
            <Label className="text-pos-white/80 text-xs">Ativo</Label>
            <Switch checked={pricingActive} onCheckedChange={setPricingActive} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-pos-white/70 text-xs">Desconto Retirada (%)</Label>
              <Input type="number" value={pickupDiscount} onChange={e => setPickupDiscount(e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" placeholder="10" />
              <p className="text-[10px] text-pos-white/40 mt-1">Ex: 10 = 10% off retirada</p>
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Taxa Entrega (R$)</Label>
              <Input type="number" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" placeholder="0" />
              <p className="text-[10px] text-pos-white/40 mt-1">Soma ao preço c/ entrega</p>
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Markup Loja Física (%)</Label>
              <Input type="number" value={storeMarkup} onChange={e => setStoreMarkup(e.target.value)} className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" placeholder="0" />
              <p className="text-[10px] text-pos-white/40 mt-1">Ex: 5 = 5% acima do site</p>
            </div>
          </div>
          <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={savePricingRules} disabled={savingPricing}>
            {savingPricing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Salvar Precificação
          </Button>
        </CardContent>
      </Card>

    </ScrollArea>
  );
}
