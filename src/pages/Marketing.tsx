import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, Search, RefreshCw, Upload, Download, Filter, BarChart3,
  MapPin, Phone, Mail, ShoppingBag, Crown, AlertTriangle, Clock,
  Heart, Star, Zap, ChevronDown, Plus, ArrowUpDown, Megaphone,
  FileSpreadsheet, X, TrendingUp, Send, Brain, Trash2, Tag,
  Eye, CheckCircle2, MessageSquare, Instagram, Store, Globe, Sparkles, Pencil,
  Target, Calendar, ListChecks, Loader2, CheckCircle, XCircle, Link, Copy, ExternalLink, Gift, Bell, Save, Bookmark, Minus, Plus as PlusIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { MetaTemplateCreator } from "@/components/MetaTemplateCreator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useNavigate } from "react-router-dom";

import { CampaignDetail } from "@/components/marketing/CampaignDetail";
import { CampaignCardExpanded } from "@/components/marketing/CampaignCardExpanded";
import { AutomationFlowBuilder } from "@/components/marketing/AutomationFlowBuilder";
import { LeadWhatsAppDialog } from "@/components/marketing/LeadWhatsAppDialog";
import { SectorManager } from "@/components/marketing/SectorManager";
import { GroupsVipManager } from "@/components/marketing/GroupsVipManager";
import { LiveSessionManager } from "@/components/LiveSessionManager";
import { MassTemplateDispatcher } from "@/components/marketing/MassTemplateDispatcher";
import { PrizeManager } from "@/components/marketing/PrizeManager";
import { CatalogLandingPageCreator } from "@/components/marketing/CatalogLandingPageCreator";
import { MarketingCalendar } from "@/components/marketing/MarketingCalendar";
import { LinkPageManager } from "@/components/marketing/LinkPageManager";
import { CrmMessageTemplateSelector } from "@/components/marketing/CrmMessageTemplateSelector";
import * as XLSX from "@e965/xlsx";
import PushNotificationPanel from "@/components/marketing/PushNotificationPanel";
import { CatalogLeadPageCreator } from "@/components/marketing/CatalogLeadPageCreator";
import { LeadImportDialog } from "@/components/marketing/LeadImportDialog";
import WhatsAppAdKeywords from "@/components/marketing/WhatsAppAdKeywords";
import { MarketingAttributionDashboard } from "@/components/marketing/MarketingAttributionDashboard";
import AdCampaignManager from "@/components/marketing/AdCampaignManager";
import InstagramCommentAutomation from "@/components/marketing/InstagramCommentAutomation";

// ─── Types ──────────────────────────────────────

interface ZoppyCustomer {
  id: string;
  zoppy_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  region_type: string;
  ddd: string | null;
  zoppy_position: string | null;
  rfm_recency_score: number | null;
  rfm_frequency_score: number | null;
  rfm_monetary_score: number | null;
  rfm_total_score: number | null;
  rfm_segment: string | null;
  total_orders: number;
  total_spent: number;
  avg_ticket: number;
  last_purchase_at: string | null;
  first_purchase_at: string | null;
  tags: string[] | null;
  opt_out_mass_dispatch?: boolean;
}

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  objective: string | null;
  target_audience: string | null;
  ai_strategy: any;
  channels: string[] | null;
  start_date?: string;
  end_date?: string;
  budget?: number;
  actual_cost?: number;
  attributed_revenue?: number;
  attributed_orders?: number;
  leads_captured?: number;
  people_reached?: number;
  total_recipients: number | null;
  sent_count: number | null;
  delivered_count: number | null;
  read_count: number | null;
  created_at: string;
}

// ─── Constants ──────────────────────────────────────

const RFM_SEGMENT_COLORS: Record<string, string> = {
  "Campeões": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  "Leais": "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  "Potenciais Leais": "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
  "Novos Clientes": "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
  "Promissores": "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  "Precisam Atenção": "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  "Quase Dormindo": "bg-stone-500/15 text-stone-700 dark:text-stone-400 border-stone-500/30",
  "Em Risco": "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  "Não Pode Perder": "bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/30",
  "Hibernando": "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30",
  "Perdidos": "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/30",
};

const RFM_SEGMENT_ICONS: Record<string, typeof Crown> = {
  "Campeões": Crown, "Leais": Heart, "Novos Clientes": Star,
  "Promissores": TrendingUp, "Em Risco": AlertTriangle, "Quase Dormindo": Clock, "Hibernando": Clock,
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  sending: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho", review: "Em Revisão", approved: "Aprovada", sending: "Enviando", completed: "Concluída",
};

const CHANNEL_ICONS: Record<string, typeof Send> = {
  whatsapp: MessageSquare, instagram: Instagram, email: Mail, loja_fisica: Store, site: Globe, outros: Sparkles,
};

// ─── Component ──────────────────────────────────────

