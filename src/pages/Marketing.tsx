import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, Search, RefreshCw, Upload, Download, Filter, BarChart3,
  MapPin, Phone, Mail, ShoppingBag, Crown, AlertTriangle, Clock,
  Heart, Star, Zap, ChevronDown, Plus, ArrowUpDown, Megaphone,
  FileSpreadsheet, X, TrendingUp, Send, Brain, Trash2, GripVertical,
  Settings, Play, Pause, CheckCircle2, Eye, Copy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MetaTemplateCreator } from "@/components/MetaTemplateCreator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useNavigate } from "react-router-dom";

// ─── Types ──────────────────────────────────────────

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
}

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  objective: string | null;
  target_audience: string | null;
  ai_prompt: string | null;
  ai_strategy: any;
  channels: string[] | null;
  contact_list_id: string | null;
  whatsapp_number_id: string | null;
  whatsapp_template_name: string | null;
  whatsapp_template_params: any;
  total_recipients: number | null;
  sent_count: number | null;
  delivered_count: number | null;
  read_count: number | null;
  failed_count: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  content: any;
}

interface CampaignStep {
  id: string;
  template_name: string;
  template_params: Record<string, string>;
  delay_hours: number;
  label: string;
  objective?: string;
  timing?: string;
  tone?: string;
  content_suggestion?: string;
  media_suggestion?: string;
}

interface AIStrategy {
  campaign_name: string;
  summary: string;
  target_analysis: string;
  lead_capture: {
    strategy: string;
    channels: string[];
    tips: string[];
  };
  communication_steps: Array<{
    step_number: number;
    label: string;
    objective: string;
    timing: string;
    delay_hours: number;
    tone: string;
    content_suggestion: string;
    media_suggestion?: string;
  }>;
  success_metrics: string[];
  additional_tips: string[];
}

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
  source: string;
}

interface WhatsAppNumber {
  id: string;
  label: string;
  phone_display: string;
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
  "Campeões": Crown,
  "Leais": Heart,
  "Novos Clientes": Star,
  "Promissores": TrendingUp,
  "Em Risco": AlertTriangle,
  "Quase Dormindo": Clock,
  "Hibernando": Clock,
};

const REGION_LABELS: Record<string, string> = {
  local: "🏪 Loja Física (GV)",
  online: "🌐 Online",
  unknown: "❓ Indefinido",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  sending: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  review: "Em Revisão",
  approved: "Aprovada",
  sending: "Enviando",
  completed: "Concluída",
  failed: "Falhou",
};

// ─── Component ──────────────────────────────────────

