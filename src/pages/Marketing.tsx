import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, Search, RefreshCw, Upload, Download, Filter, BarChart3,
  MapPin, Phone, Mail, ShoppingBag, Crown, AlertTriangle, Clock,
  Heart, Star, Zap, ChevronDown, Plus, ArrowUpDown, Megaphone,
  FileSpreadsheet, X, TrendingUp, Send, Brain, Trash2,
  Eye, CheckCircle2, MessageSquare, Instagram, Store, Globe, Sparkles,
  Target, Calendar, ListChecks, Loader2, CheckCircle, XCircle, Link, Copy, ExternalLink, Gift
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rfmFileInputRef = useRef<HTMLInputElement>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ticketMin, setTicketMin] = useState("");
  const [ticketMax, setTicketMax] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<ZoppyCustomer | null>(null);
  const [whatsAppMessage, setWhatsAppMessage] = useState("");

  // ─── Fetch data ──────────────────────────────

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
        if (allCustomers.length >= 25000) keepFetching = false; // safety cap
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

  useEffect(() => { fetchCustomers(); fetchCampaigns(); fetchLandingPages(); fetchLeads(); }, [fetchCustomers, fetchCampaigns, fetchLandingPages, fetchLeads]);

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

  const handleRfmExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadTarget('rfm');
    setUploadDialogOpen(true);
    setUploadStatus({ stage: 'reading', progress: 10, detail: 'Lendo arquivo...' });
    try {
      const xlsxModule = await import('xlsx');
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
      const xlsxModule = await import('xlsx');
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

  const filtered = customers.filter(c => {
    if (regionFilter !== "all" && c.region_type !== regionFilter) return false;
    if (rfmFilter !== "all" && c.rfm_segment !== rfmFilter) return false;
    if (dddFilter !== "all" && c.ddd !== dddFilter) return false;
    if (dateFrom && c.last_purchase_at && c.last_purchase_at < dateFrom) return false;
    if (dateTo && c.last_purchase_at && c.last_purchase_at > dateTo + 'T23:59:59') return false;
    if ((dateFrom || dateTo) && !c.last_purchase_at) return false;
    if (ticketMin && c.avg_ticket < parseFloat(ticketMin)) return false;
    if (ticketMax && c.avg_ticket > parseFloat(ticketMax)) return false;
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

  const regionCounts = customers.reduce((acc, c) => { acc[c.region_type] = (acc[c.region_type] || 0) + 1; return acc; }, {} as Record<string, number>);
  const uniqueDdds = [...new Set(customers.map(c => c.ddd).filter(Boolean))].sort();
  const totalRevenue = customers.reduce((s, c) => s + c.total_spent, 0);
  const toggleSort = (field: string) => { if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortField(field); setSortDir("desc"); } };
  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '-';

  // ─── Render ──────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Megaphone className="h-4 w-4" />
            </div>
            <h1 className="text-lg font-bold">Marketing 360°</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1">← Início</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/chat')}>Chat</Button>
          </div>
        </div>
      </header>

      <div className="container py-4 space-y-4">
        <Tabs defaultValue="campaigns">
          <TabsList>
            <TabsTrigger value="campaigns" className="gap-1"><Target className="h-3.5 w-3.5" />Campanhas 360°</TabsTrigger>
            <TabsTrigger value="customers" className="gap-1"><Users className="h-3.5 w-3.5" />Clientes RFM</TabsTrigger>
            <TabsTrigger value="templates" className="gap-1"><Megaphone className="h-3.5 w-3.5" />Templates Meta</TabsTrigger>
            <TabsTrigger value="disparos" className="gap-1"><Send className="h-3.5 w-3.5" />Disparos</TabsTrigger>
            <TabsTrigger value="automations" className="gap-1"><Zap className="h-3.5 w-3.5" />Automações</TabsTrigger>
            <TabsTrigger value="sectors" className="gap-1"><Store className="h-3.5 w-3.5" />Setores</TabsTrigger>
            <TabsTrigger value="landing_pages" className="gap-1"><Link className="h-3.5 w-3.5" />Landing Pages</TabsTrigger>
            <TabsTrigger value="leads" className="gap-1"><FileSpreadsheet className="h-3.5 w-3.5" />Leads</TabsTrigger>
            <TabsTrigger value="groups_vip" className="gap-1"><Crown className="h-3.5 w-3.5" />Grupos VIP</TabsTrigger>
            <TabsTrigger value="prizes" className="gap-1"><Gift className="h-3.5 w-3.5" />Prêmios</TabsTrigger>
            <TabsTrigger value="live_commerce" className="gap-1"><Globe className="h-3.5 w-3.5" />Live Commerce</TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1"><CalendarIcon className="h-3.5 w-3.5" />Calendário</TabsTrigger>
          </TabsList>

          {/* ── CAMPANHAS ── */}
          <TabsContent value="campaigns" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{campaigns.length} campanhas</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setUploadDialogOpen(true)} className="gap-1">
                  <Upload className="h-3.5 w-3.5" />Upload Excel
                </Button>
                <Button size="sm" onClick={() => navigate('/marketing/new')} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />Nova Campanha 360°
                </Button>
              </div>
            </div>

            <div className="grid gap-3">
              {campaigns.map(c => (
                <CampaignCardExpanded
                  key={c.id}
                  campaign={c}
                  onOpenDetail={() => setSelectedCampaign(c)}
                  onDelete={() => deleteCampaign(c.id)}
                />
              ))}
              {campaigns.length === 0 && (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <Target className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhuma campanha criada ainda</p>
                    <p className="text-xs mt-1">Crie uma campanha 360° com estratégia multicanal gerada por IA</p>
                    <Button size="sm" className="mt-3 gap-1" onClick={() => navigate('/marketing/new')}>
                      <Plus className="h-3.5 w-3.5" />Criar primeira campanha
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ── CLIENTES RFM ── */}
          <TabsContent value="customers" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground">Total Clientes</p><p className="text-2xl font-bold">{customers.length}</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground">Faturamento Total</p><p className="text-2xl font-bold">{formatCurrency(totalRevenue)}</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground">🏪 Loja Física</p><p className="text-2xl font-bold">{regionCounts['local'] || 0}</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground">🌐 Online</p><p className="text-2xl font-bold">{regionCounts['online'] || 0}</p></CardContent></Card>
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

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 h-9" />
              </div>
              <Select value={regionFilter} onValueChange={setRegionFilter}>
                <SelectTrigger className="w-[160px] h-9"><MapPin className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Regiões</SelectItem>
                  <SelectItem value="local">🏪 Loja Física</SelectItem>
                  <SelectItem value="online">🌐 Online</SelectItem>
                  <SelectItem value="unknown">❓ Indefinido</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dddFilter} onValueChange={setDddFilter}>
                <SelectTrigger className="w-[120px] h-9"><Phone className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos DDDs</SelectItem>
                  {uniqueDdds.map(ddd => (<SelectItem key={ddd} value={ddd!}>DDD {ddd}</SelectItem>))}
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px] h-9" placeholder="De" title="Compras a partir de" />
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px] h-9" placeholder="Até" title="Compras até" />
              <Input type="number" value={ticketMin} onChange={e => setTicketMin(e.target.value)} className="w-[120px] h-9" placeholder="Ticket mín" title="Ticket médio mínimo" />
              <Input type="number" value={ticketMax} onChange={e => setTicketMax(e.target.value)} className="w-[120px] h-9" placeholder="Ticket máx" title="Ticket médio máximo" />
              <div className="flex gap-1 ml-auto">
                <Button variant="outline" size="sm" className="gap-1 relative overflow-hidden">
                  <Upload className="h-3.5 w-3.5" />Upload Excel
                  <input ref={rfmFileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleRfmExcelUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleSyncRfm} disabled={isSyncing} className="gap-1">
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />Recalcular RFM
                </Button>
                <Button variant="outline" size="sm" onClick={handleSyncSales} disabled={isSyncing} className="gap-1">
                  <Download className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />Sync Vendas
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {filtered.length} clientes
              {(regionFilter !== "all" || rfmFilter !== "all" || dddFilter !== "all" || searchQuery || dateFrom || dateTo || ticketMin || ticketMax) && (
                <Button variant="link" className="text-xs p-0 h-auto ml-2" onClick={() => { setRegionFilter("all"); setRfmFilter("all"); setDddFilter("all"); setSearchQuery(""); setDateFrom(""); setDateTo(""); setTicketMin(""); setTicketMax(""); }}>
                  <X className="h-3 w-3 mr-0.5" />Limpar
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
                    <TableRow key={c.id} className="text-sm cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCustomer(c)}>
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
                    <Button variant="outline" size="sm" onClick={fetchLeads} className="gap-1">
                      <RefreshCw className="h-3.5 w-3.5" />Atualizar
                    </Button>
                  </div>

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
                                <TableHead className="w-10"></TableHead>
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
                                    {lead.phone && (
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver chat WhatsApp"
                                        onClick={() => { setLeadChatPhone(lead.phone); setLeadChatName(lead.name || ''); }}>
                                        <MessageSquare className="h-4 w-4 text-stage-paid" />
                                      </Button>
                                    )}
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
      <Dialog open={!!selectedCustomer} onOpenChange={(open) => { if (!open) { setSelectedCustomer(null); setWhatsAppMessage(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {selectedCustomer?.first_name} {selectedCustomer?.last_name}
            </DialogTitle>
          </DialogHeader>
          {selectedCustomer && (
            <div className="space-y-4">
              {/* RFM Badge */}
              {selectedCustomer.rfm_segment && (
                <Badge className={`${RFM_SEGMENT_COLORS[selectedCustomer.rfm_segment] || ''}`}>
                  {selectedCustomer.rfm_segment}
                </Badge>
              )}

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
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ShoppingBag className="h-4 w-4" />{selectedCustomer.total_orders} pedidos
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
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm font-medium">Entrar em contato</p>
                  <Input
                    placeholder="Mensagem para o cliente..."
                    value={whatsAppMessage}
                    onChange={e => setWhatsAppMessage(e.target.value)}
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
    </div>
  );
}