export default function Marketing() {
  const navigate = useNavigate();

  // Force dark mode on this page
  useEffect(() => {
    const root = document.documentElement;
    const prevTheme = root.classList.contains('dark') ? 'dark' : 'light';
    root.classList.remove('light');
    root.classList.add('dark');
    return () => {
      root.classList.remove('dark');
      root.classList.add(prevTheme);
    };
  }, []);

  const [activeTab, setActiveTab] = useState("calendar");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [landingPages, setLandingPages] = useState<any[]>([]);

  // Leads state
  const [leads, setLeads] = useState<any[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsCampaignFilter, setLeadsCampaignFilter] = useState<string>("all");
  const [leadsSearch, setLeadsSearch] = useState("");
  const [leadChatPhone, setLeadChatPhone] = useState<string | null>(null);
  const [leadChatName, setLeadChatName] = useState<string>("");
  const [leadBackfillStatus, setLeadBackfillStatus] = useState<{
    status: "idle" | "processing" | "completed" | "failed";
    progress: number;
    stage: string;
    detail: string;
    totalPhones?: number;
    customersExcluded?: number;
    existingLeadsExcluded?: number;
    inserted?: number;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
  } | null>(null);
  const leadBackfillPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // Customers state
  const [customers, setCustomers] = useState<ZoppyCustomer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [rfmFilter, setRfmFilter] = useState<string>("all");
  const [dddFilter, setDddFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("total_spent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<'campaign' | 'rfm'>('campaign');
  const [uploadStatus, setUploadStatus] = useState<{ stage: string; progress: number; detail: string; error?: string; done?: boolean } | null>(null);
  const [leadImportOpen, setLeadImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rfmFileInputRef = useRef<HTMLInputElement>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ticketMin, setTicketMin] = useState("");
  const [ticketMax, setTicketMax] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<ZoppyCustomer | null>(null);
  const [whatsAppMessage, setWhatsAppMessage] = useState("");
  const [editingCustomer, setEditingCustomer] = useState<ZoppyCustomer | null>(null);
  const [purchaseDates, setPurchaseDates] = useState<{ date: string; total: number; source: string; products: { name: string; qty: number; price: number }[]; store?: string; seller?: string }[] | null>(null);
  const [purchaseDatesLoading, setPurchaseDatesLoading] = useState(false);
  const [customerCashback, setCustomerCashback] = useState<{ total_points: number; expires_at: string } | null>(null);
  const [customerPrizes, setCustomerPrizes] = useState<{ prize_label: string; coupon_code: string; is_redeemed: boolean; expires_at: string; prize_value: number }[]>([]);
  const [expandedPurchase, setExpandedPurchase] = useState<number | null>(null);
  const [customerDispatches, setCustomerDispatches] = useState<{ campaign_name: string | null; template_name: string; started_at: string; status: string | null }[]>([]);
  const [customerDispatchesLoading, setCustomerDispatchesLoading] = useState(false);
  const [editingLead, setEditingLead] = useState<any | null>(null);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [ordersMin, setOrdersMin] = useState("");
  const [ordersMax, setOrdersMax] = useState("");
   const [topN, setTopN] = useState<string>("all");
   const [recencyFilter, setRecencyFilter] = useState<string>("all");
   const [customerStoreMap, setCustomerStoreMap] = useState<Map<string, { store_id: string; store_name: string; seller_id: string; seller_name: string }>>(new Map());
   const [storesList, setStoresList] = useState<{ id: string; name: string }[]>([]);
   const [sellersList, setSellersList] = useState<{ id: string; name: string }[]>([]);
   const [savedPresets, setSavedPresets] = useState<{ id: string; key: string; value: any }[]>([]);
   const [presetName, setPresetName] = useState("");
   const [presetDialogOpen, setPresetDialogOpen] = useState(false);
   const [excludedPresetIds, setExcludedPresetIds] = useState<string[]>([]);
   const [includedPresetIds, setIncludedPresetIds] = useState<string[]>([]);
   const [presetOpsOpen, setPresetOpsOpen] = useState(false);
   const [tagFilter, setTagFilter] = useState<string>("all");

  // ─── Fetch data ──────────────────────────────

  const stopLeadBackfillPolling = useCallback(() => {
    if (leadBackfillPollingRef.current) {
      clearInterval(leadBackfillPollingRef.current);
      leadBackfillPollingRef.current = null;
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch up to 10000 customers in batches to bypass the 1000-row default limit
      let allCustomers: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let keepFetching = true;
      while (keepFetching) {
        const { data, error } = await supabase
          .from('zoppy_customers')
          .select('*')
          .order('total_spent', { ascending: false })
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          allCustomers = allCustomers.concat(data);
          from += batchSize;
          if (data.length < batchSize) keepFetching = false;
        } else {
          keepFetching = false;
        }
        if (allCustomers.length >= 50000) keepFetching = false; // safety cap
      }
      setCustomers(allCustomers as ZoppyCustomer[]);
    } catch (err) { console.error(err); toast.error("Erro ao carregar clientes"); }
    finally { setIsLoading(false); }
  }, []);

  const fetchCampaigns = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('marketing_campaigns').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setCampaigns(data || []);
    } catch (err) { console.error(err); }
  }, []);

  const fetchLandingPages = useCallback(async () => {
    try {
      const { data } = await supabase.from('campaign_landing_pages').select('*, marketing_campaigns(name)').order('created_at', { ascending: false });
      setLandingPages(data || []);
    } catch (err) { console.error(err); }
  }, []);

  const fetchLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const allLeads: any[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('lp_leads')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allLeads.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setLeads(allLeads);
    } catch (err) { console.error(err); }
    finally { setLeadsLoading(false); }
  }, []);

  const fetchLeadBackfillStatus = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      const { data, error } = await supabase.functions.invoke('backfill-organic-leads', {
        body: { action: 'status' },
      });
      if (error) throw error;

      const job = ((data as any)?.job ?? null) as typeof leadBackfillStatus;
      setLeadBackfillStatus(job);

      if (job?.status && job.status !== 'processing') {
        stopLeadBackfillPolling();
      }

      if (job?.status === 'completed') {
        fetchLeads();
      }

      if (job?.status === 'failed' && !silent) {
        toast.error('Erro no backfill: ' + (job.error || 'Erro desconhecido'));
      }

      return job;
    } catch (err: any) {
      if (!silent) {
        toast.error('Erro ao consultar progresso do backfill: ' + (err.message || 'Erro desconhecido'));
      }
      throw err;
    }
  }, [fetchLeads, stopLeadBackfillPolling]);

  const startLeadBackfillPolling = useCallback(() => {
    stopLeadBackfillPolling();
    leadBackfillPollingRef.current = setInterval(async () => {
      try {
        const job = await fetchLeadBackfillStatus({ silent: true });
        if (job?.status === 'completed') {
          toast.success(`✅ Backfill concluído: ${job.inserted || 0} leads criados`);
        } else if (job?.status === 'failed') {
          toast.error('Erro no backfill: ' + (job.error || 'Erro desconhecido'));
        }
      } catch (error) {
        console.error(error);
      }
    }, 2000);
  }, [fetchLeadBackfillStatus, stopLeadBackfillPolling]);

  const handleStartLeadBackfill = useCallback(async () => {
    if (!confirm('Isso vai cadastrar retroativamente todos os contatos orgânicos dos últimos 3 meses como leads. Continuar?')) return;

    try {
      toast.info('Iniciando busca retroativa de leads orgânicos...');
      const { data, error } = await supabase.functions.invoke('backfill-organic-leads', {
        body: { action: 'start' },
      });
      if (error) throw error;

      const job = ((data as any)?.job ?? null) as typeof leadBackfillStatus;
      setLeadBackfillStatus(job);

      if (job?.status === 'processing') {
        startLeadBackfillPolling();
      } else if (job?.status === 'completed') {
        toast.success(`✅ Backfill concluído: ${job.inserted || 0} leads criados`);
        fetchLeads();
      } else if (job?.status === 'failed') {
        toast.error('Erro no backfill: ' + (job.error || 'Erro desconhecido'));
      }
    } catch (err: any) {
      toast.error('Erro no backfill: ' + (err.message || 'Erro desconhecido'));
    }
  }, [fetchLeads, startLeadBackfillPolling]);

  const deleteCustomer = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este cliente?')) return;
    const { error } = await supabase.from('zoppy_customers').delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir: ' + error.message); return; }
    setCustomers(prev => prev.filter(c => c.id !== id));
    setSelectedCustomer(null);
    toast.success('Cliente excluído!');
  };

  const saveCustomerEdit = async () => {
    if (!editingCustomer) return;
    const { id, ...rest } = editingCustomer;
    const { error } = await supabase.from('zoppy_customers').update({
      first_name: rest.first_name,
      last_name: rest.last_name,
      phone: rest.phone,
      email: rest.email,
      city: rest.city,
      state: rest.state,
    } as any).eq('id', id);
    if (error) { toast.error('Erro ao salvar: ' + error.message); return; }
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...editingCustomer } : c));
    setSelectedCustomer(prev => prev?.id === id ? { ...prev, ...editingCustomer } : prev);
    setEditingCustomer(null);
    toast.success('Cliente atualizado!');
  };

  const deleteLead = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este lead?')) return;
    const { error } = await supabase.from('lp_leads').delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir: ' + error.message); return; }
    setLeads(prev => prev.filter(l => l.id !== id));
    toast.success('Lead excluído!');
  };

  const saveLeadEdit = async () => {
    if (!editingLead) return;
    const { id, ...rest } = editingLead;
    const { error } = await supabase.from('lp_leads').update({
      name: rest.name,
      phone: rest.phone,
      email: rest.email,
      instagram: rest.instagram,
    } as any).eq('id', id);
    if (error) { toast.error('Erro ao salvar: ' + error.message); return; }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...editingLead } : l));
    setEditingLead(null);
    toast.success('Lead atualizado!');
  };

  useEffect(() => {
    fetchCustomers();
    fetchCampaigns();
    fetchLandingPages();
    fetchLeads();
    fetchLeadBackfillStatus({ silent: true })
      .then((job) => {
        if (job?.status === 'processing') {
          startLeadBackfillPolling();
        }
      })
      .catch(() => undefined);

    return () => stopLeadBackfillPolling();
  }, [fetchCustomers, fetchCampaigns, fetchLandingPages, fetchLeads, fetchLeadBackfillStatus, startLeadBackfillPolling, stopLeadBackfillPolling]);

  // Fetch store/seller mapping for filters
  useEffect(() => {
    const fetchMapping = async () => {
      const [mapRes, storesRes, sellersRes] = await Promise.all([
        supabase.rpc('get_customer_store_seller_map' as any),
        supabase.from('pos_stores').select('id, name').eq('is_active', true).order('name'),
        supabase.from('pos_sellers').select('id, name').eq('is_active', true).order('name'),
      ]);
      if (mapRes.data) {
        const map = new Map<string, any>();
        for (const row of mapRes.data as any[]) {
          map.set(row.customer_phone, row);
        }
        setCustomerStoreMap(map);
      }
      setStoresList((storesRes.data || []) as any[]);
      setSellersList((sellersRes.data || []) as any[]);
    };
    fetchMapping();
  }, []);

  // Fetch saved filter presets
  const fetchPresets = useCallback(async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('id, key, value')
      .like('key', 'rfm_filter_preset_%')
      .order('created_at', { ascending: true });
    setSavedPresets((data || []) as any[]);
  }, []);

  useEffect(() => { fetchPresets(); }, [fetchPresets]);

  // Load dispatch history when customer is selected
  useEffect(() => {
    if (!selectedCustomer?.phone) { setCustomerDispatches([]); return; }
    const suffix8 = (selectedCustomer.phone || '').replace(/\D/g, '').slice(-8);
    if (!suffix8) return;
    setCustomerDispatchesLoading(true);
    (async () => {
      try {
        const { data: recipients } = await supabase
          .from('dispatch_recipients')
          .select('dispatch_id, status, created_at')
          .ilike('phone', `%${suffix8}`)
          .order('created_at', { ascending: false })
          .limit(50);
        if (!recipients?.length) { setCustomerDispatches([]); setCustomerDispatchesLoading(false); return; }
        const dispatchIds = [...new Set(recipients.map(r => r.dispatch_id))];
        const { data: dispatches } = await supabase
          .from('dispatch_history')
          .select('id, campaign_name, template_name, started_at, status')
          .in('id', dispatchIds);
        const dispatchMap = new Map((dispatches || []).map(d => [d.id, d]));
        const result = recipients.map(r => {
          const d = dispatchMap.get(r.dispatch_id);
          return {
            campaign_name: d?.campaign_name || null,
            template_name: d?.template_name || '',
            started_at: d?.started_at || r.created_at,
            status: r.status,
          };
        }).sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
        setCustomerDispatches(result);
      } catch (err) {
        console.error('Error loading customer dispatches:', err);
      } finally {
        setCustomerDispatchesLoading(false);
      }
    })();
  }, [selectedCustomer?.id]);

  const saveCurrentPreset = async () => {
    if (!presetName.trim()) { toast.error("Digite um nome para o filtro"); return; }
    // Resolve excluded/included preset keys (stable references instead of IDs)
    const excludedPresetKeys = savedPresets.filter(p => excludedPresetIds.includes(p.id)).map(p => p.key);
    const includedPresetKeys = savedPresets.filter(p => includedPresetIds.includes(p.id)).map(p => p.key);
    const preset = {
      rfmFilter, regionFilter, dddFilter, storeFilter, sellerFilter, recencyFilter,
      dateFrom, dateTo, ticketMin, ticketMax, ordersMin, ordersMax, topN, sortField, sortDir,
      excludedPresetKeys: excludedPresetKeys.length > 0 ? excludedPresetKeys : undefined,
      includedPresetKeys: includedPresetKeys.length > 0 ? includedPresetKeys : undefined,
    };
    const key = `rfm_filter_preset_${Date.now()}`;
    await supabase.from('app_settings').insert({ key, value: { name: presetName.trim(), filters: preset } });
    toast.success("Filtro salvo!");
    setPresetName("");
    setPresetDialogOpen(false);
    fetchPresets();
  };

  const loadPreset = (preset: any) => {
    const f = preset.value?.filters || preset.value;
    if (f.rfmFilter) setRfmFilter(f.rfmFilter);
    if (f.regionFilter) setRegionFilter(f.regionFilter);
    if (f.dddFilter) setDddFilter(f.dddFilter);
    if (f.storeFilter) setStoreFilter(f.storeFilter);
    if (f.sellerFilter) setSellerFilter(f.sellerFilter);
    setDateFrom(f.dateFrom || "");
    setDateTo(f.dateTo || "");
    setTicketMin(f.ticketMin || "");
    setTicketMax(f.ticketMax || "");
    setOrdersMin(f.ordersMin || "");
    setOrdersMax(f.ordersMax || "");
    if (f.recencyFilter) setRecencyFilter(f.recencyFilter);
    if (f.topN) setTopN(f.topN);
    if (f.sortField) setSortField(f.sortField);
    if (f.sortDir) setSortDir(f.sortDir);
    // Restore excluded/included presets by key
    if (f.excludedPresetKeys?.length) {
      setExcludedPresetIds(savedPresets.filter(p => f.excludedPresetKeys.includes(p.key)).map(p => p.id));
    } else {
      setExcludedPresetIds([]);
    }
    if (f.includedPresetKeys?.length) {
      setIncludedPresetIds(savedPresets.filter(p => f.includedPresetKeys.includes(p.key)).map(p => p.id));
    } else {
      setIncludedPresetIds([]);
    }
    toast.success(`Filtro "${(preset.value as any)?.name || 'Preset'}" aplicado`);
  };

  const deletePreset = async (id: string) => {
    await supabase.from('app_settings').delete().eq('id', id);
    setExcludedPresetIds(prev => prev.filter(x => x !== id));
    setIncludedPresetIds(prev => prev.filter(x => x !== id));
    toast.success("Filtro excluído");
    fetchPresets();
  };

  // ─── Campaign actions ──────────────────────────────

  const updateCampaignStatus = async (id: string, status: string) => {
    try {
      const { error } = await supabase.from('marketing_campaigns').update({ status }).eq('id', id);
      if (error) throw error;
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status } : c));
      toast.success(`Status: ${STATUS_LABELS[status]}`);
    } catch { toast.error("Erro ao atualizar"); }
  };

  const deleteCampaign = async (id: string) => {
    try {
      const { error } = await supabase.from('marketing_campaigns').delete().eq('id', id);
      if (error) throw error;
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast.success("Campanha excluída");
    } catch { toast.error("Erro ao excluir"); }
  };

  // ─── Customer actions ──────────────────────────────

  const handleSyncRfm = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoppy-sync-customers`, {
        method: 'POST', headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'calculate_rfm' }),
      });
      const data = await res.json();
      if (data.success) { toast.success(data.message); fetchCustomers(); }
      else toast.error(data.error || "Erro ao calcular RFM");
    } catch { toast.error("Erro ao sincronizar"); }
    finally { setIsSyncing(false); }
  };

  const handleSyncSales = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoppy-sync-sales`, {
        method: 'POST', headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_page: 1, max_pages: 50, after_date: '2022-01-01T00:00:00.000Z' }),
      });
      const data = await res.json();
      if (data.success) { toast.success(data.message); if (!data.completed) toast.info("Existem mais vendas. Clique novamente."); }
      else toast.error(data.error || "Erro ao sincronizar vendas");
    } catch { toast.error("Erro ao sincronizar vendas"); }
    finally { setIsSyncing(false); }
  };

  const handleSyncPosShopify = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-pos-shopify-to-rfm`, {
        method: 'POST', headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all' }),
      });
      const data = await res.json();
      if (data.success) { toast.success(data.message); fetchCustomers(); }
      else toast.error(data.error || "Erro ao sincronizar POS/Shopify");
    } catch { toast.error("Erro ao sincronizar POS/Shopify"); }
    finally { setIsSyncing(false); }
  };

  const handleRfmExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadTarget('rfm');
    setUploadDialogOpen(true);
    setUploadStatus({ stage: 'reading', progress: 10, detail: 'Lendo arquivo...' });
    try {
      const xlsxModule = await import('@e965/xlsx');
      const XLSX = xlsxModule.default || xlsxModule;
      setUploadStatus({ stage: 'parsing', progress: 20, detail: 'Analisando planilha...' });
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) {
        setUploadStatus({ stage: 'error', progress: 100, detail: 'Planilha vazia', error: 'Nenhuma linha encontrada' });
        return;
      }
      setUploadStatus({ stage: 'mapping', progress: 30, detail: `${rows.length} linhas encontradas. Mapeando colunas...` });
      const headers = Object.keys(rows[0]);
      console.log('RFM Excel headers found:', headers);

      // Zoppy export columns: primeiro_nome, sobrenome, email, telefone, genero, data_nascimento,
      // estado, perfil_rfm, data_ultima_compra, status_pedido, valor_da_ultima_compra,
      // ticket_medio, total_compras, total_gasto, loja_ultima_compra
      const phoneCol = headers.find(h => /^telefone$/i.test(h)) || headers.find(h => /phone|whatsapp|celular|fone|tel\b/i.test(h));
      const nameCol = headers.find(h => /^primeiro_nome$/i.test(h)) || headers.find(h => /first.?name|nome|cliente/i.test(h));
      const lastNameCol = headers.find(h => /^sobrenome$/i.test(h)) || headers.find(h => /last.?name|ultimo.?nome/i.test(h));
      const emailCol = headers.find(h => /^email$/i.test(h)) || headers.find(h => /e-mail|e_mail/i.test(h));
      const genderCol = headers.find(h => /^genero$/i.test(h)) || headers.find(h => /gender|sexo/i.test(h));
      const birthCol = headers.find(h => /^data_nascimento$/i.test(h)) || headers.find(h => /birth|nascimento|aniversario/i.test(h));
      const stateCol = headers.find(h => /^estado$/i.test(h)) || headers.find(h => /state|uf/i.test(h));
      const cityCol = headers.find(h => /^cidade$/i.test(h)) || headers.find(h => /city|municipio/i.test(h));
      const rfmProfileCol = headers.find(h => /^perfil_rfm$/i.test(h)) || headers.find(h => /rfm|segmento|segment|profile/i.test(h));
      const lastPurchaseCol = headers.find(h => /^data_ultima_compra$/i.test(h)) || headers.find(h => /last.?purchase|ultima.?compra|data.?ultima/i.test(h));
      const ordersCol = headers.find(h => /^total_compras$/i.test(h)) || headers.find(h => /orders|pedidos|compras|qtd/i.test(h));
      const spentCol = headers.find(h => /^total_gasto$/i.test(h)) || headers.find(h => /spent|gasto|total|revenue|faturamento/i.test(h));
      const avgTicketCol = headers.find(h => /^ticket_medio$/i.test(h)) || headers.find(h => /ticket.?medio|avg.?ticket/i.test(h));
      const lastValueCol = headers.find(h => /^valor_da_ultima_compra$/i.test(h));

      // Map Zoppy RFM profile slugs to Portuguese segment names
      const RFM_SLUG_MAP: Record<string, string> = {
        'champion': 'Campeões', 'champions': 'Campeões',
        'loyal': 'Leais', 'loyals': 'Leais',
        'possible-loyal': 'Potenciais Leais', 'potential-loyal': 'Potenciais Leais',
        'new': 'Novos Clientes', 'new-customer': 'Novos Clientes', 'new-customers': 'Novos Clientes',
        'promising': 'Promissores',
        'need-attention': 'Precisam Atenção', 'needs-attention': 'Precisam Atenção',
        'almost-sleeping': 'Quase Dormindo',
        'at-risk': 'Em Risco', 'risk': 'Em Risco',
        'cant-lose': 'Não Pode Perder', 'can-not-lose': 'Não Pode Perder',
        'sleeping': 'Hibernando', 'hibernating': 'Hibernando',
        'lost': 'Perdidos',
      };

      if (!phoneCol && !emailCol) {
        setUploadStatus({ stage: 'error', progress: 100, detail: `Colunas: ${headers.join(', ')}`, error: 'Nenhuma coluna de telefone ou email detectada' });
        return;
      }

      const LOCAL_DDD = "33";
      const parseDate = (raw: any): string | null => {
        if (!raw) return null;
        if (typeof raw === 'number') {
          const d = new Date((raw - 25569) * 86400 * 1000);
          return !isNaN(d.getTime()) ? d.toISOString() : null;
        }
        const str = String(raw);
        // Try M/D/YY or M/D/YYYY format
        const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (mdyMatch) {
          const [, m, d, y] = mdyMatch;
          const year = y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
          const dt = new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
          return !isNaN(dt.getTime()) ? dt.toISOString() : null;
        }
        const dt = new Date(str);
        return !isNaN(dt.getTime()) ? dt.toISOString() : null;
      };

      const batch: any[] = [];
      for (const row of rows) {
        const phone = phoneCol ? String(row[phoneCol] || '').replace(/\D/g, '') : '';
        const email = emailCol ? String(row[emailCol] || '') : '';
        if (!phone && !email) continue;

        const identifier = phone || email;
        const zoppyId = `excel_${identifier}`;

        let firstName = nameCol ? String(row[nameCol] || '') : '';
        let lastName = lastNameCol ? String(row[lastNameCol] || '') : '';
        if (firstName && !lastName && firstName.includes(' ')) {
          const parts = firstName.split(' ');
          firstName = parts[0];
          lastName = parts.slice(1).join(' ');
        }

        let ddd = '';
        if (phone && phone.length >= 10) {
          ddd = phone.startsWith('55') ? phone.substring(2, 4) : phone.substring(0, 2);
        }
        const city = cityCol ? String(row[cityCol] || '') : '';
        const state = stateCol ? String(row[stateCol] || '') : '';
        const hasAddress = !!(city && city.trim());
        let regionType = 'unknown';
        if (ddd === LOCAL_DDD && !hasAddress) regionType = 'local';
        else if (hasAddress) regionType = 'online';
        else if (ddd === LOCAL_DDD) regionType = 'local';

        const totalOrders = ordersCol ? Math.round(Number(row[ordersCol]) || 0) : 0;
        const parseMoneyValue = (raw: any): number => {
          if (raw == null) return 0;
          if (typeof raw === 'number') {
            // Excel stores numbers directly — cap at 10M to catch float errors
            const val = Math.round(raw * 100) / 100;
            return val > 10000000 ? 0 : val;
          }
          const str = String(raw).replace(/[R$\s]/g, '');
          // Brazilian format: 8.215,50 → remove dots, replace comma
          const cleaned = str.replace(/\./g, '').replace(',', '.');
          const num = Number(cleaned) || 0;
          return num > 10000000 ? 0 : Math.round(num * 100) / 100;
        };
        const totalSpent = spentCol ? parseMoneyValue(row[spentCol]) : 0;
        const avgTicket = avgTicketCol ? parseMoneyValue(row[avgTicketCol])
          : (totalOrders > 0 ? +(totalSpent / totalOrders).toFixed(2) : 0);

        const lastPurchase = parseDate(lastPurchaseCol ? row[lastPurchaseCol] : null);

        // Map RFM segment from Zoppy slug to Portuguese
        let rfmSegment: string | null = null;
        if (rfmProfileCol && row[rfmProfileCol]) {
          const slug = String(row[rfmProfileCol]).toLowerCase().trim();
          rfmSegment = RFM_SLUG_MAP[slug] || slug;
        }

        const gender = genderCol ? String(row[genderCol] || '').substring(0, 1).toUpperCase() : null;
        const birthDate = parseDate(birthCol ? row[birthCol] : null);

        batch.push({
          zoppy_id: zoppyId,
          first_name: firstName || null,
          last_name: lastName || null,
          phone: phone || null,
          email: email || null,
          gender: gender || null,
          birth_date: birthDate,
          city: city || null,
          state: state || null,
          region_type: regionType,
          ddd: ddd || null,
          total_orders: totalOrders,
          total_spent: totalSpent,
          avg_ticket: avgTicket,
          last_purchase_at: lastPurchase,
          rfm_segment: rfmSegment,
        });
      }

      if (batch.length === 0) {
        setUploadStatus({ stage: 'error', progress: 100, detail: 'Nenhum contato válido com telefone ou email', error: 'Sem dados válidos' });
        return;
      }

      setUploadStatus({ stage: 'saving', progress: 40, detail: `${batch.length} clientes válidos. Salvando...` });
      const totalBatches = Math.ceil(batch.length / 100);
      let totalUpserted = 0;
      for (let i = 0; i < batch.length; i += 100) {
        const batchNum = Math.floor(i / 100) + 1;
        const pct = 40 + Math.round((batchNum / totalBatches) * 50);
        setUploadStatus({ stage: 'inserting', progress: pct, detail: `Salvando lote ${batchNum}/${totalBatches}...` });
        const chunk = batch.slice(i, i + 100);
        const { error } = await supabase.from('zoppy_customers').upsert(chunk, { onConflict: 'zoppy_id' });
        if (error) throw error;
        totalUpserted += chunk.length;
      }

      setUploadStatus({ stage: 'rfm', progress: 92, detail: 'Recalculando RFM...' });
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoppy-sync-customers`, {
          method: 'POST', headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'calculate_rfm' }),
        });
        const rfmData = await res.json();
        if (rfmData.success) console.log('RFM recalculated after Excel import');
      } catch (rfmErr) { console.warn('RFM recalc failed, data still imported:', rfmErr); }

      setUploadStatus({ stage: 'done', progress: 100, detail: `✅ ${totalUpserted} clientes importados e RFM recalculado!`, done: true });
      fetchCustomers();
    } catch (err: any) {
      console.error('RFM Excel upload error:', err);
      setUploadStatus({ stage: 'error', progress: 100, detail: err?.message || 'Erro desconhecido', error: 'Falha no upload' });
    }
    if (rfmFileInputRef.current) rfmFileInputRef.current.value = '';
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadTarget('campaign');
    setUploadDialogOpen(true);
    setUploadStatus({ stage: 'reading', progress: 10, detail: 'Lendo arquivo...' });
    try {
      const xlsxModule = await import('@e965/xlsx');
      const XLSX = xlsxModule.default || xlsxModule;
      setUploadStatus({ stage: 'parsing', progress: 20, detail: 'Analisando planilha...' });
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) {
        setUploadStatus({ stage: 'error', progress: 100, detail: 'Planilha vazia', error: 'Nenhuma linha encontrada' });
        return;
      }
      setUploadStatus({ stage: 'mapping', progress: 30, detail: `${rows.length} linhas encontradas. Mapeando colunas...` });
      const headers = Object.keys(rows[0]);
      console.log('Excel headers found:', headers);
      const phoneCol = headers.find(h => /phone|telefone|whatsapp|celular|fone|tel\b/i.test(h));
      const nameCol = headers.find(h => /name|nome|cliente|razao|fantasia|contato/i.test(h));
      const emailCol = headers.find(h => /email|e-mail|e_mail/i.test(h));
      const instagramCol = headers.find(h => /instagram|insta|ig/i.test(h));
      if (!phoneCol && !emailCol) {
        setUploadStatus({ stage: 'error', progress: 100, detail: `Colunas encontradas: ${headers.join(', ')}`, error: 'Nenhuma coluna de telefone ou email detectada' });
        return;
      }
      const contacts = rows.map(row => ({
        phone: phoneCol ? String(row[phoneCol] || '').replace(/\D/g, '') : null,
        name: nameCol ? String(row[nameCol] || '') : null,
        email: emailCol ? String(row[emailCol] || '') : null,
        instagram: instagramCol ? String(row[instagramCol] || '') : null,
      })).filter(c => (c.phone && c.phone.length >= 8) || c.email);
      if (contacts.length === 0) {
        setUploadStatus({ stage: 'error', progress: 100, detail: `${rows.length} linhas lidas, mas nenhuma com telefone/email válido`, error: 'Nenhum contato válido' });
        return;
      }
      setUploadStatus({ stage: 'saving', progress: 40, detail: `${contacts.length} contatos válidos. Criando lista...` });
      const { data: list, error: listError } = await supabase.from('marketing_contact_lists').insert({
        name: `Upload: ${file.name} (${new Date().toLocaleDateString('pt-BR')})`,
        source: 'excel_upload', contact_count: contacts.length,
        description: `${contacts.length} contatos importados de ${file.name}`,
      }).select().single();
      if (listError) throw listError;
      const totalBatches = Math.ceil(contacts.length / 100);
      for (let i = 0; i < contacts.length; i += 100) {
        const batchNum = Math.floor(i / 100) + 1;
        const pct = 40 + Math.round((batchNum / totalBatches) * 55);
        setUploadStatus({ stage: 'inserting', progress: pct, detail: `Salvando lote ${batchNum}/${totalBatches} (${Math.min(i + 100, contacts.length)}/${contacts.length} contatos)...` });
        const batch = contacts.slice(i, i + 100).map(c => ({
          list_id: list.id, phone: c.phone || null, name: c.name || null,
          email: c.email || null, instagram: c.instagram || null,
        }));
        const { error } = await supabase.from('marketing_contacts').insert(batch);
        if (error) throw error;
      }
      setUploadStatus({ stage: 'done', progress: 100, detail: `✅ ${contacts.length} contatos importados com sucesso!`, done: true });
    } catch (err: any) {
      console.error('Excel upload error:', err);
      setUploadStatus({ stage: 'error', progress: 100, detail: err?.message || 'Erro desconhecido', error: 'Falha no upload' });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Computed ──────────────────────────────

  const customerStats = customers.length > 0 ? {
    total: customers.length,
    local: customers.filter(c => c.region_type === 'local').length,
    online: customers.filter(c => c.region_type === 'online').length,
    revenue: customers.reduce((s, c) => s + c.total_spent, 0),
    segments: [...new Set(customers.map(c => c.rfm_segment).filter(Boolean))] as string[],
  } : null;

  // Helper: check if a customer matches a preset's filters
  const customerMatchesPreset = useCallback((c: ZoppyCustomer, presetValue: any): boolean => {
    const f = presetValue?.filters || presetValue;
    if (f.rfmFilter && f.rfmFilter !== "all" && c.rfm_segment !== f.rfmFilter) return false;
    if (f.recencyFilter && f.recencyFilter !== "all" && (c.rfm_recency_score || 0) !== parseInt(f.recencyFilter)) return false;
    if (f.regionFilter && f.regionFilter !== "all" && c.region_type !== f.regionFilter) return false;
    if (f.dddFilter && f.dddFilter !== "all" && c.ddd !== f.dddFilter) return false;
    if (f.dateFrom && c.last_purchase_at && c.last_purchase_at < f.dateFrom) return false;
    if (f.dateTo && c.last_purchase_at && c.last_purchase_at > f.dateTo + 'T23:59:59') return false;
    if ((f.dateFrom || f.dateTo) && !c.last_purchase_at) return false;
    if (f.ticketMin && c.avg_ticket < parseFloat(f.ticketMin)) return false;
    if (f.ticketMax && c.avg_ticket > parseFloat(f.ticketMax)) return false;
    if (f.ordersMin && c.total_orders < parseInt(f.ordersMin)) return false;
    if (f.ordersMax && c.total_orders > parseInt(f.ordersMax)) return false;
    if ((f.storeFilter && f.storeFilter !== "all") || (f.sellerFilter && f.sellerFilter !== "all")) {
      const suffix = (c.phone || '').replace(/\D/g, '').slice(-8);
      const mapping = suffix ? customerStoreMap.get(suffix) : undefined;
      if (f.storeFilter && f.storeFilter !== "all" && (!mapping || mapping.store_id !== f.storeFilter)) return false;
      if (f.sellerFilter && f.sellerFilter !== "all" && (!mapping || mapping.seller_id !== f.sellerFilter)) return false;
    }
    // topN is not applied here — it's a limit, not a filter condition
    return true;
  }, [customerStoreMap]);

  const filtered = customers.filter(c => {
    if (regionFilter !== "all" && c.region_type !== regionFilter) return false;
    if (rfmFilter !== "all" && c.rfm_segment !== rfmFilter) return false;
    if (dddFilter !== "all" && c.ddd !== dddFilter) return false;
    if (tagFilter !== "all" && !(c.tags || []).includes(tagFilter)) return false;
    if (recencyFilter !== "all" && (c.rfm_recency_score || 0) !== parseInt(recencyFilter)) return false;
    if (dateFrom && c.last_purchase_at && c.last_purchase_at < dateFrom) return false;
    if (dateTo && c.last_purchase_at && c.last_purchase_at > dateTo + 'T23:59:59') return false;
    if ((dateFrom || dateTo) && !c.last_purchase_at) return false;
    if (ticketMin && c.avg_ticket < parseFloat(ticketMin)) return false;
    if (ticketMax && c.avg_ticket > parseFloat(ticketMax)) return false;
    if (ordersMin && c.total_orders < parseInt(ordersMin)) return false;
    if (ordersMax && c.total_orders > parseInt(ordersMax)) return false;
    if (storeFilter !== "all" || sellerFilter !== "all") {
      const suffix = (c.phone || '').replace(/\D/g, '').slice(-8);
      const mapping = suffix ? customerStoreMap.get(suffix) : undefined;
      if (storeFilter !== "all" && (!mapping || mapping.store_id !== storeFilter)) return false;
      if (sellerFilter !== "all" && (!mapping || mapping.seller_id !== sellerFilter)) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
      if (!(name.includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q))) return false;
    }
    // Exclude customers matching any excluded preset
    if (excludedPresetIds.length > 0) {
      const excludedPresets = savedPresets.filter(p => excludedPresetIds.includes(p.id));
      for (const ep of excludedPresets) {
        if (customerMatchesPreset(c, ep.value)) return false;
      }
    }
    // Include intersection: customer must match ALL included presets
    if (includedPresetIds.length > 0) {
      const includedPresets = savedPresets.filter(p => includedPresetIds.includes(p.id));
      for (const ip of includedPresets) {
        if (!customerMatchesPreset(c, ip.value)) return false;
      }
    }
    return true;
  }).sort((a, b) => {
    const av = (a as any)[sortField] ?? 0;
    const bv = (b as any)[sortField] ?? 0;
    return sortDir === "desc" ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
  }).slice(0, topN !== "all" ? parseInt(topN) : undefined);

  const segments = customers.reduce((acc, c) => {
    const seg = c.rfm_segment || 'Outros';
    acc[seg] = (acc[seg] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const regionCounts = customers.reduce((acc, c) => { acc[c.region_type] = (acc[c.region_type] || 0) + 1; return acc; }, {} as Record<string, number>);
  const uniqueDdds = [...new Set(customers.map(c => c.ddd).filter(Boolean))].sort();
  const uniqueTags = [...new Set(customers.flatMap(c => c.tags || []).filter(Boolean))].sort();
  const totalRevenue = customers.reduce((s, c) => s + c.total_spent, 0);
  const toggleSort = (field: string) => { if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortField(field); setSortDir("desc"); } };
  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '-';

  // ─── Render ──────────────────────────────

  return (
    <div className="min-h-screen dark" style={{ background: 'hsl(0 0% 6%)', colorScheme: 'dark', color: 'hsl(45 10% 95%)' }}>
      <header className="sticky top-0 z-50 w-full border-b" style={{ borderColor: 'hsl(0 0% 15%)', background: 'hsla(0, 0%, 6%, 0.95)', backdropFilter: 'blur(8px)' }}>
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Megaphone className="h-4 w-4" />
            </div>
            <h1 className="text-lg font-bold hidden sm:block" style={{ color: 'hsl(48 95% 55%)' }}>Marketing 360°</h1>
            <h1 className="text-sm font-bold sm:hidden" style={{ color: 'hsl(48 95% 55%)' }}>Mkt 360°</h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1 text-white hover:text-white hover:bg-white/10 text-xs sm:text-sm px-2 sm:px-3">← Início</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/chat')} className="text-white hover:text-white hover:bg-white/10 text-xs sm:text-sm px-2 sm:px-3 hidden sm:inline-flex">Chat</Button>
          </div>
        </div>
      </header>

      <div className="container px-2 sm:px-4 py-4 space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* Mobile: Select dropdown */}
          <div className="md:hidden">
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-full bg-white/10 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="calendar">📅 Calendário</SelectItem>
                <SelectItem value="attribution">📊 Dashboard</SelectItem>
                <SelectItem value="customers">👥 Clientes RFM</SelectItem>
                <SelectItem value="templates">📢 Templates Meta</SelectItem>
                <SelectItem value="disparos">📨 Disparos</SelectItem>
                <SelectItem value="automations">⚡ Automações</SelectItem>
                <SelectItem value="sectors">🏪 Setores</SelectItem>
                <SelectItem value="landing_pages">🔗 Landing Pages</SelectItem>
                <SelectItem value="leads">📋 Leads</SelectItem>
                <SelectItem value="groups_vip">👑 Grupos VIP</SelectItem>
                <SelectItem value="prizes">🎁 Prêmios</SelectItem>
                <SelectItem value="live_commerce">🌐 Live Commerce</SelectItem>
                <SelectItem value="link_pages">🔗 Link Pages</SelectItem>
                <SelectItem value="push_notifications">🔔 Push Notifications</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="w-full mt-2 gap-2" onClick={() => navigate('/marketing/email-marketing')}>
              <Mail className="h-4 w-4" />Email Marketing
            </Button>
          </div>

          {/* Desktop: Scrollable TabsList */}
          <div className="hidden md:block">
            <ScrollArea className="w-full" type="scroll">
              <TabsList className="bg-white/10 border border-white/10 w-max">
                <TabsTrigger value="calendar" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Calendar className="h-3.5 w-3.5" />Calendário</TabsTrigger>
                <TabsTrigger value="attribution" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><BarChart3 className="h-3.5 w-3.5" />Dashboard</TabsTrigger>
                <TabsTrigger value="customers" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Users className="h-3.5 w-3.5" />Clientes RFM</TabsTrigger>
                <TabsTrigger value="templates" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Megaphone className="h-3.5 w-3.5" />Templates Meta</TabsTrigger>
                <TabsTrigger value="disparos" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Send className="h-3.5 w-3.5" />Disparos</TabsTrigger>
                <TabsTrigger value="automations" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Zap className="h-3.5 w-3.5" />Automações</TabsTrigger>
                <TabsTrigger value="sectors" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Store className="h-3.5 w-3.5" />Setores</TabsTrigger>
                <TabsTrigger value="landing_pages" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Link className="h-3.5 w-3.5" />Landing Pages</TabsTrigger>
                <TabsTrigger value="leads" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><FileSpreadsheet className="h-3.5 w-3.5" />Leads</TabsTrigger>
                <TabsTrigger value="groups_vip" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Crown className="h-3.5 w-3.5" />Grupos VIP</TabsTrigger>
                <TabsTrigger value="prizes" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Gift className="h-3.5 w-3.5" />Prêmios</TabsTrigger>
                <TabsTrigger value="live_commerce" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Globe className="h-3.5 w-3.5" />Live Commerce</TabsTrigger>
                <TabsTrigger value="link_pages" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Link className="h-3.5 w-3.5" />Link Pages</TabsTrigger>
                <TabsTrigger value="push_notifications" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Bell className="h-3.5 w-3.5" />Push</TabsTrigger>
                <TabsTrigger value="ai_ads" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Brain className="h-3.5 w-3.5" />IA Ads</TabsTrigger>
                <TabsTrigger value="ig_automation" className="gap-1 text-white/70 data-[state=active]:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground whitespace-nowrap"><Instagram className="h-3.5 w-3.5" />IG Automação</TabsTrigger>
                <button onClick={() => navigate('/marketing/email-marketing')} className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium gap-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors"><Mail className="h-3.5 w-3.5" />Email Marketing</button>
              </TabsList>
            </ScrollArea>
          </div>

          {/* ── CAMPANHAS ── */}
          <TabsContent value="attribution" className="space-y-4">
            <MarketingAttributionDashboard />
          </TabsContent>

          {/* ── CLIENTES RFM ── */}
          <TabsContent value="customers" className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
              <Card><CardContent className="pt-3 pb-2 px-3 sm:pt-4 sm:pb-3 sm:px-4"><p className="text-[10px] sm:text-xs text-muted-foreground">Total Clientes</p><p className="text-lg sm:text-2xl font-bold">{customers.length}</p></CardContent></Card>
              <Card><CardContent className="pt-3 pb-2 px-3 sm:pt-4 sm:pb-3 sm:px-4"><p className="text-[10px] sm:text-xs text-muted-foreground">Faturamento</p><p className="text-lg sm:text-2xl font-bold truncate">{formatCurrency(totalRevenue)}</p></CardContent></Card>
              <Card><CardContent className="pt-3 pb-2 px-3 sm:pt-4 sm:pb-3 sm:px-4"><p className="text-[10px] sm:text-xs text-muted-foreground">🏪 Loja Física</p><p className="text-lg sm:text-2xl font-bold">{regionCounts['local'] || 0}</p></CardContent></Card>
              <Card><CardContent className="pt-3 pb-2 px-3 sm:pt-4 sm:pb-3 sm:px-4"><p className="text-[10px] sm:text-xs text-muted-foreground">🌐 Online</p><p className="text-lg sm:text-2xl font-bold">{regionCounts['online'] || 0}</p></CardContent></Card>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant={rfmFilter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setRfmFilter("all")}>Todos ({customers.length})</Badge>
              {Object.entries(segments).sort((a, b) => b[1] - a[1]).map(([seg, count]) => {
                const Icon = RFM_SEGMENT_ICONS[seg] || Star;
                return (
                  <Badge key={seg} variant="outline" className={`cursor-pointer gap-1 ${rfmFilter === seg ? RFM_SEGMENT_COLORS[seg] || '' : ''}`} onClick={() => setRfmFilter(rfmFilter === seg ? "all" : seg)}>
                    <Icon className="h-3 w-3" />{seg} ({count})
                  </Badge>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
              <div className="relative w-full sm:flex-1 sm:min-w-[200px] sm:max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 h-9" />
              </div>
              <div className="grid grid-cols-2 sm:flex gap-2">
                <Select value={regionFilter} onValueChange={setRegionFilter}>
                  <SelectTrigger className="h-9"><MapPin className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas Regiões</SelectItem>
                    <SelectItem value="local">🏪 Loja Física</SelectItem>
                    <SelectItem value="online">🌐 Online</SelectItem>
                    <SelectItem value="unknown">❓ Indefinido</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={storeFilter} onValueChange={setStoreFilter}>
                  <SelectTrigger className="h-9"><Store className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas Lojas</SelectItem>
                    {storesList.map(s => (<SelectItem key={s.id} value={s.id}>🏪 {s.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 sm:flex gap-2">
                <Select value={sellerFilter} onValueChange={setSellerFilter}>
                  <SelectTrigger className="h-9"><Users className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas Vendedoras</SelectItem>
                    {sellersList.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                  </SelectContent>
                </Select>
                <Select value={dddFilter} onValueChange={setDddFilter}>
                  <SelectTrigger className="h-9"><Phone className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos DDDs</SelectItem>
                    {uniqueDdds.map(ddd => (<SelectItem key={ddd} value={ddd!}>DDD {ddd}</SelectItem>))}
                  </SelectContent>
                </Select>
                {uniqueTags.length > 0 && (
                  <Select value={tagFilter} onValueChange={setTagFilter}>
                    <SelectTrigger className="h-9"><Tag className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas Tags</SelectItem>
                      {uniqueTags.map(tag => (<SelectItem key={tag} value={tag}>🏷️ {tag}</SelectItem>))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {!(dateFrom || dateTo) ? (
                  <Button variant="outline" size="sm" className="h-9 text-xs gap-1 col-span-2 sm:col-span-2" onClick={() => {
                    const today = new Date().toISOString().split('T')[0];
                    setDateFrom(today);
                  }}>
                    <Calendar className="h-3.5 w-3.5" /> Filtrar por data de compra
                  </Button>
                ) : (
                  <>
                    <div className="relative">
                      <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-xs" title="Comprou depois de" />
                      <span className="absolute -top-2 left-2 text-[10px] bg-background px-1 text-muted-foreground">Comprou depois de</span>
                    </div>
                    <div className="relative flex gap-1">
                      <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-xs flex-1" title="Comprou antes de" />
                      <span className="absolute -top-2 left-2 text-[10px] bg-background px-1 text-muted-foreground">Comprou antes de</span>
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => { setDateFrom(""); setDateTo(""); }} title="Remover filtro de data">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </>
                )}
                <Select value={recencyFilter} onValueChange={setRecencyFilter}>
                  <SelectTrigger className="h-9"><Clock className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Recência: Todos</SelectItem>
                    <SelectItem value="5">⭐ R5 — Mais recentes</SelectItem>
                    <SelectItem value="4">R4 — Recentes</SelectItem>
                    <SelectItem value="3">R3 — Moderados</SelectItem>
                    <SelectItem value="2">R2 — Distantes</SelectItem>
                    <SelectItem value="1">💤 R1 — Mais antigos</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={topN} onValueChange={setTopN}>
                  <SelectTrigger className="h-9"><Crown className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="10">Top 10</SelectItem>
                    <SelectItem value="20">Top 20</SelectItem>
                    <SelectItem value="50">Top 50</SelectItem>
                    <SelectItem value="100">Top 100</SelectItem>
                    <SelectItem value="200">Top 200</SelectItem>
                    <SelectItem value="500">Top 500</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" value={ticketMin} onChange={e => setTicketMin(e.target.value)} className="h-9" placeholder="Ticket mín" title="Ticket médio mínimo" />
                <Input type="number" value={ticketMax} onChange={e => setTicketMax(e.target.value)} className="h-9" placeholder="Ticket máx" title="Ticket médio máximo" />
                <Input type="number" value={ordersMin} onChange={e => setOrdersMin(e.target.value)} className="h-9" placeholder="Pedidos mín" title="Número mínimo de pedidos" />
                <Input type="number" value={ordersMax} onChange={e => setOrdersMax(e.target.value)} className="h-9" placeholder="Pedidos máx" title="Número máximo de pedidos" />
              </div>
              <div className="flex flex-wrap gap-1 w-full sm:w-auto sm:ml-auto">
                <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => {
                  const exportData = filtered.map(c => {
                    const suffix = (c.phone || '').replace(/\D/g, '').slice(-8);
                    const mapping = suffix ? customerStoreMap.get(suffix) : undefined;
                    return {
                      Nome: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
                      Telefone: c.phone || '',
                      Email: c.email || '',
                      Região: c.region_type === 'local' ? 'Loja Física' : c.region_type === 'online' ? 'Online' : 'Indefinido',
                      Loja: mapping?.store_name || '',
                      Vendedora: mapping?.seller_name || '',
                      DDD: c.ddd || '',
                      Segmento_RFM: c.rfm_segment || '',
                      R: c.rfm_recency_score || '',
                      F: c.rfm_frequency_score || '',
                      M: c.rfm_monetary_score || '',
                      Total_RFM: c.rfm_total_score || '',
                      Pedidos: c.total_orders,
                      Total_Gasto: c.total_spent,
                      Ticket_Medio: c.avg_ticket,
                      Ultima_Compra: c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString('pt-BR') : '',
                      Primeira_Compra: c.first_purchase_at ? new Date(c.first_purchase_at).toLocaleDateString('pt-BR') : '',
                      Cidade: c.city || '',
                      Estado: c.state || '',
                    };
                  });
                  const ws = XLSX.utils.json_to_sheet(exportData);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "Clientes RFM");
                  const filterLabel = rfmFilter !== "all" ? `_${rfmFilter}` : regionFilter !== "all" ? `_${regionFilter}` : "";
                  XLSX.writeFile(wb, `clientes_rfm${filterLabel}_${new Date().toISOString().slice(0,10)}.xlsx`);
                  toast.success(`${exportData.length} clientes exportados — arquivo Excel baixado`);
                }}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />Excel ({filtered.length})
                </Button>
                <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => {
                  const exportData = filtered.map(c => {
                    const suffix = (c.phone || '').replace(/\D/g, '').slice(-8);
                    const mapping = suffix ? customerStoreMap.get(suffix) : undefined;
                    return {
                      nome: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
                      telefone: c.phone || '',
                      email: c.email || '',
                      regiao: c.region_type === 'local' ? 'Loja Física' : c.region_type === 'online' ? 'Online' : 'Indefinido',
                      loja: mapping?.store_name || '',
                      vendedora: mapping?.seller_name || '',
                      segmento: c.rfm_segment || '',
                      pedidos: c.total_orders,
                      totalGasto: c.total_spent,
                      ticketMedio: c.avg_ticket,
                      ultimaCompra: c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString('pt-BR') : '',
                    };
                  });
                  // Build HTML table for PDF
                  const rows = exportData.map(d =>
                    `<tr><td>${d.nome}</td><td>${d.telefone}</td><td>${d.loja}</td><td>${d.vendedora}</td><td>${d.segmento}</td><td>${d.pedidos}</td><td>R$${Number(d.totalGasto||0).toFixed(2)}</td><td>R$${Number(d.ticketMedio||0).toFixed(2)}</td><td>${d.ultimaCompra}</td></tr>`
                  ).join('');
                  const html = `<html><head><meta charset="utf-8"><title>Clientes RFM</title><style>
                    body{font-family:Arial,sans-serif;margin:20px;font-size:11px}
                    h1{color:#7c3aed;font-size:18px;margin-bottom:4px}
                    p{color:#666;margin-bottom:12px;font-size:12px}
                    table{width:100%;border-collapse:collapse}
                    th{background:#7c3aed;color:#fff;padding:6px 4px;text-align:left;font-size:10px}
                    td{padding:4px;border-bottom:1px solid #e5e7eb;font-size:10px}
                    tr:nth-child(even){background:#f9fafb}
                    @media print{body{margin:10px}}
                  </style></head><body>
                  <h1>Relatório de Clientes RFM</h1>
                  <p>Exportado em ${new Date().toLocaleDateString('pt-BR')} • ${exportData.length} clientes</p>
                  <table><thead><tr><th>Nome</th><th>Telefone</th><th>Loja</th><th>Vendedora</th><th>Segmento</th><th>Pedidos</th><th>Total</th><th>Ticket</th><th>Última Compra</th></tr></thead><tbody>${rows}</tbody></table>
                  </body></html>`;
                  const printWin = window.open('', '_blank');
                  if (printWin) {
                    printWin.document.write(html);
                    printWin.document.close();
                    setTimeout(() => { printWin.print(); }, 500);
                    toast.success(`PDF pronto para impressão — ${exportData.length} clientes`);
                  } else {
                    toast.error('Popup bloqueado. Permita popups para exportar PDF.');
                  }
                }}>
                  <Download className="h-3.5 w-3.5" />PDF ({filtered.length})
                </Button>
                <Button variant="outline" size="sm" className="gap-1 relative overflow-hidden text-xs">
                  <Upload className="h-3.5 w-3.5" /><span className="hidden sm:inline">Upload </span>Excel
                  <input ref={rfmFileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleRfmExcelUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleSyncRfm} disabled={isSyncing} className="gap-1 text-xs">
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Recalcular </span>RFM
                </Button>
                <Button variant="outline" size="sm" onClick={handleSyncSales} disabled={isSyncing} className="gap-1 text-xs">
                  <Download className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Sync </span>Vendas
                </Button>
                <Button variant="outline" size="sm" onClick={handleSyncPosShopify} disabled={isSyncing} className="gap-1 text-xs">
                  <Store className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Sync </span>POS
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {filtered.length} clientes
                {(regionFilter !== "all" || rfmFilter !== "all" || dddFilter !== "all" || storeFilter !== "all" || sellerFilter !== "all" || searchQuery || dateFrom || dateTo || ticketMin || ticketMax || ordersMin || ordersMax || topN !== "all" || excludedPresetIds.length > 0 || includedPresetIds.length > 0) && (
                  <Button variant="link" className="text-xs p-0 h-auto ml-2" onClick={() => { setRegionFilter("all"); setRfmFilter("all"); setDddFilter("all"); setStoreFilter("all"); setSellerFilter("all"); setSearchQuery(""); setDateFrom(""); setDateTo(""); setTicketMin(""); setTicketMax(""); setOrdersMin(""); setOrdersMax(""); setTopN("all"); setExcludedPresetIds([]); setIncludedPresetIds([]); }}>
                    <X className="h-3 w-3 mr-0.5" />Limpar
                  </Button>
                )}
              </p>
              <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={() => setPresetDialogOpen(true)}>
                <Save className="h-3 w-3" />Salvar Filtro
              </Button>
              {savedPresets.length > 0 && (
                <>
                  <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={() => setPresetOpsOpen(true)}>
                    <Filter className="h-3 w-3" />Interseção / Exclusão
                    {(excludedPresetIds.length > 0 || includedPresetIds.length > 0) && (
                      <Badge variant="default" className="ml-1 text-[9px] h-4 px-1">{excludedPresetIds.length + includedPresetIds.length}</Badge>
                    )}
                  </Button>
                  <div className="flex flex-wrap gap-1">
                    {savedPresets.map(p => {
                      const isExcluded = excludedPresetIds.includes(p.id);
                      const isIncluded = includedPresetIds.includes(p.id);
                      return (
                        <div key={p.id} className="flex items-center gap-0.5">
                          <Badge
                            variant="outline"
                            className={`cursor-pointer gap-1 text-[10px] hover:bg-secondary ${isExcluded ? 'border-destructive/50 bg-destructive/10 line-through' : isIncluded ? 'border-emerald-500/50 bg-emerald-500/10' : ''}`}
                            onClick={() => loadPreset(p)}
                          >
                            {isExcluded && <Minus className="h-2.5 w-2.5 text-destructive" />}
                            {isIncluded && <PlusIcon className="h-2.5 w-2.5 text-emerald-500" />}
                            {!isExcluded && !isIncluded && <Bookmark className="h-2.5 w-2.5" />}
                            {(p.value as any)?.name || 'Preset'}
                          </Badge>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => deletePreset(p.id)}>
                            <Trash2 className="h-2.5 w-2.5 text-destructive" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {/* Active preset ops indicators */}
              {(excludedPresetIds.length > 0 || includedPresetIds.length > 0) && (
                <div className="flex flex-wrap gap-1">
                  {includedPresetIds.map(id => {
                    const p = savedPresets.find(s => s.id === id);
                    return p ? (
                      <Badge key={id} className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1">
                        <PlusIcon className="h-2.5 w-2.5" />Incluir: {(p.value as any)?.name}
                        <button onClick={() => setIncludedPresetIds(prev => prev.filter(x => x !== id))} className="ml-0.5"><X className="h-2.5 w-2.5" /></button>
                      </Badge>
                    ) : null;
                  })}
                  {excludedPresetIds.map(id => {
                    const p = savedPresets.find(s => s.id === id);
                    return p ? (
                      <Badge key={id} className="text-[10px] bg-destructive/20 text-red-400 border-destructive/30 gap-1">
                        <Minus className="h-2.5 w-2.5" />Excluir: {(p.value as any)?.name}
                        <button onClick={() => setExcludedPresetIds(prev => prev.filter(x => x !== id))} className="ml-0.5"><X className="h-2.5 w-2.5" /></button>
                      </Badge>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            {/* Save Preset Dialog */}
            <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Salvar Filtro Atual</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <Input placeholder="Nome do filtro (ex: Campeões Centro)" value={presetName} onChange={e => setPresetName(e.target.value)} />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-medium">Filtros ativos:</p>
                    {rfmFilter !== "all" && <Badge variant="secondary" className="text-[10px] mr-1">Segmento: {rfmFilter}</Badge>}
                    {regionFilter !== "all" && <Badge variant="secondary" className="text-[10px] mr-1">Região: {regionFilter}</Badge>}
                    {storeFilter !== "all" && <Badge variant="secondary" className="text-[10px] mr-1">Loja: {storesList.find(s => s.id === storeFilter)?.name || storeFilter}</Badge>}
                    {sellerFilter !== "all" && <Badge variant="secondary" className="text-[10px] mr-1">Vendedora: {sellersList.find(s => s.id === sellerFilter)?.name || sellerFilter}</Badge>}
                    {dddFilter !== "all" && <Badge variant="secondary" className="text-[10px] mr-1">DDD: {dddFilter}</Badge>}
                    {dateFrom && <Badge variant="secondary" className="text-[10px] mr-1">Depois de: {dateFrom}</Badge>}
                    {dateTo && <Badge variant="secondary" className="text-[10px] mr-1">Antes de: {dateTo}</Badge>}
                    {topN !== "all" && <Badge variant="secondary" className="text-[10px] mr-1">Top {topN}</Badge>}
                    {ordersMin && <Badge variant="secondary" className="text-[10px] mr-1">Pedidos ≥ {ordersMin}</Badge>}
                    {ordersMax && <Badge variant="secondary" className="text-[10px] mr-1">Pedidos ≤ {ordersMax}</Badge>}
                    {ticketMin && <Badge variant="secondary" className="text-[10px] mr-1">Ticket ≥ {ticketMin}</Badge>}
                    {ticketMax && <Badge variant="secondary" className="text-[10px] mr-1">Ticket ≤ {ticketMax}</Badge>}
                    {includedPresetIds.length > 0 && savedPresets.filter(p => includedPresetIds.includes(p.id)).map(p => (
                      <Badge key={p.id} className="text-[10px] mr-1 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1">
                        <PlusIcon className="h-2 w-2" />Incluir: {(p.value as any)?.name}
                      </Badge>
                    ))}
                    {excludedPresetIds.length > 0 && savedPresets.filter(p => excludedPresetIds.includes(p.id)).map(p => (
                      <Badge key={p.id} className="text-[10px] mr-1 bg-destructive/20 text-red-400 border-destructive/30 gap-1">
                        <Minus className="h-2 w-2" />Excluir: {(p.value as any)?.name}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setPresetDialogOpen(false)}>Cancelar</Button>
                    <Button className="flex-1 gap-1" onClick={saveCurrentPreset}><Save className="h-3.5 w-3.5" />Salvar</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Preset Intersection/Exclusion Dialog */}
            <Dialog open={presetOpsOpen} onOpenChange={setPresetOpsOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><Filter className="h-4 w-4" />Interseção e Exclusão de Filtros</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <p className="text-xs text-muted-foreground">
                    <strong>Incluir (interseção):</strong> mantém apenas clientes que também aparecem nesse filtro.<br/>
                    <strong>Excluir:</strong> remove clientes que aparecem nesse filtro.
                  </p>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {savedPresets.map(p => {
                      const name = (p.value as any)?.name || 'Preset';
                      const isExcluded = excludedPresetIds.includes(p.id);
                      const isIncluded = includedPresetIds.includes(p.id);
                      const presetFilters = p.value?.filters || p.value;
                      const filterSummary: string[] = [];
                      if (presetFilters?.rfmFilter && presetFilters.rfmFilter !== 'all') filterSummary.push(`Segmento: ${presetFilters.rfmFilter}`);
                      if (presetFilters?.storeFilter && presetFilters.storeFilter !== 'all') filterSummary.push(`Loja`);
                      if (presetFilters?.sellerFilter && presetFilters.sellerFilter !== 'all') filterSummary.push(`Vendedora`);
                      if (presetFilters?.regionFilter && presetFilters.regionFilter !== 'all') filterSummary.push(`Região: ${presetFilters.regionFilter}`);
                      if (presetFilters?.dateFrom) filterSummary.push(`De: ${presetFilters.dateFrom}`);
                      if (presetFilters?.dateTo) filterSummary.push(`Até: ${presetFilters.dateTo}`);
                      if (presetFilters?.topN && presetFilters.topN !== 'all') filterSummary.push(`Top ${presetFilters.topN}`);

                      return (
                        <div key={p.id} className={`rounded-lg border p-3 space-y-2 ${isExcluded ? 'border-destructive/40 bg-destructive/5' : isIncluded ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{name}</span>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant={isIncluded ? "default" : "outline"}
                                className={`h-7 text-xs gap-1 ${isIncluded ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
                                onClick={() => {
                                  if (isIncluded) {
                                    setIncludedPresetIds(prev => prev.filter(x => x !== p.id));
                                  } else {
                                    setIncludedPresetIds(prev => [...prev, p.id]);
                                    setExcludedPresetIds(prev => prev.filter(x => x !== p.id));
                                  }
                                }}
                              >
                                <PlusIcon className="h-3 w-3" />Incluir
                              </Button>
                              <Button
                                size="sm"
                                variant={isExcluded ? "destructive" : "outline"}
                                className="h-7 text-xs gap-1"
                                onClick={() => {
                                  if (isExcluded) {
                                    setExcludedPresetIds(prev => prev.filter(x => x !== p.id));
                                  } else {
                                    setExcludedPresetIds(prev => [...prev, p.id]);
                                    setIncludedPresetIds(prev => prev.filter(x => x !== p.id));
                                  }
                                }}
                              >
                                <Minus className="h-3 w-3" />Excluir
                              </Button>
                            </div>
                          </div>
                          {filterSummary.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {filterSummary.map((s, i) => <Badge key={i} variant="secondary" className="text-[9px]">{s}</Badge>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setExcludedPresetIds([]); setIncludedPresetIds([]); }}>Limpar Tudo</Button>
                    <Button className="flex-1" onClick={() => setPresetOpsOpen(false)}>Aplicar</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <ScrollArea className="h-[calc(100vh-420px)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Região</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort('rfm_total_score')}>
                      <div className="flex items-center gap-1">Segmento RFM<ArrowUpDown className="h-3 w-3" /></div>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer" onClick={() => toggleSort('rfm_recency_score')}><div className="flex items-center gap-1">R<ArrowUpDown className="h-3 w-3" /></div></TableHead>
                    <TableHead className="text-center">F</TableHead>
                    <TableHead className="text-center">M</TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('total_orders')}>
                      <div className="flex items-center justify-end gap-1">Pedidos<ArrowUpDown className="h-3 w-3" /></div>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('total_spent')}>
                      <div className="flex items-center justify-end gap-1">Total Gasto<ArrowUpDown className="h-3 w-3" /></div>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('last_purchase_at')}><div className="flex items-center justify-end gap-1">Última Compra<ArrowUpDown className="h-3 w-3" /></div></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8"><RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Nenhum cliente encontrado</TableCell></TableRow>
                  ) : filtered.slice(0, 200).map(c => (
                    <TableRow key={c.id} className="text-sm cursor-pointer hover:bg-muted/50" onClick={async () => {
                      // Pre-populate seller from map immediately
                      const phoneSuffix = (c.phone || '').replace(/\D/g, '').slice(-8);
                      const mapEntry = phoneSuffix ? customerStoreMap.get(phoneSuffix) : undefined;
                      setSelectedCustomer({ ...c, _lastSellerName: mapEntry?.seller_name || '', _lastProductName: '' } as any);
                      // Enrich with last product and seller (async)
                      if (c.phone) {
                        const suffix = c.phone.replace(/\D/g, '').slice(-8);
                        const { data: sales } = await supabase
                          .from('pos_sales')
                          .select('id, seller_id, customer_phone')
                          .ilike('customer_phone', `%${suffix}`)
                          .order('created_at', { ascending: false })
                          .limit(1);
                        if (sales && sales.length > 0) {
                          const sale = sales[0];
                          const [itemsRes, sellerRes] = await Promise.all([
                            supabase.from('pos_sale_items').select('product_name').eq('sale_id', sale.id).limit(3),
                            sale.seller_id ? supabase.from('pos_sellers').select('name').eq('id', sale.seller_id).single() : Promise.resolve({ data: null }),
                          ]);
                          const lastProducts = (itemsRes.data || []).map((i: any) => i.product_name).join(', ');
                          const sellerName = (sellerRes as any)?.data?.name || mapEntry?.seller_name || '';
                          setSelectedCustomer(prev => prev ? { ...prev, _lastProductName: lastProducts, _lastSellerName: sellerName } as any : prev);
                        }
                      }
                    }}>
                      <TableCell className="font-medium">{c.first_name} {c.last_name}</TableCell>
                      <TableCell className="text-xs">
                        <div className="space-y-0.5">
                          {c.phone && <div className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{c.phone}</div>}
                          {c.email && <div className="flex items-center gap-1 text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</div>}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{c.region_type === 'local' ? '🏪 GV' : c.region_type === 'online' ? '🌐' : '❓'}</Badge></TableCell>
                      <TableCell>{c.rfm_segment && <Badge className={`text-[10px] ${RFM_SEGMENT_COLORS[c.rfm_segment] || ''}`}>{c.rfm_segment}</Badge>}</TableCell>
                      <TableCell className="text-center"><span className={`text-xs font-mono ${(c.rfm_recency_score || 0) >= 4 ? 'text-emerald-600 font-bold' : (c.rfm_recency_score || 0) <= 2 ? 'text-red-500' : ''}`}>{c.rfm_recency_score || '-'}</span></TableCell>
                      <TableCell className="text-center"><span className={`text-xs font-mono ${(c.rfm_frequency_score || 0) >= 4 ? 'text-emerald-600 font-bold' : (c.rfm_frequency_score || 0) <= 2 ? 'text-red-500' : ''}`}>{c.rfm_frequency_score || '-'}</span></TableCell>
                      <TableCell className="text-center"><span className={`text-xs font-mono ${(c.rfm_monetary_score || 0) >= 4 ? 'text-emerald-600 font-bold' : (c.rfm_monetary_score || 0) <= 2 ? 'text-red-500' : ''}`}>{c.rfm_monetary_score || '-'}</span></TableCell>
                      <TableCell className="text-right font-mono text-xs">{c.total_orders}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatCurrency(c.total_spent)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{formatDate(c.last_purchase_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length > 200 && <p className="text-xs text-muted-foreground text-center py-2">Mostrando 200 de {filtered.length}</p>}
            </ScrollArea>
          </TabsContent>

          {/* ── TEMPLATES META ── */}
          <TabsContent value="templates" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><Megaphone className="h-4 w-4" />Templates Meta WhatsApp</CardTitle>
                <CardDescription className="text-xs">
                  Crie templates ou utilize templates já aprovados na Meta para disparos em massa.
                </CardDescription>
              </CardHeader>
              <CardContent><MetaTemplateCreator /></CardContent>
            </Card>
          </TabsContent>

          {/* ── DISPAROS ── */}
          <TabsContent value="disparos" className="space-y-4">
            <MassTemplateDispatcher />
          </TabsContent>

          {/* ── AUTOMAÇÕES ── */}
          <TabsContent value="automations" className="space-y-4">
            <AutomationFlowBuilder />
          </TabsContent>

          {/* ── SETORES ── */}
          <TabsContent value="sectors" className="space-y-4">
            <SectorManager />
          </TabsContent>

          {/* ── LANDING PAGES ── */}
          <TabsContent value="landing_pages" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Links das suas landing pages</p>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Landing Pages Fixas</CardTitle>
                <CardDescription className="text-xs">Páginas interativas com rotas fixas no app</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { name: 'Live Ortopédicos', path: '/live-ortopedicos', description: 'Landing page da Live Shopping de Calçados Ortopédicos — Captação em etapas + Countdown' },
                  { name: 'Banana Verão', path: '/banana-verao', description: 'Funil interativo de captação de leads' },
                  { name: 'Banana Verão - GV', path: '/banana-verao-gv', description: 'Funil para público de Gov. Valadares (Centro e Jardim Pérola)' },
                ].map(lp => {
                  const publishedUrl = `https://checkout.bananacalcados.com.br${lp.path}`;
                  return (
                    <div key={lp.path} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{lp.name}</p>
                        <p className="text-xs text-muted-foreground">{lp.description}</p>
                        <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{publishedUrl}</p>
                      </div>
                      <div className="flex gap-1 shrink-0 ml-2">
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(publishedUrl); toast.success('Link copiado!'); }}>
                          <Copy className="h-3.5 w-3.5" />Copiar
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => window.open(publishedUrl, '_blank')}>
                          <ExternalLink className="h-3.5 w-3.5" />Abrir
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Catalog Landing Pages */}
            <CatalogLandingPageCreator />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Landing Pages de Campanhas</CardTitle>
                <CardDescription className="text-xs">Páginas criadas dentro de campanhas (rota /lp/:slug)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {landingPages.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Nenhuma landing page de campanha criada ainda</p>
                ) : (
                  landingPages.map(lp => {
                    const publishedUrl = `https://checkout.bananacalcados.com.br/lp/${lp.slug}`;
                    return (
                      <div key={lp.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{lp.title}</p>
                            <Badge variant={lp.is_active ? 'default' : 'secondary'} className="text-[10px]">{lp.is_active ? 'Ativa' : 'Inativa'}</Badge>
                          </div>
                          {lp.marketing_campaigns?.name && <p className="text-xs text-muted-foreground">Campanha: {lp.marketing_campaigns.name}</p>}
                          <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{publishedUrl}</p>
                          <p className="text-xs text-muted-foreground">{lp.views || 0} views · {lp.submissions || 0} submissões</p>
                        </div>
                        <div className="flex gap-1 shrink-0 ml-2">
                          <Button variant="outline" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(publishedUrl); toast.success('Link copiado!'); }}>
                            <Copy className="h-3.5 w-3.5" />Copiar
                          </Button>
                          <Button variant="outline" size="sm" className="gap-1" onClick={() => window.open(publishedUrl, '_blank')}>
                            <ExternalLink className="h-3.5 w-3.5" />Abrir
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── LEADS ── */}
          <TabsContent value="leads" className="space-y-4">
            {(() => {
              const campaignIds = [...new Set(leads.map(l => l.campaign_tag))].sort();
              const filteredLeads = leads.filter(l => {
                if (leadsCampaignFilter !== "all" && l.campaign_tag !== leadsCampaignFilter) return false;
                if (leadsSearch) {
                  const q = leadsSearch.toLowerCase();
                  return (l.name?.toLowerCase().includes(q) || l.phone?.includes(q) || l.email?.toLowerCase().includes(q) || l.instagram?.toLowerCase().includes(q));
                }
                return true;
              });

              return (
                <>
                  {/* Total vs Unique leads info */}
                  {(() => {
                    const uniquePhones = new Set(leads.filter(l => l.phone).map(l => l.phone.replace(/\D/g, '')));
                    const convertedCount = leads.filter(l => l.converted).length;
                    return (
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Badge variant="outline" className="text-xs">📊 Total cadastros: {leads.length}</Badge>
                        <Badge variant="secondary" className="text-xs">👤 Leads únicos: {uniquePhones.size}</Badge>
                        <Badge className="text-xs bg-emerald-600 text-white">✅ Convertidos: {convertedCount}</Badge>
                        {leads.length > uniquePhones.size && (
                          <Badge variant="destructive" className="text-xs">⚠️ {leads.length - uniquePhones.size} duplicados entre campanhas</Badge>
                        )}
                      </div>
                    );
                  })()}
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={leadsCampaignFilter} onValueChange={setLeadsCampaignFilter}>
                      <SelectTrigger className="w-[250px]">
                        <SelectValue placeholder="Filtrar por campanha" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as campanhas ({leads.length})</SelectItem>
                        {campaignIds.map(cid => (
                          <SelectItem key={cid} value={cid}>{cid} ({leads.filter(l => l.campaign_tag === cid).length})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Buscar por nome, telefone, email..." value={leadsSearch} onChange={e => setLeadsSearch(e.target.value)} className="pl-9" />
                    </div>
                    <Badge variant="secondary">{filteredLeads.length} leads</Badge>
                    <Button variant="outline" size="sm" onClick={() => setLeadImportOpen(true)} className="gap-1">
                      <Upload className="h-3.5 w-3.5" />Importar XLS
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchLeads} className="gap-1">
                      <RefreshCw className="h-3.5 w-3.5" />Atualizar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={leadBackfillStatus?.status === 'processing'}
                      onClick={handleStartLeadBackfill}
                    >
                      {leadBackfillStatus?.status === 'processing' ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />Backfill em andamento
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />Backfill Orgânicos
                        </>
                      )}
                    </Button>
                  </div>

                  {leadBackfillStatus && leadBackfillStatus.status !== 'idle' && (
                    <Card>
                      <CardContent className="space-y-3 pt-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">Busca retroativa de leads</span>
                              <Badge variant={leadBackfillStatus.status === 'failed' ? 'destructive' : 'secondary'}>
                                {leadBackfillStatus.status === 'processing' ? 'Processando' : leadBackfillStatus.status === 'completed' ? 'Concluído' : 'Erro'}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{leadBackfillStatus.detail}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-semibold">{leadBackfillStatus.progress ?? 0}%</p>
                            <p className="text-xs text-muted-foreground">Faltam {Math.max(0, 100 - (leadBackfillStatus.progress ?? 0))}%</p>
                          </div>
                        </div>

                        <Progress value={leadBackfillStatus.progress ?? 0} className="h-2.5" />

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {typeof leadBackfillStatus.totalPhones === 'number' && (
                            <span>{leadBackfillStatus.totalPhones.toLocaleString('pt-BR')} contatos encontrados</span>
                          )}
                          {typeof leadBackfillStatus.customersExcluded === 'number' && (
                            <span>{leadBackfillStatus.customersExcluded.toLocaleString('pt-BR')} clientes ignorados</span>
                          )}
                          {typeof leadBackfillStatus.existingLeadsExcluded === 'number' && (
                            <span>{leadBackfillStatus.existingLeadsExcluded.toLocaleString('pt-BR')} leads já existentes</span>
                          )}
                          {typeof leadBackfillStatus.inserted === 'number' && (
                            <span>{leadBackfillStatus.inserted.toLocaleString('pt-BR')} leads criados</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardContent className="p-0">
                      {leadsLoading ? (
                        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                      ) : filteredLeads.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-12">Nenhum lead encontrado</p>
                      ) : (
                        <ScrollArea className="h-[500px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Nome</TableHead>
                                <TableHead>Telefone</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Instagram</TableHead>
                                <TableHead>Campanha</TableHead>
                                <TableHead>Fonte</TableHead>
                                <TableHead>Data</TableHead>
                                <TableHead>Convertido</TableHead>
                                <TableHead className="w-24">Ações</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredLeads.slice(0, 500).map(lead => (
                                <TableRow key={lead.id}>
                                  <TableCell className="font-medium">{lead.name || '—'}</TableCell>
                                  <TableCell className="text-xs">{lead.phone || '—'}</TableCell>
                                  <TableCell className="text-xs">{lead.email || '—'}</TableCell>
                                  <TableCell className="text-xs">{lead.instagram || '—'}</TableCell>
                                  <TableCell><Badge variant="outline" className="text-[10px]">{lead.campaign_tag}</Badge></TableCell>
                                  <TableCell className="text-xs">{lead.source || '—'}</TableCell>
                                  <TableCell className="text-xs">{new Date(lead.created_at).toLocaleDateString('pt-BR')}</TableCell>
                                  <TableCell>{lead.converted ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-muted-foreground/40" />}</TableCell>
                                  <TableCell>
                                    <div className="flex gap-0.5">
                                      {lead.phone && (
                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver chat WhatsApp"
                                          onClick={() => { setLeadChatPhone(lead.phone); setLeadChatName(lead.name || ''); }}>
                                          <MessageSquare className="h-4 w-4 text-stage-paid" />
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar lead"
                                        onClick={() => setEditingLead({ ...lead })}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir lead"
                                        onClick={() => deleteLead(lead.id)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {filteredLeads.length > 500 && <p className="text-xs text-muted-foreground text-center py-2">Mostrando 500 de {filteredLeads.length}</p>}
                        </ScrollArea>
                      )}
                    </CardContent>
                  </Card>
                </>
              );
            })()}
            <CatalogLeadPageCreator />
            <WhatsAppAdKeywords />
          </TabsContent>

          {/* ── GRUPOS VIP ── */}
          <TabsContent value="groups_vip" className="space-y-4">
            <GroupsVipManager />
          </TabsContent>

          {/* ── PRÊMIOS ── */}
          <TabsContent value="prizes" className="space-y-4">
            <PrizeManager />
          </TabsContent>

          {/* ── LIVE COMMERCE ── */}
          <TabsContent value="live_commerce" className="space-y-4">
            <LiveSessionManager />
          </TabsContent>

          {/* ── LINK PAGES ── */}
          <TabsContent value="link_pages" className="space-y-4">
            <LinkPageManager />
          </TabsContent>

          {/* ── PUSH NOTIFICATIONS ── */}
          <TabsContent value="push_notifications" className="space-y-4">
            <PushNotificationPanel />
          </TabsContent>

          <TabsContent value="calendar" className="space-y-4">
            <MarketingCalendar />
          </TabsContent>

          {/* ── IA ADS ── */}
          <TabsContent value="ai_ads" className="space-y-4">
            <AdCampaignManager />
          </TabsContent>

          {/* ── IG AUTOMAÇÃO ── */}
          <TabsContent value="ig_automation" className="space-y-4">
            <InstagramCommentAutomation />
          </TabsContent>

          {/* Lead WhatsApp Chat Dialog */}
          <LeadWhatsAppDialog
            open={!!leadChatPhone}
            onOpenChange={(open) => { if (!open) setLeadChatPhone(null); }}
            phone={leadChatPhone || ''}
            leadName={leadChatName}
          />
        </Tabs>
      </div>



      {/* Campaign Detail */}
      <CampaignDetail
        campaign={selectedCampaign}
        onClose={() => setSelectedCampaign(null)}
        onStatusChange={updateCampaignStatus}
      />

      {/* Customer Detail Dialog */}
      <Dialog open={!!selectedCustomer} onOpenChange={(open) => { if (!open) { setSelectedCustomer(null); setWhatsAppMessage(""); setPurchaseDates(null); setCustomerCashback(null); setCustomerPrizes([]); setExpandedPurchase(null); setCustomerDispatches([]); (window as any).__purchaseDatesOpen = false; } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {selectedCustomer?.first_name} {selectedCustomer?.last_name}
              </span>
              <div className="flex gap-1 mr-6">
                <Button variant="outline" size="icon" className="h-7 w-7" title="Editar" onClick={() => setEditingCustomer(selectedCustomer ? { ...selectedCustomer } : null)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir" onClick={() => selectedCustomer && deleteCustomer(selectedCustomer.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          {selectedCustomer && (
            <div className="space-y-4">
              {/* RFM Badge + Opt-out */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedCustomer.rfm_segment && (
                    <Badge className={`${RFM_SEGMENT_COLORS[selectedCustomer.rfm_segment] || ''}`}>
                      {selectedCustomer.rfm_segment}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="opt-out-toggle" className={`text-xs font-medium ${selectedCustomer.opt_out_mass_dispatch ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {selectedCustomer.opt_out_mass_dispatch ? '🚫 Bloqueado p/ disparos' : 'Recebe disparos'}
                  </label>
                  <Switch
                    id="opt-out-toggle"
                    checked={!!selectedCustomer.opt_out_mass_dispatch}
                    onCheckedChange={async (checked) => {
                      const { error } = await supabase.from('zoppy_customers').update({ opt_out_mass_dispatch: checked }).eq('id', selectedCustomer.id);
                      if (error) { toast.error('Erro ao atualizar'); return; }
                      setSelectedCustomer(prev => prev ? { ...prev, opt_out_mass_dispatch: checked } as any : prev);
                      setCustomers(prev => prev.map(c => c.id === selectedCustomer.id ? { ...c, opt_out_mass_dispatch: checked } : c));
                      toast.success(checked ? '🚫 Cliente bloqueado para disparos em massa' : '✅ Cliente desbloqueado para disparos');
                    }}
                  />
                </div>
              </div>

              {/* Store & Seller Info */}
              {(() => {
                const suffix = (selectedCustomer.phone || '').replace(/\D/g, '').slice(-8);
                const mapping = suffix ? customerStoreMap.get(suffix) : undefined;
                const storeName = mapping?.store_name;
                const sellerName = (selectedCustomer as any)._lastSellerName || mapping?.seller_name;
                if (!storeName && !sellerName) return null;
                return (
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 text-sm">
                    {storeName && <span className="flex items-center gap-1.5 text-muted-foreground"><Store className="h-3.5 w-3.5" />{storeName}</span>}
                    {sellerName && <span className="flex items-center gap-1.5 text-muted-foreground"><Users className="h-3.5 w-3.5" />{sellerName}</span>}
                  </div>
                );
              })()}

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {selectedCustomer.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />{selectedCustomer.phone}
                  </div>
                )}
                {selectedCustomer.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />{selectedCustomer.email}
                  </div>
                )}
                <div className="relative">
                  <button
                    onClick={async () => {
                      if ((window as any).__purchaseDatesOpen) {
                        (window as any).__purchaseDatesOpen = false;
                        setPurchaseDates(null);
                        setExpandedPurchase(null);
                        return;
                      }
                      (window as any).__purchaseDatesOpen = true;
                      setPurchaseDatesLoading(true);
                      setPurchaseDates([]);
                      setExpandedPurchase(null);
                      try {
                        const phoneDigits = (selectedCustomer.phone || '').replace(/\D/g, '');
                        const suffix8 = phoneDigits.slice(-8);
                        if (!suffix8) { setPurchaseDatesLoading(false); return; }

                        // Fetch zoppy_sales with line_items, pos_sales with items, cashback, and prizes in parallel
                        const [zRes, posCustomersRes, cashbackRes, prizesRes] = await Promise.all([
                          supabase.from('zoppy_sales').select('completed_at, total, status, line_items, customer_name').ilike('customer_phone', `%${suffix8}`).order('completed_at', { ascending: false }).limit(50),
                          supabase.from('pos_customers').select('id, whatsapp').ilike('whatsapp', `%${suffix8}`),
                          supabase.from('customer_loyalty_points').select('total_points, expires_at').ilike('customer_phone', `%${suffix8}`).limit(1),
                          supabase.from('customer_prizes').select('prize_label, coupon_code, is_redeemed, expires_at, prize_value').ilike('customer_phone', `%${suffix8}`).order('created_at', { ascending: false }).limit(10),
                        ]);

                        // Set cashback & prizes
                        setCustomerCashback(cashbackRes.data?.[0] || null);
                        setCustomerPrizes(prizesRes.data || []);

                        const dates: { date: string; total: number; source: string; products: { name: string; qty: number; price: number }[]; store?: string; seller?: string }[] = [];

                        // Process zoppy_sales (online)
                        (zRes.data || []).forEach((s: any) => {
                          if (!s.completed_at) return;
                          const products: { name: string; qty: number; price: number }[] = [];
                          if (Array.isArray(s.line_items)) {
                            s.line_items.forEach((item: any) => {
                              products.push({
                                name: item.product?.name || item.name || item.title || 'Produto',
                                qty: item.quantity || 1,
                                price: item.product?.price || item.price || 0,
                              });
                            });
                          }
                          dates.push({ date: s.completed_at, total: s.total || 0, source: 'Online', products });
                        });

                        // Process pos_sales
                        const posCustomerIds = new Set((posCustomersRes.data || []).map((c: any) => c.id));
                        if (posCustomerIds.size > 0) {
                          const posFiltered = await supabase.from('pos_sales').select('id, created_at, total, status, customer_id, store_id, seller_id').in('customer_id', Array.from(posCustomerIds)).order('created_at', { ascending: false }).limit(50);
                          const saleIds = (posFiltered.data || []).map((s: any) => s.id);
                          
                          // Fetch items + store/seller names
                          const [itemsRes, storesRes, sellersRes] = await Promise.all([
                            saleIds.length > 0 ? supabase.from('pos_sale_items').select('sale_id, product_name, variant_name, quantity, unit_price').in('sale_id', saleIds) : { data: [] },
                            supabase.from('pos_stores').select('id, name'),
                            supabase.from('pos_sellers').select('id, name'),
                          ]);

                          const itemsBySale = new Map<string, { name: string; qty: number; price: number }[]>();
                          ((itemsRes as any).data || []).forEach((item: any) => {
                            if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
                            itemsBySale.get(item.sale_id)!.push({
                              name: item.variant_name ? `${item.product_name} - ${item.variant_name}` : item.product_name,
                              qty: item.quantity || 1,
                              price: item.unit_price || 0,
                            });
                          });
                          const storeMap = new Map((storesRes.data || []).map((s: any) => [s.id, s.name]));
                          const sellerMap = new Map((sellersRes.data || []).map((s: any) => [s.id, s.name]));

                          (posFiltered.data || []).forEach((s: any) => {
                            if (s.created_at) dates.push({
                              date: s.created_at,
                              total: s.total || 0,
                              source: 'PDV',
                              products: itemsBySale.get(s.id) || [],
                              store: storeMap.get(s.store_id) || undefined,
                              seller: sellerMap.get(s.seller_id) || undefined,
                            });
                          });
                        }

                        dates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                        setPurchaseDates(dates);

                        // Update selectedCustomer with real data from purchase history
                        if (dates.length > 0) {
                          const realLastPurchase = dates[0].date;
                          const realTotalSpent = dates.reduce((s, d) => s + d.total, 0);
                          const realTotalOrders = dates.length;
                          const realAvgTicket = realTotalOrders > 0 ? realTotalSpent / realTotalOrders : 0;
                          setSelectedCustomer(prev => prev ? {
                            ...prev,
                            last_purchase_at: realLastPurchase,
                            total_spent: realTotalSpent,
                            total_orders: realTotalOrders,
                            avg_ticket: realAvgTicket,
                          } : prev);
                        }
                      } catch (err) {
                        console.error('Error fetching purchase dates:', err);
                      } finally {
                        setPurchaseDatesLoading(false);
                      }
                    }}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    <ShoppingBag className="h-4 w-4" />{selectedCustomer.total_orders} pedidos
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {purchaseDates !== null && (
                    <Card className="absolute z-50 top-7 left-0 w-80 p-3 shadow-lg border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold">Histórico de Compras</span>
                        <button onClick={() => { setPurchaseDates(null); setExpandedPurchase(null); (window as any).__purchaseDatesOpen = false; }} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                      </div>
                      {purchaseDatesLoading ? (
                        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin mr-1" />Carregando...</div>
                      ) : purchaseDates.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-3">
                          {selectedCustomer && (selectedCustomer as any).total_orders > 0 ? (
                            <div className="space-y-2">
                              <p>📦 {(selectedCustomer as any).total_orders} pedidos registrados</p>
                              <p className="text-[10px] italic">Detalhes individuais não disponíveis — dados importados do sistema legado sem histórico de transações.</p>
                              {(selectedCustomer as any).last_purchase_at && (
                                <p className="text-[10px]">Última compra: {new Date((selectedCustomer as any).last_purchase_at).toLocaleDateString('pt-BR')}</p>
                              )}
                            </div>
                          ) : (
                            'Nenhuma compra encontrada'
                          )}
                        </div>
                      ) : (
                        <ScrollArea className="max-h-[300px]">
                          <div className="space-y-1">
                            {purchaseDates.map((p, i) => (
                              <div key={i} className="border-b border-border/50 last:border-0">
                                <button
                                  onClick={() => setExpandedPurchase(expandedPurchase === i ? null : i)}
                                  className="flex items-center justify-between text-xs py-1.5 w-full hover:bg-muted/50 rounded px-1 transition-colors"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <ChevronDown className={`h-3 w-3 transition-transform ${expandedPurchase === i ? 'rotate-180' : ''}`} />
                                    <span>{new Date(p.date).toLocaleDateString('pt-BR')}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-[9px] px-1">{p.source}</Badge>
                                    <span className="font-medium text-green-600">R$ {Number(p.total).toFixed(2)}</span>
                                  </div>
                                </button>
                                {expandedPurchase === i && (
                                  <div className="pl-5 pb-2 space-y-1">
                                    {p.store && <p className="text-[10px] text-muted-foreground">🏪 {p.store}{p.seller ? ` • ${p.seller}` : ''}</p>}
                                    {p.products.length > 0 ? p.products.map((prod, j) => (
                                      <div key={j} className="flex justify-between text-[10px] text-muted-foreground">
                                        <span className="truncate max-w-[180px]">{prod.qty}x {prod.name}</span>
                                        <span>R$ {(prod.qty * prod.price).toFixed(2)}</span>
                                      </div>
                                    )) : (
                                      <p className="text-[10px] text-muted-foreground italic">Sem detalhes de produtos</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}

                      {/* Cashback */}
                      {customerCashback && customerCashback.total_points > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1 font-medium text-amber-500">💰 Cashback</span>
                            <span className="font-bold text-amber-500">{customerCashback.total_points} pts</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">Expira em {new Date(customerCashback.expires_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                      )}

                      {/* Prizes */}
                      {customerPrizes.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <p className="text-xs font-medium mb-1 flex items-center gap-1">🎁 Premiações</p>
                          {customerPrizes.map((prize, i) => (
                            <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                              <span className="truncate max-w-[160px]">{prize.prize_label}</span>
                              <div className="flex items-center gap-1.5">
                                <code className="bg-muted px-1 rounded text-[9px]">{prize.coupon_code}</code>
                                <Badge variant={prize.is_redeemed ? "secondary" : "default"} className="text-[8px] px-1">
                                  {prize.is_redeemed ? "Resgatado" : new Date(prize.expires_at) < new Date() ? "Expirado" : "Ativo"}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  )}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <TrendingUp className="h-4 w-4" />{formatCurrency(selectedCustomer.total_spent)}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Star className="h-4 w-4" />Ticket médio: {formatCurrency(selectedCustomer.avg_ticket)}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />Última: {formatDate(selectedCustomer.last_purchase_at)}
                </div>
              </div>

              {/* RFM Scores */}
              {(selectedCustomer.rfm_recency_score || selectedCustomer.rfm_frequency_score || selectedCustomer.rfm_monetary_score) && (
                <div className="flex gap-4 p-3 rounded-lg bg-muted/50">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Recência</p>
                    <p className="text-lg font-bold">{selectedCustomer.rfm_recency_score || '-'}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Frequência</p>
                    <p className="text-lg font-bold">{selectedCustomer.rfm_frequency_score || '-'}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Monetário</p>
                    <p className="text-lg font-bold">{selectedCustomer.rfm_monetary_score || '-'}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="text-lg font-bold text-primary">{selectedCustomer.rfm_total_score || '-'}</p>
                  </div>
                </div>
              )}

              {/* Contact Actions */}
              {selectedCustomer.phone && (
                <div className="space-y-3 border-t pt-3">
                  <CrmMessageTemplateSelector
                    onSelect={(msg) => setWhatsAppMessage(msg)}
                    variables={{
                      "{{nome}}": `${selectedCustomer.first_name || ''} ${selectedCustomer.last_name || ''}`.trim(),
                      "{{primeiro_nome}}": selectedCustomer.first_name || '',
                      "{{telefone}}": selectedCustomer.phone || '',
                      "{{email}}": selectedCustomer.email || '',
                      "{{ultima_compra}}": selectedCustomer.last_purchase_at ? new Date(selectedCustomer.last_purchase_at).toLocaleDateString('pt-BR') : '',
                      "{{total_gasto}}": formatCurrency(selectedCustomer.total_spent),
                      "{{ticket_medio}}": formatCurrency(selectedCustomer.avg_ticket),
                      "{{total_pedidos}}": String(selectedCustomer.total_orders),
                      "{{segmento}}": selectedCustomer.rfm_segment || '',
                      "{{vendedora}}": (selectedCustomer as any)._lastSellerName || (() => { const s = (selectedCustomer.phone || '').replace(/\D/g, '').slice(-8); return s ? (customerStoreMap.get(s)?.seller_name || '') : ''; })(),
                      "{{ultimo_produto}}": (selectedCustomer as any)._lastProductName || '',
                    }}
                  />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Entrar em contato</p>
                    <Textarea
                      placeholder="Mensagem para o cliente..."
                      value={whatsAppMessage}
                      onChange={e => setWhatsAppMessage(e.target.value)}
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1" onClick={() => {
                        const phone = selectedCustomer.phone!.replace(/\D/g, '');
                        const fullPhone = phone.startsWith('55') ? phone : `55${phone}`;
                        const url = `https://wa.me/${fullPhone}${whatsAppMessage ? `?text=${encodeURIComponent(whatsAppMessage)}` : ''}`;
                        window.open(url, '_blank');
                      }}>
                        <MessageSquare className="h-3.5 w-3.5" />WhatsApp
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => {
                        const phone = selectedCustomer.phone!.replace(/\D/g, '');
                        window.open(`tel:+55${phone}`, '_blank');
                      }}>
                        <Phone className="h-3.5 w-3.5" />Ligar
                      </Button>
                      {selectedCustomer.email && (
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => {
                          window.open(`mailto:${selectedCustomer.email}`, '_blank');
                        }}>
                          <Mail className="h-3.5 w-3.5" />Email
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
        if (!open && uploadStatus && !uploadStatus.done && !uploadStatus.error) return; // prevent close during upload
        setUploadDialogOpen(open);
        if (!open) setUploadStatus(null);
      }}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => {
          if (uploadStatus && !uploadStatus.done && !uploadStatus.error) e.preventDefault();
        }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />{uploadTarget === 'rfm' ? 'Upload de Clientes para RFM' : 'Upload de Planilha Excel'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!uploadStatus ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Faça upload de uma planilha .xlsx com seus contatos. O sistema detecta automaticamente colunas de telefone, nome, email e Instagram.
                </p>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload}
                    className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-4">
                {/* Status icon */}
                <div className="flex items-center gap-3">
                  {uploadStatus.error ? (
                    <XCircle className="h-6 w-6 text-destructive shrink-0" />
                  ) : uploadStatus.done ? (
                    <CheckCircle className="h-6 w-6 text-primary shrink-0" />
                  ) : (
                    <Loader2 className="h-6 w-6 text-primary animate-spin shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {uploadStatus.error ? uploadStatus.error : uploadStatus.done ? 'Concluído!' : 'Processando...'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{uploadStatus.detail}</p>
                  </div>
                  <span className="text-sm font-mono font-bold text-primary">{uploadStatus.progress}%</span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      uploadStatus.error ? 'bg-destructive' : uploadStatus.done ? 'bg-primary' : 'bg-primary'
                    }`}
                    style={{ width: `${uploadStatus.progress}%` }}
                  />
                </div>

                {/* Warning or actions */}
                {!uploadStatus.done && !uploadStatus.error && (
                  <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Não feche esta janela durante o processamento
                  </p>
                )}

                {(uploadStatus.done || uploadStatus.error) && (
                  <div className="flex justify-end gap-2">
                    {uploadStatus.error && (
                      <Button variant="outline" size="sm" onClick={() => { setUploadStatus(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                        Tentar novamente
                      </Button>
                    )}
                    <Button size="sm" onClick={() => { setUploadDialogOpen(false); setUploadStatus(null); }}>
                      {uploadStatus.done ? 'Fechar' : 'OK'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <LeadImportDialog
        open={leadImportOpen}
        onOpenChange={setLeadImportOpen}
        existingCampaignTags={[...new Set(leads.map((lead) => lead.campaign_tag).filter(Boolean))].sort()}
        onImported={fetchLeads}
      />

      {/* Edit Customer Dialog */}
      <Dialog open={!!editingCustomer} onOpenChange={(open) => { if (!open) setEditingCustomer(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Editar Cliente</DialogTitle></DialogHeader>
          {editingCustomer && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Nome</label>
                  <Input value={editingCustomer.first_name || ''} onChange={e => setEditingCustomer(prev => prev ? { ...prev, first_name: e.target.value } : null)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Sobrenome</label>
                  <Input value={editingCustomer.last_name || ''} onChange={e => setEditingCustomer(prev => prev ? { ...prev, last_name: e.target.value } : null)} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Telefone</label>
                <Input value={editingCustomer.phone || ''} onChange={e => setEditingCustomer(prev => prev ? { ...prev, phone: e.target.value } : null)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Email</label>
                <Input value={editingCustomer.email || ''} onChange={e => setEditingCustomer(prev => prev ? { ...prev, email: e.target.value } : null)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Cidade</label>
                  <Input value={editingCustomer.city || ''} onChange={e => setEditingCustomer(prev => prev ? { ...prev, city: e.target.value } : null)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Estado</label>
                  <Input value={editingCustomer.state || ''} onChange={e => setEditingCustomer(prev => prev ? { ...prev, state: e.target.value } : null)} />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setEditingCustomer(null)}>Cancelar</Button>
                <Button onClick={saveCustomerEdit} className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Salvar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Lead Dialog */}
      <Dialog open={!!editingLead} onOpenChange={(open) => { if (!open) setEditingLead(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Target className="h-5 w-5" />Editar Lead</DialogTitle></DialogHeader>
          {editingLead && (
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs text-muted-foreground">Nome</label>
                <Input value={editingLead.name || ''} onChange={e => setEditingLead((prev: any) => prev ? { ...prev, name: e.target.value } : null)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Telefone</label>
                <Input value={editingLead.phone || ''} onChange={e => setEditingLead((prev: any) => prev ? { ...prev, phone: e.target.value } : null)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Email</label>
                <Input value={editingLead.email || ''} onChange={e => setEditingLead((prev: any) => prev ? { ...prev, email: e.target.value } : null)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Instagram</label>
                <Input value={editingLead.instagram || ''} onChange={e => setEditingLead((prev: any) => prev ? { ...prev, instagram: e.target.value } : null)} />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setEditingLead(null)}>Cancelar</Button>
                <Button onClick={saveLeadEdit} className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Salvar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