export default function Marketing() {
  const navigate = useNavigate();

  // Campaigns state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [whatsappNumbers, setWhatsappNumbers] = useState<WhatsAppNumber[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiStrategy, setAiStrategy] = useState<AIStrategy | null>(null);
  const [creationStep, setCreationStep] = useState<'briefing' | 'strategy' | 'configure'>('briefing');

  // Campaign form
  const [campaignName, setCampaignName] = useState("");
  const [campaignObjective, setCampaignObjective] = useState("");
  const [campaignAudience, setCampaignAudience] = useState("");
  const [campaignAiPrompt, setCampaignAiPrompt] = useState("");
  const [campaignListId, setCampaignListId] = useState("");
  const [campaignNumberId, setCampaignNumberId] = useState("");
  const [campaignSteps, setCampaignSteps] = useState<CampaignStep[]>([
    { id: crypto.randomUUID(), template_name: "", template_params: {}, delay_hours: 0, label: "Mensagem 1" },
  ]);

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Fetch data ──────────────────────────────

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('zoppy_customers')
        .select('*')
        .order('total_spent', { ascending: false })
        .limit(1000);
      if (error) throw error;
      setCustomers((data || []) as ZoppyCustomer[]);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar clientes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchCampaigns = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setCampaigns(data || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchContactLists = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('marketing_contact_lists')
        .select('id, name, contact_count, source')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setContactLists(data || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchWhatsappNumbers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_numbers')
        .select('id, label, phone_display')
        .eq('is_active', true);
      if (error) throw error;
      setWhatsappNumbers(data || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
    fetchCampaigns();
    fetchContactLists();
    fetchWhatsappNumbers();
  }, [fetchCustomers, fetchCampaigns, fetchContactLists, fetchWhatsappNumbers]);

  // ─── Campaign actions ──────────────────────────────

  const handleGenerateAI = async () => {
    if (!campaignObjective.trim()) {
      toast.error("Informe o objetivo da campanha");
      return;
    }
    setIsGeneratingAI(true);
    try {
      // Gather customer stats for context
      const customerStats = {
        total: customers.length,
        local: customers.filter(c => c.region_type === 'local').length,
        online: customers.filter(c => c.region_type === 'online').length,
        revenue: customers.reduce((s, c) => s + c.total_spent, 0),
        segments: [...new Set(customers.map(c => c.rfm_segment).filter(Boolean))],
      };

      const res = await supabase.functions.invoke('ai-marketing-strategy', {
        body: {
          objective: campaignObjective,
          audience: campaignAudience,
          instructions: campaignAiPrompt,
          customer_stats: customers.length > 0 ? customerStats : null,
        },
      });

      if (res.error) throw new Error(res.error.message);
      const data = res.data as any;
      
      if (!data?.success || !data?.strategy) {
        throw new Error(data?.error || "Erro ao gerar estratégia");
      }

      const strategy = data.strategy as AIStrategy;
      setAiStrategy(strategy);
      setCampaignName(strategy.campaign_name);
      setCampaignSteps(strategy.communication_steps.map((s) => ({
        id: crypto.randomUUID(),
        template_name: "",
        template_params: {},
        delay_hours: s.delay_hours,
        label: s.label,
        objective: s.objective,
        timing: s.timing,
        tone: s.tone,
        content_suggestion: s.content_suggestion,
        media_suggestion: s.media_suggestion,
      })));
      setCreationStep('strategy');
      toast.success("Estratégia gerada com sucesso!");
    } catch (err: any) {
      console.error(err);
      if (err?.message?.includes('429') || err?.message?.includes('Rate')) {
        toast.error("Limite de requisições atingido. Tente em alguns segundos.");
      } else if (err?.message?.includes('402')) {
        toast.error("Créditos de IA insuficientes.");
      } else {
        // Fallback to local strategy
        const strategy = generateLocalStrategy(campaignObjective, campaignAudience);
        setCampaignName(strategy.name);
        setAiStrategy({
          campaign_name: strategy.name,
          summary: `Campanha focada em: ${campaignObjective}`,
          target_analysis: campaignAudience || "Público geral da base de clientes",
          lead_capture: { strategy: "Captação via WhatsApp e redes sociais", channels: ["whatsapp", "instagram"], tips: ["Usar stories para gerar curiosidade", "Criar link de cadastro"] },
          communication_steps: strategy.steps.map((s: any, i: number) => ({
            step_number: i + 1, label: s.label, objective: `Etapa ${i + 1} da comunicação`,
            timing: i === 0 ? "Imediatamente" : `${s.delay_hours}h após etapa anterior`,
            delay_hours: s.delay_hours, tone: "engajamento", content_suggestion: "Personalizar com dados do cliente",
          })),
          success_metrics: ["Taxa de abertura > 70%", "Taxa de resposta > 15%", "Conversão em vendas"],
          additional_tips: ["Personalizar mensagens com nome do cliente", "Enviar em horários de maior engajamento (10h-12h, 18h-20h)"],
        });
        setCampaignSteps(strategy.steps.map((s: any) => ({
          id: crypto.randomUUID(), template_name: "", template_params: {},
          delay_hours: s.delay_hours, label: s.label,
        })));
        setCreationStep('strategy');
        toast.success("Estratégia gerada (offline)!");
      }
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const generateLocalStrategy = (objective: string, audience: string) => {
    const lower = objective.toLowerCase();
    if (lower.includes('live') || lower.includes('evento')) {
      return {
        name: `Campanha Live - ${new Date().toLocaleDateString('pt-BR', { month: 'short' })}`,
        steps: [
          { label: "Convite / Antecipação", delay_hours: 0, template_name: "live_convite" },
          { label: "Lembrete (1 dia antes)", delay_hours: 48, template_name: "live_lembrete" },
          { label: "Dia do Evento", delay_hours: 24, template_name: "live_hoje" },
          { label: "Pós-evento / Última Chance", delay_hours: 24, template_name: "live_pos_evento" },
        ],
        channels: ["whatsapp"],
      };
    }
    if (lower.includes('lançamento') || lower.includes('produto')) {
      return {
        name: `Lançamento - ${new Date().toLocaleDateString('pt-BR', { month: 'short' })}`,
        steps: [
          { label: "Teaser", delay_hours: 0, template_name: "lancamento_teaser" },
          { label: "Revelação", delay_hours: 72, template_name: "lancamento_revelacao" },
          { label: "Oferta Exclusiva", delay_hours: 48, template_name: "lancamento_oferta" },
        ],
        channels: ["whatsapp"],
      };
    }
    if (lower.includes('reativar') || lower.includes('reativação') || lower.includes('dormindo')) {
      return {
        name: `Reativação de Clientes - ${new Date().toLocaleDateString('pt-BR', { month: 'short' })}`,
        steps: [
          { label: "Sentimos sua falta", delay_hours: 0, template_name: "reativacao_saudade" },
          { label: "Cupom Exclusivo", delay_hours: 72, template_name: "reativacao_cupom" },
        ],
        channels: ["whatsapp"],
      };
    }
    return {
      name: `Campanha Marketing - ${new Date().toLocaleDateString('pt-BR', { month: 'short' })}`,
      steps: [
        { label: "Mensagem Inicial", delay_hours: 0, template_name: "campanha_msg1" },
        { label: "Follow-up", delay_hours: 48, template_name: "campanha_followup" },
        { label: "Encerramento", delay_hours: 72, template_name: "campanha_encerramento" },
      ],
      channels: ["whatsapp"],
    };
  };

  const handleCreateCampaign = async () => {
    if (!campaignName.trim()) {
      toast.error("Informe o nome da campanha");
      return;
    }
    try {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .insert([{
          name: campaignName,
          description: campaignObjective,
          objective: campaignObjective,
          target_audience: campaignAudience,
          ai_prompt: campaignAiPrompt,
          contact_list_id: campaignListId || null,
          whatsapp_number_id: campaignNumberId || null,
          whatsapp_template_name: campaignSteps[0]?.template_name || null,
          whatsapp_template_params: campaignSteps.length > 0 ? campaignSteps as any : null,
          channels: ['whatsapp'],
          status: 'draft',
          ai_strategy: aiStrategy as any,
          content: { steps: campaignSteps } as any,
        }])
        .select()
        .single();

      if (error) throw error;
      toast.success("Campanha criada!");
      setCampaigns(prev => [data, ...prev]);
      setIsCreating(false);
      resetForm();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao criar campanha");
    }
  };

  const resetForm = () => {
    setCampaignName("");
    setCampaignObjective("");
    setCampaignAudience("");
    setCampaignAiPrompt("");
    setCampaignListId("");
    setCampaignNumberId("");
    setAiStrategy(null);
    setCreationStep('briefing');
    setCampaignSteps([
      { id: crypto.randomUUID(), template_name: "", template_params: {}, delay_hours: 0, label: "Mensagem 1" },
    ]);
  };

  const addStep = () => {
    setCampaignSteps(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        template_name: "",
        template_params: {},
        delay_hours: 24,
        label: `Mensagem ${prev.length + 1}`,
      },
    ]);
  };

  const removeStep = (id: string) => {
    if (campaignSteps.length <= 1) return;
    setCampaignSteps(prev => prev.filter(s => s.id !== id));
  };

  const updateStep = (id: string, updates: Partial<CampaignStep>) => {
    setCampaignSteps(prev =>
      prev.map(s => s.id === id ? { ...s, ...updates } : s)
    );
  };

  const deleteCampaign = async (id: string) => {
    try {
      const { error } = await supabase.from('marketing_campaigns').delete().eq('id', id);
      if (error) throw error;
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast.success("Campanha excluída");
    } catch (err) {
      toast.error("Erro ao excluir");
    }
  };

  const updateCampaignStatus = async (id: string, status: string) => {
    try {
      const { error } = await supabase
        .from('marketing_campaigns')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status } : c));
      toast.success(`Status atualizado: ${STATUS_LABELS[status]}`);
    } catch (err) {
      toast.error("Erro ao atualizar status");
    }
  };

  // ─── Customer actions ──────────────────────────────

  const handleSyncRfm = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoppy-sync-customers`,
        {
          method: 'POST',
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mode: 'calculate_rfm' }),
        }
      );
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        fetchCustomers();
      } else {
        toast.error(data.error || "Erro ao calcular RFM");
      }
    } catch (err) {
      toast.error("Erro ao sincronizar");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncSales = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoppy-sync-sales`,
        {
          method: 'POST',
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ start_page: 1, max_pages: 50, after_date: '2022-01-01T00:00:00.000Z' }),
        }
      );
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        if (!data.completed) {
          toast.info("Existem mais vendas. Clique novamente para continuar.");
        }
      } else {
        toast.error(data.error || "Erro ao sincronizar vendas");
      }
    } catch (err) {
      toast.error("Erro ao sincronizar vendas");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) { toast.error("Planilha vazia"); return; }

      const headers = Object.keys(rows[0]);
      const phoneCol = headers.find(h => /phone|telefone|whatsapp|celular|fone/i.test(h));
      const nameCol = headers.find(h => /name|nome|cliente/i.test(h));
      const emailCol = headers.find(h => /email|e-mail/i.test(h));
      if (!phoneCol && !emailCol) { toast.error("Nenhuma coluna de telefone ou email encontrada"); return; }

      const contacts = rows.map(row => ({
        phone: phoneCol ? String(row[phoneCol] || '').replace(/\D/g, '') : null,
        name: nameCol ? String(row[nameCol] || '') : null,
        email: emailCol ? String(row[emailCol] || '') : null,
      })).filter(c => c.phone || c.email);

      const { data: list, error: listError } = await supabase
        .from('marketing_contact_lists')
        .insert({
          name: `Upload: ${file.name} (${new Date().toLocaleDateString('pt-BR')})`,
          source: 'excel_upload',
          contact_count: contacts.length,
          description: `${contacts.length} contatos importados de ${file.name}`,
        })
        .select()
        .single();
      if (listError) throw listError;

      for (let i = 0; i < contacts.length; i += 100) {
        const batch = contacts.slice(i, i + 100).map(c => ({
          list_id: list.id, phone: c.phone || null, name: c.name || null, email: c.email || null,
        }));
        const { error } = await supabase.from('marketing_contacts').insert(batch);
        if (error) throw error;
      }

      toast.success(`${contacts.length} contatos importados!`);
      setUploadDialogOpen(false);
      fetchContactLists();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao processar planilha");
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Computed ──────────────────────────────

  const filtered = customers.filter(c => {
    if (regionFilter !== "all" && c.region_type !== regionFilter) return false;
    if (rfmFilter !== "all" && c.rfm_segment !== rfmFilter) return false;
    if (dddFilter !== "all" && c.ddd !== dddFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
      return name.includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    const av = (a as any)[sortField] ?? 0;
    const bv = (b as any)[sortField] ?? 0;
    return sortDir === "desc" ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
  });

  const segments = customers.reduce((acc, c) => {
    const seg = c.rfm_segment || 'Outros';
    acc[seg] = (acc[seg] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const regionCounts = customers.reduce((acc, c) => {
    acc[c.region_type] = (acc[c.region_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const uniqueDdds = [...new Set(customers.map(c => c.ddd).filter(Boolean))].sort();
  const totalRevenue = customers.reduce((s, c) => s + c.total_spent, 0);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '-';

  // ─── Render ──────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Megaphone className="h-4 w-4" />
            </div>
            <h1 className="text-lg font-bold">Marketing</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>← Pedidos</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/chat')}>Chat</Button>
          </div>
        </div>
      </header>

      <div className="container py-4 space-y-4">
        <Tabs defaultValue="campaigns">
          <TabsList>
            <TabsTrigger value="campaigns" className="gap-1"><Send className="h-3.5 w-3.5" />Campanhas</TabsTrigger>
            <TabsTrigger value="customers" className="gap-1"><Users className="h-3.5 w-3.5" />Clientes RFM</TabsTrigger>
            <TabsTrigger value="templates" className="gap-1"><Megaphone className="h-3.5 w-3.5" />Templates Meta</TabsTrigger>
          </TabsList>

          {/* ── CAMPANHAS ── */}
          <TabsContent value="campaigns" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{campaigns.length} campanhas</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setUploadDialogOpen(true)} className="gap-1">
                  <Upload className="h-3.5 w-3.5" />Upload Excel
                </Button>
                <Button size="sm" onClick={() => { resetForm(); setIsCreating(true); }} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />Nova Campanha
                </Button>
              </div>
            </div>

            {/* Campaign List */}
            <div className="grid gap-3">
              {campaigns.map(c => {
                const steps = (c.content as any)?.steps || (c.whatsapp_template_params ? [c.whatsapp_template_params] : []);
                return (
                  <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedCampaign(c)}>
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-sm truncate">{c.name}</h3>
                            <Badge className={`text-[10px] ${STATUS_COLORS[c.status] || ''}`}>
                              {STATUS_LABELS[c.status] || c.status}
                            </Badge>
                          </div>
                          {c.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">{c.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            {Array.isArray(steps) && steps.length > 0 && (
                              <span className="flex items-center gap-1">
                                <Send className="h-3 w-3" />
                                {steps.length} etapa{steps.length > 1 ? 's' : ''}
                              </span>
                            )}
                            {c.channels?.map(ch => (
                              <Badge key={ch} variant="outline" className="text-[10px]">{ch}</Badge>
                            ))}
                            <span>{formatDate(c.created_at)}</span>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {c.status === 'draft' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); updateCampaignStatus(c.id, 'review'); }}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {c.status === 'review' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); updateCampaignStatus(c.id, 'approved'); }}>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); deleteCampaign(c.id); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {campaigns.length === 0 && (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhuma campanha criada ainda</p>
                    <Button size="sm" className="mt-3 gap-1" onClick={() => { resetForm(); setIsCreating(true); }}>
                      <Plus className="h-3.5 w-3.5" />Criar primeira campanha
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ── CLIENTES RFM ── */}
          <TabsContent value="customers" className="space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground">Total Clientes</p>
                  <p className="text-2xl font-bold">{customers.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground">Faturamento Total</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalRevenue)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground">🏪 Loja Física</p>
                  <p className="text-2xl font-bold">{regionCounts['local'] || 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground">🌐 Online</p>
                  <p className="text-2xl font-bold">{regionCounts['online'] || 0}</p>
                </CardContent>
              </Card>
            </div>

            {/* RFM Segment Pills */}
            <div className="flex flex-wrap gap-2">
              <Badge variant={rfmFilter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setRfmFilter("all")}>
                Todos ({customers.length})
              </Badge>
              {Object.entries(segments).sort((a, b) => b[1] - a[1]).map(([seg, count]) => {
                const Icon = RFM_SEGMENT_ICONS[seg] || Star;
                return (
                  <Badge key={seg} variant="outline" className={`cursor-pointer gap-1 ${rfmFilter === seg ? RFM_SEGMENT_COLORS[seg] || '' : ''}`} onClick={() => setRfmFilter(rfmFilter === seg ? "all" : seg)}>
                    <Icon className="h-3 w-3" />{seg} ({count})
                  </Badge>
                );
              })}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar por nome, telefone, email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 h-9" />
              </div>
              <Select value={regionFilter} onValueChange={setRegionFilter}>
                <SelectTrigger className="w-[160px] h-9"><MapPin className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="Região" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Regiões</SelectItem>
                  <SelectItem value="local">🏪 Loja Física (GV)</SelectItem>
                  <SelectItem value="online">🌐 Online</SelectItem>
                  <SelectItem value="unknown">❓ Indefinido</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dddFilter} onValueChange={setDddFilter}>
                <SelectTrigger className="w-[120px] h-9"><Phone className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="DDD" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos DDDs</SelectItem>
                  {uniqueDdds.map(ddd => (<SelectItem key={ddd} value={ddd!}>DDD {ddd}</SelectItem>))}
                </SelectContent>
              </Select>
              <div className="flex gap-1 ml-auto">
                <Button variant="outline" size="sm" onClick={handleSyncRfm} disabled={isSyncing} className="gap-1">
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />Recalcular RFM
                </Button>
                <Button variant="outline" size="sm" onClick={handleSyncSales} disabled={isSyncing} className="gap-1">
                  <Download className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />Sync Vendas
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {filtered.length} clientes encontrados
              {(regionFilter !== "all" || rfmFilter !== "all" || dddFilter !== "all" || searchQuery) && (
                <Button variant="link" className="text-xs p-0 h-auto ml-2" onClick={() => { setRegionFilter("all"); setRfmFilter("all"); setDddFilter("all"); setSearchQuery(""); }}>
                  <X className="h-3 w-3 mr-0.5" />Limpar filtros
                </Button>
              )}
            </p>

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
                    <TableHead className="text-center">R</TableHead>
                    <TableHead className="text-center">F</TableHead>
                    <TableHead className="text-center">M</TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('total_orders')}>
                      <div className="flex items-center justify-end gap-1">Pedidos<ArrowUpDown className="h-3 w-3" /></div>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('total_spent')}>
                      <div className="flex items-center justify-end gap-1">Total Gasto<ArrowUpDown className="h-3 w-3" /></div>
                    </TableHead>
                    <TableHead className="text-right">Última Compra</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8"><RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Nenhum cliente encontrado</TableCell></TableRow>
                  ) : filtered.slice(0, 200).map(c => (
                    <TableRow key={c.id} className="text-sm">
                      <TableCell className="font-medium">{c.first_name} {c.last_name}</TableCell>
                      <TableCell className="text-xs">
                        <div className="space-y-0.5">
                          {c.phone && <div className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{c.phone}</div>}
                          {c.email && <div className="flex items-center gap-1 text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</div>}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{REGION_LABELS[c.region_type] || c.region_type}</Badge></TableCell>
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
              {filtered.length > 200 && <p className="text-xs text-muted-foreground text-center py-2">Mostrando 200 de {filtered.length} resultados</p>}
            </ScrollArea>
          </TabsContent>

          {/* ── TEMPLATES META ── */}
          <TabsContent value="templates" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Megaphone className="h-4 w-4" />Templates Meta WhatsApp
                </CardTitle>
                <CardDescription className="text-xs">
                  Crie templates diretamente pelo sistema ou utilize templates já aprovados na Meta para disparos em massa.
                  Use variáveis como {"{{1}}"}, {"{{2}}"} para textos ambíguos que serão substituídos com dados do cliente.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetaTemplateCreator />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── CREATE CAMPAIGN DIALOG ── */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />Nova Campanha de Marketing
            </DialogTitle>
            {/* Step indicator */}
            <div className="flex items-center gap-2 pt-2">
              {(['briefing', 'strategy', 'configure'] as const).map((step, i) => (
                <div key={step} className="flex items-center gap-1.5">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    creationStep === step ? 'bg-primary text-primary-foreground' :
                    (['briefing', 'strategy', 'configure'].indexOf(creationStep) > i) ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>{i + 1}</div>
                  <span className={`text-xs ${creationStep === step ? 'font-semibold' : 'text-muted-foreground'}`}>
                    {step === 'briefing' ? 'Briefing' : step === 'strategy' ? 'Estratégia' : 'Configurar'}
                  </span>
                  {i < 2 && <ChevronDown className="h-3 w-3 text-muted-foreground -rotate-90" />}
                </div>
              ))}
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* ── STEP 1: BRIEFING ── */}
            {creationStep === 'briefing' && (
              <Card className="border-dashed border-primary/30 bg-primary/5">
                <CardContent className="pt-4 pb-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-sm">Briefing da Campanha</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Descreva o que você quer alcançar. A IA vai montar toda a estratégia: análise de público, captação de leads, sequência de comunicação, métricas e dicas.
                  </p>
                  <div className="space-y-2">
                    <Label className="text-xs">Objetivo da campanha *</Label>
                    <Textarea
                      placeholder="Ex: Divulgar live de lançamento da coleção de verão com foco em sandálias femininas. Queremos converter clientes inativos e fidelizar os novos."
                      value={campaignObjective}
                      onChange={e => setCampaignObjective(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Público-alvo (opcional)</Label>
                    <Input placeholder="Ex: Clientes fiéis da loja física + clientes online que compraram há mais de 3 meses" value={campaignAudience} onChange={e => setCampaignAudience(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Instruções adicionais (opcional)</Label>
                    <Textarea placeholder="Ex: Temos parceria com influenciadora @fulana, incluir menção. Usar tom descontraído. Campanha válida por 1 semana." value={campaignAiPrompt} onChange={e => setCampaignAiPrompt(e.target.value)} rows={2} />
                  </div>
                  <Button onClick={handleGenerateAI} disabled={isGeneratingAI} className="w-full gap-1">
                    <Brain className={`h-3.5 w-3.5 ${isGeneratingAI ? 'animate-pulse' : ''}`} />
                    {isGeneratingAI ? 'Gerando estratégia completa...' : '🚀 Gerar Estratégia com IA'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ── STEP 2: STRATEGY REVIEW ── */}
            {creationStep === 'strategy' && aiStrategy && (
              <div className="space-y-4">
                {/* Campaign Name */}
                <div className="space-y-2">
                  <Label className="text-xs">Nome da Campanha</Label>
                  <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} className="font-semibold" />
                </div>

                {/* Summary */}
                <Card>
                  <CardContent className="pt-3 pb-3 px-4">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1">📋 Resumo</h4>
                    <p className="text-sm">{aiStrategy.summary}</p>
                  </CardContent>
                </Card>

                {/* Target Analysis */}
                <Card>
                  <CardContent className="pt-3 pb-3 px-4">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1">🎯 Análise de Público</h4>
                    <p className="text-sm">{aiStrategy.target_analysis}</p>
                  </CardContent>
                </Card>

                {/* Lead Capture */}
                <Card className="border-blue-500/20 bg-blue-500/5">
                  <CardContent className="pt-3 pb-3 px-4 space-y-2">
                    <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">📣 Captação de Leads</h4>
                    <p className="text-sm">{aiStrategy.lead_capture.strategy}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {aiStrategy.lead_capture.channels.map(ch => (
                        <Badge key={ch} variant="outline" className="text-[10px]">{ch}</Badge>
                      ))}
                    </div>
                    <ul className="space-y-1">
                      {aiStrategy.lead_capture.tips.map((tip, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                          <span className="text-blue-500 shrink-0">💡</span>{tip}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                {/* Communication Steps */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <Send className="h-3.5 w-3.5" />
                    Sequência de Comunicação ({aiStrategy.communication_steps.length} etapas)
                  </h4>
                  {aiStrategy.communication_steps.map((step, idx) => (
                    <Card key={idx} className="border-border/50">
                      <CardContent className="pt-3 pb-2 px-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
                            {step.step_number}
                          </div>
                          <span className="font-semibold text-sm">{step.label}</span>
                          <Badge variant="outline" className="text-[10px] ml-auto">{step.timing}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground pl-8">{step.objective}</p>
                        <div className="flex gap-2 pl-8 flex-wrap">
                          <Badge variant="secondary" className="text-[10px]">Tom: {step.tone}</Badge>
                          {step.media_suggestion && (
                            <Badge variant="secondary" className="text-[10px]">Mídia: {step.media_suggestion}</Badge>
                          )}
                        </div>
                        <p className="text-xs pl-8 mt-1 text-muted-foreground italic">
                          💬 {step.content_suggestion}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Success Metrics */}
                <Card>
                  <CardContent className="pt-3 pb-3 px-4">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1">📊 Métricas de Sucesso</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {aiStrategy.success_metrics.map((m, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">{m}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Tips */}
                {aiStrategy.additional_tips.length > 0 && (
                  <Card>
                    <CardContent className="pt-3 pb-3 px-4">
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1">✨ Dicas da IA</h4>
                      <ul className="space-y-1">
                        {aiStrategy.additional_tips.map((tip, i) => (
                          <li key={i} className="text-xs text-muted-foreground">• {tip}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* ── STEP 3: CONFIGURE ── */}
            {creationStep === 'configure' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Nome da Campanha *</Label>
                  <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Lista de Contatos</Label>
                    <Select value={campaignListId} onValueChange={setCampaignListId}>
                      <SelectTrigger><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                      <SelectContent>
                        {contactLists.map(l => (
                          <SelectItem key={l.id} value={l.id}>{l.name} ({l.contact_count})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Número WhatsApp</Label>
                    <Select value={campaignNumberId} onValueChange={setCampaignNumberId}>
                      <SelectTrigger><SelectValue placeholder="Selecione um número" /></SelectTrigger>
                      <SelectContent>
                        {whatsappNumbers.map(n => (
                          <SelectItem key={n.id} value={n.id}>{n.label} ({n.phone_display})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Template selection per step */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold flex items-center gap-1">
                      <Send className="h-3.5 w-3.5" />
                      Escolher Templates ({campaignSteps.length} etapa{campaignSteps.length > 1 ? 's' : ''})
                    </Label>
                    <Button variant="outline" size="sm" onClick={addStep} className="gap-1">
                      <Plus className="h-3 w-3" />Etapa
                    </Button>
                  </div>

                  {campaignSteps.map((step, idx) => (
                    <Card key={step.id} className="border-border/50">
                      <CardContent className="pt-3 pb-2 px-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">{idx + 1}</div>
                            <Input className="h-7 text-xs font-semibold border-none shadow-none px-1 w-40" value={step.label} onChange={e => updateStep(step.id, { label: e.target.value })} />
                          </div>
                          {campaignSteps.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeStep(step.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        {step.content_suggestion && (
                          <p className="text-[10px] text-muted-foreground italic pl-8">💬 {step.content_suggestion}</p>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground">Template Meta</Label>
                            <Input className="h-8 text-xs" placeholder="nome_do_template" value={step.template_name} onChange={e => updateStep(step.id, { template_name: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground">
                              {idx === 0 ? 'Enviar imediatamente' : 'Delay (horas)'}
                            </Label>
                            {idx === 0 ? (
                              <Input className="h-8 text-xs" value="Imediatamente" disabled />
                            ) : (
                              <Input className="h-8 text-xs" type="number" min={1} placeholder="24" value={step.delay_hours} onChange={e => updateStep(step.id, { delay_hours: parseInt(e.target.value) || 0 })} />
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {creationStep === 'briefing' && (
              <>
                <Button variant="outline" onClick={() => setIsCreating(false)}>Cancelar</Button>
                <Button variant="ghost" onClick={() => setCreationStep('configure')} className="gap-1 text-xs">
                  Pular IA →
                </Button>
              </>
            )}
            {creationStep === 'strategy' && (
              <>
                <Button variant="outline" onClick={() => setCreationStep('briefing')}>← Voltar ao Briefing</Button>
                <Button variant="outline" onClick={() => { setAiStrategy(null); setCreationStep('briefing'); }} className="gap-1">
                  <RefreshCw className="h-3 w-3" />Regerar
                </Button>
                <Button onClick={() => setCreationStep('configure')} className="gap-1">
                  Aprovar Estratégia →
                </Button>
              </>
            )}
            {creationStep === 'configure' && (
              <>
                <Button variant="outline" onClick={() => aiStrategy ? setCreationStep('strategy') : setCreationStep('briefing')}>← Voltar</Button>
                <Button onClick={handleCreateCampaign} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />Criar Campanha
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CAMPAIGN DETAIL DIALOG ── */}
      <Dialog open={!!selectedCampaign} onOpenChange={() => setSelectedCampaign(null)}>
        <DialogContent className="max-w-lg">
          {selectedCampaign && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedCampaign.name}
                  <Badge className={`text-[10px] ${STATUS_COLORS[selectedCampaign.status] || ''}`}>
                    {STATUS_LABELS[selectedCampaign.status] || selectedCampaign.status}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {selectedCampaign.description && (
                  <p className="text-sm text-muted-foreground">{selectedCampaign.description}</p>
                )}
                {selectedCampaign.target_audience && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Público-alvo</Label>
                    <p className="text-sm">{selectedCampaign.target_audience}</p>
                  </div>
                )}

                {/* Steps */}
                {(() => {
                  const steps = (selectedCampaign.content as any)?.steps || [];
                  if (!Array.isArray(steps) || steps.length === 0) return null;
                  return (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Sequência de Mensagens</Label>
                      {steps.map((s: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{i + 1}</div>
                          <span className="font-medium">{s.label || `Etapa ${i + 1}`}</span>
                          <Badge variant="outline" className="text-[10px]">{s.template_name || '(sem template)'}</Badge>
                          {i > 0 && <span className="text-xs text-muted-foreground">+{s.delay_hours || 0}h</span>}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Stats */}
                {selectedCampaign.sent_count != null && (
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{selectedCampaign.total_recipients || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Destinatários</p>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{selectedCampaign.sent_count || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Enviadas</p>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{selectedCampaign.delivered_count || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Entregues</p>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{selectedCampaign.read_count || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Lidas</p>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                {selectedCampaign.status === 'draft' && (
                  <Button variant="outline" size="sm" onClick={() => { updateCampaignStatus(selectedCampaign.id, 'review'); setSelectedCampaign(null); }} className="gap-1">
                    <Eye className="h-3.5 w-3.5" />Enviar p/ Revisão
                  </Button>
                )}
                {selectedCampaign.status === 'review' && (
                  <Button size="sm" onClick={() => { updateCampaignStatus(selectedCampaign.id, 'approved'); setSelectedCampaign(null); }} className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />Aprovar Campanha
                  </Button>
                )}
                {selectedCampaign.status === 'approved' && (
                  <Button size="sm" className="gap-1 bg-primary hover:bg-primary/90">
                    <Send className="h-3.5 w-3.5" />Disparar Campanha
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── UPLOAD DIALOG ── */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />Upload de Planilha Excel
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Faça upload de uma planilha .xlsx com seus contatos. O sistema detecta automaticamente colunas de
              <strong> telefone</strong>, <strong>nome</strong> e <strong>email</strong>.
            </p>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm mb-2">Arraste ou clique para selecionar</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleExcelUpload}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Colunas aceitas: telefone/phone/whatsapp/celular, nome/name, email/e-mail
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
