import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, Search, RefreshCw, Upload, Download, Filter, BarChart3,
  MapPin, Phone, Mail, ShoppingBag, Crown, AlertTriangle, Clock,
  Heart, Star, Zap, ChevronDown, Plus, ArrowUpDown, Megaphone,
  FileSpreadsheet, X, TrendingUp, Send, Brain, Trash2,
  Eye, CheckCircle2, MessageSquare, Instagram, Store, Globe, Sparkles,
  Target, Calendar, ListChecks
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
      const { data, error } = await supabase.from('zoppy_customers').select('*').order('total_spent', { ascending: false }).limit(1000);
      if (error) throw error;
      setCustomers((data || []) as ZoppyCustomer[]);
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

  useEffect(() => { fetchCustomers(); fetchCampaigns(); }, [fetchCustomers, fetchCampaigns]);

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
      if (!phoneCol && !emailCol) { toast.error("Nenhuma coluna de telefone ou email"); return; }
      const contacts = rows.map(row => ({
        phone: phoneCol ? String(row[phoneCol] || '').replace(/\D/g, '') : null,
        name: nameCol ? String(row[nameCol] || '') : null,
        email: emailCol ? String(row[emailCol] || '') : null,
      })).filter(c => c.phone || c.email);
      const { data: list, error: listError } = await supabase.from('marketing_contact_lists').insert({
        name: `Upload: ${file.name} (${new Date().toLocaleDateString('pt-BR')})`,
        source: 'excel_upload', contact_count: contacts.length,
        description: `${contacts.length} contatos importados de ${file.name}`,
      }).select().single();
      if (listError) throw listError;
      for (let i = 0; i < contacts.length; i += 100) {
        const batch = contacts.slice(i, i + 100).map(c => ({ list_id: list.id, phone: c.phone || null, name: c.name || null, email: c.email || null }));
        const { error } = await supabase.from('marketing_contacts').insert(batch);
        if (error) throw error;
      }
      toast.success(`${contacts.length} contatos importados!`);
      setUploadDialogOpen(false);
    } catch (err) { console.error(err); toast.error("Erro ao processar planilha"); }
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>← Pedidos</Button>
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
              {filtered.length} clientes
              {(regionFilter !== "all" || rfmFilter !== "all" || dddFilter !== "all" || searchQuery) && (
                <Button variant="link" className="text-xs p-0 h-auto ml-2" onClick={() => { setRegionFilter("all"); setRfmFilter("all"); setDddFilter("all"); setSearchQuery(""); }}>
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
                    <TableRow key={c.id} className="text-sm">
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
        </Tabs>
      </div>


      {/* Campaign Detail */}
      <CampaignDetail
        campaign={selectedCampaign}
        onClose={() => setSelectedCampaign(null)}
        onStatusChange={updateCampaignStatus}
      />

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />Upload de Planilha Excel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Faça upload de uma planilha .xlsx com seus contatos.
            </p>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
