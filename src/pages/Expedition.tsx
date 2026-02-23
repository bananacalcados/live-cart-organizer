import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { RefreshCw, Package, Truck, Loader2, CheckCircle2, AlertTriangle, Search, ScanBarcode, RotateCcw, Users, ClipboardList, PackageCheck, Receipt, Tag, ShieldCheck, FileBarChart, CalendarIcon, HeadphonesIcon, MessageCircle, Clock, SearchCheck } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ExpeditionOrdersList } from '@/components/expedition/ExpeditionOrdersList';
import { ExpeditionPickingList } from '@/components/expedition/ExpeditionPickingList';
import { ExpeditionPackingStation } from '@/components/expedition/ExpeditionPackingStation';
import { ExpeditionFreightQuote } from '@/components/expedition/ExpeditionFreightQuote';
import { ExpeditionDispatch } from '@/components/expedition/ExpeditionDispatch';
import { ExpeditionReturns } from '@/components/expedition/ExpeditionReturns';
import { SupportDashboard } from '@/components/expedition/SupportDashboard';
import { ExpeditionWhatsApp } from '@/components/expedition/ExpeditionWhatsApp';

const STEPS = [
  { id: 'orders', label: 'Pedidos', icon: Package, description: 'Sincronizar e visualizar' },
  { id: 'grouping', label: 'Agrupamento', icon: Users, description: 'Mesmo cliente' },
  { id: 'picking', label: 'Separação', icon: ClipboardList, description: 'Lista de produtos' },
  { id: 'checking', label: 'Conferência', icon: CheckCircle2, description: 'Qtd separada' },
  { id: 'packing', label: 'Bipagem', icon: ScanBarcode, description: 'Código de barras' },
  { id: 'freight', label: 'Frete', icon: Truck, description: 'Cotação' },
  { id: 'invoice', label: 'NF-e', icon: Receipt, description: 'Nota fiscal' },
  { id: 'labels', label: 'Etiquetas', icon: Tag, description: 'Envio + interna' },
  { id: 'dispatch', label: 'Expedição', icon: ShieldCheck, description: 'Conferência final' },
  { id: 'manifest', label: 'Romaneio', icon: FileBarChart, description: 'Por transportadora' },
];

export default function Expedition() {
  const [activeStep, setActiveStep] = useState('orders');
  const [isSyncing, setIsSyncing] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [openSupportCount, setOpenSupportCount] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyRan, setVerifyRan] = useState(false);

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('expedition_orders')
        .select('*, expedition_order_items(*)')
        .order('shopify_created_at', { ascending: false });

      if (dateFrom) {
        query = query.gte('shopify_created_at', format(dateFrom, 'yyyy-MM-dd'));
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setDate(endDate.getDate() + 1);
        query = query.lt('shopify_created_at', format(endDate, 'yyyy-MM-dd'));
      }

      const { data, error } = await query;
      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching expedition orders:', error);
    } finally {
      setIsLoading(false);
    }
  }, [dateFrom, dateTo]);

  // Fetch open support tickets count
  const fetchSupportCount = useCallback(async () => {
    const { count } = await supabase
      .from('support_tickets')
      .select('*', { count: 'exact', head: true })
      .in('status', ['new', 'in_progress']);
    setOpenSupportCount(count || 0);
  }, []);

  // Auto-verify shipped orders on load (batch processing)
  const verifyShippedOrders = useCallback(async () => {
    setIsVerifying(true);
    let totalChecked = 0;
    let totalUpdated = 0;
    const allResults: any[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    try {
      while (hasMore) {
        const { data, error } = await supabase.functions.invoke('expedition-verify-shipped', {
          body: { cursor },
        });
        if (error) throw error;

        totalChecked += data?.checked || 0;
        totalUpdated += data?.updated || 0;
        if (data?.results) allResults.push(...data.results);
        hasMore = data?.hasMore || false;
        cursor = data?.cursor || null;

        // Small delay between batches
        if (hasMore) await new Promise(r => setTimeout(r, 500));
      }

      if (totalUpdated > 0) {
        toast.success(`${totalUpdated} pedido(s) marcado(s) como enviado(s)!`, {
          description: allResults.map((r: any) => `${r.order_name} (${r.source})`).join(', '),
        });
        fetchOrders();
      } else if (totalChecked > 0) {
        toast.info(`${totalChecked} pedidos verificados, nenhum envio externo encontrado.`);
      }
    } catch (error: any) {
      console.error('Verify shipped error:', error);
      toast.error(`Erro na verificação: ${error.message}`);
    } finally {
      setIsVerifying(false);
    }
  }, [fetchOrders]);

  useEffect(() => {
    fetchOrders();
    fetchSupportCount();
    // Auto-verify on first load
    if (!verifyRan) {
      setVerifyRan(true);
      verifyShippedOrders();
    }
    const channel = supabase
      .channel('expedition-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expedition_orders' }, () => fetchOrders())
      .subscribe();
    const supportChannel = supabase
      .channel('expedition-support-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => fetchSupportCount())
      .subscribe();
    return () => { supabase.removeChannel(channel); supabase.removeChannel(supportChannel); };
  }, [fetchOrders, fetchSupportCount, verifyRan, verifyShippedOrders]);

  const syncOrders = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('expedition-sync-orders');
      if (error) throw error;
      if (data?.success) {
        toast.success(`${data.orders_synced} pedidos sincronizados!`);
        fetchOrders();
      } else {
        throw new Error(data?.error || 'Sync failed');
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      toast.error(`Erro na sincronização: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-navigate to next step
  const goToNextStep = useCallback(() => {
    const currentIndex = STEPS.findIndex(s => s.id === activeStep);
    if (currentIndex >= 0 && currentIndex < STEPS.length - 1) {
      const nextStep = STEPS[currentIndex + 1].id;
      setActiveStep(nextStep);
      toast.success(`Avançando para: ${STEPS[currentIndex + 1].label}`);
    }
  }, [activeStep]);

  const clearDateFilter = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const approvedOrders = orders.filter(o => o.financial_status === 'paid' || o.financial_status === 'partially_paid');
  const pendingOrders = orders.filter(o => o.financial_status !== 'paid' && o.financial_status !== 'partially_paid');

  const stats = {
    total: orders.length,
    approved: approvedOrders.length,
    pending: pendingOrders.length,
    awaiting: orders.filter(o => o.expedition_status === 'awaiting_stock').length,
    picking: orders.filter(o => o.expedition_status === 'picking' || o.expedition_status === 'picked').length,
    packed: orders.filter(o => o.expedition_status === 'packed' || o.expedition_status === 'packing').length,
    dispatched: orders.filter(o => o.expedition_status === 'dispatched').length,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-14 md:h-16 items-center justify-between px-3 md:px-6">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Truck className="h-4 w-4 md:h-5 md:w-5" />
            </div>
            <div>
              <h1 className="text-base md:text-lg font-bold text-foreground">Expedição</h1>
              <p className="text-[10px] md:text-xs text-muted-foreground hidden sm:block">Gestão de envios</p>
            </div>
          </div>
          <div className="flex items-center gap-1 md:gap-2">
            <ThemeToggle />
            <div className="hidden md:flex items-center gap-2">
              <NavLink to="/">Início</NavLink>
              <NavLink to="/chat">Chat</NavLink>
              <NavLink to="/marketing">Marketing</NavLink>
            </div>
            <Button onClick={verifyShippedOrders} disabled={isVerifying} variant="outline" size="sm" className="gap-1 md:gap-2 text-xs md:text-sm">
              {isVerifying ? <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" /> : <SearchCheck className="h-3 w-3 md:h-4 md:w-4" />}
              <span className="hidden sm:inline">Verificar Envios</span>
            </Button>
            <Button onClick={syncOrders} disabled={isSyncing} variant="outline" size="sm" className="gap-1 md:gap-2 text-xs md:text-sm">
              {isSyncing ? <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" /> : <RefreshCw className="h-3 w-3 md:h-4 md:w-4" />}
              <span className="hidden sm:inline">Sincronizar</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="border-b border-border/40 bg-card">
        <div className="container py-2 md:py-3 px-3 md:px-6">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5 md:gap-3">
            <StatCard label="Total" value={stats.total} icon={<Package className="h-3 w-3 md:h-4 md:w-4" />} />
            <StatCard label="Aprovados" value={stats.approved} icon={<CheckCircle2 className="h-3 w-3 md:h-4 md:w-4 text-green-500" />} />
            <StatCard label="Pendentes" value={stats.pending} icon={<AlertTriangle className="h-3 w-3 md:h-4 md:w-4 text-orange-500" />} />
            <StatCard label="Aguardando" value={stats.awaiting} icon={<Clock className="h-3 w-3 md:h-4 md:w-4 text-amber-500" />} highlight={stats.awaiting > 0} />
            <StatCard label="Separando" value={stats.picking} icon={<ClipboardList className="h-3 w-3 md:h-4 md:w-4 text-blue-500" />} />
            <StatCard label="Embalados" value={stats.packed} icon={<PackageCheck className="h-3 w-3 md:h-4 md:w-4 text-purple-500" />} />
            <StatCard label="Despachados" value={stats.dispatched} icon={<Truck className="h-3 w-3 md:h-4 md:w-4 text-primary" />} />
            <StatCard label="Suportes" value={openSupportCount} icon={<HeadphonesIcon className="h-3 w-3 md:h-4 md:w-4 text-destructive" />} highlight={openSupportCount > 0} />
          </div>
        </div>
      </div>

      {/* Step Navigation */}
      <div className="border-b border-border/40 bg-card/50">
        <div className="container py-1.5 md:py-2 px-3 md:px-6">
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              const isActive = activeStep === step.id;
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 rounded-lg text-xs md:text-sm whitespace-nowrap transition-all shrink-0 ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full text-[10px] md:text-xs font-bold bg-background/20">
                    {i + 1}
                  </span>
                  <Icon className="h-3 w-3 md:h-4 md:w-4" />
                  <span className="hidden md:inline font-medium">{step.label}</span>
                </button>
              );
            })}
            <button
              onClick={() => setActiveStep('whatsapp')}
              className={`flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 rounded-lg text-xs md:text-sm whitespace-nowrap transition-all shrink-0 ${
                activeStep === 'whatsapp'
                  ? 'bg-[#008069] text-white shadow-md'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <MessageCircle className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden md:inline font-medium">WhatsApp</span>
            </button>
            <button
              onClick={() => setActiveStep('support')}
              className={`flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 rounded-lg text-xs md:text-sm whitespace-nowrap transition-all shrink-0 ${
                activeStep === 'support'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <HeadphonesIcon className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden md:inline font-medium">Suporte</span>
            </button>
            <button
              onClick={() => setActiveStep('returns')}
              className={`flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 rounded-lg text-xs md:text-sm whitespace-nowrap transition-all shrink-0 ml-auto ${
                activeStep === 'returns'
                  ? 'bg-destructive text-destructive-foreground shadow-md'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <RotateCcw className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden md:inline font-medium">Devoluções</span>
            </button>
          </div>
        </div>
      </div>

      <div className="container py-3 md:py-4 px-3 md:px-6">
        {/* Search + Date Filter */}
        <div className="mb-4 flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por pedido, cliente, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("gap-2 text-sm", dateFrom && "text-foreground")}>
                  <CalendarIcon className="h-4 w-4" />
                  {dateFrom ? format(dateFrom, 'dd/MM/yyyy') : 'De'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={setDateFrom}
                  locale={pt}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("gap-2 text-sm", dateTo && "text-foreground")}>
                  <CalendarIcon className="h-4 w-4" />
                  {dateTo ? format(dateTo, 'dd/MM/yyyy') : 'Até'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={setDateTo}
                  locale={pt}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={clearDateFilter} className="text-xs">
                Limpar
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {activeStep === 'whatsapp' && <ExpeditionWhatsApp />}
            {activeStep === 'support' && <SupportDashboard />}
            {(activeStep === 'orders' || activeStep === 'grouping') && (
              <ExpeditionOrdersList
                orders={orders}
                searchTerm={searchTerm}
                showGrouping={activeStep === 'grouping'}
                onRefresh={fetchOrders}
              />
            )}
            {(activeStep === 'picking' || activeStep === 'checking') && (
              <ExpeditionPickingList
                orders={approvedOrders}
                searchTerm={searchTerm}
                showChecking={activeStep === 'checking'}
                onRefresh={fetchOrders}
              />
            )}
            {activeStep === 'packing' && (
              <ExpeditionPackingStation
                orders={approvedOrders}
                searchTerm={searchTerm}
                onRefresh={fetchOrders}
              />
            )}
            {(activeStep === 'freight' || activeStep === 'invoice' || activeStep === 'labels') && (
              <ExpeditionFreightQuote
                orders={approvedOrders}
                searchTerm={searchTerm}
                activeTab={activeStep}
                onRefresh={fetchOrders}
              />
            )}
            {(activeStep === 'dispatch' || activeStep === 'manifest') && (
              <ExpeditionDispatch
                orders={orders}
                searchTerm={searchTerm}
                showManifest={activeStep === 'manifest'}
                onRefresh={fetchOrders}
              />
            )}
            {activeStep === 'returns' && (
              <ExpeditionReturns onRefresh={fetchOrders} />
            )}

            {/* Next Step Button (show on workflow steps, not support/returns) */}
            {STEPS.some(s => s.id === activeStep) && activeStep !== 'manifest' && (
              <div className="flex justify-end mt-6">
                <Button onClick={goToNextStep} className="gap-2">
                  Próxima Etapa →
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, highlight }: { label: string; value: number; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 md:gap-2 p-1.5 md:p-2 rounded-lg bg-background border ${highlight ? 'border-destructive/50 bg-destructive/5 animate-pulse' : 'border-border/50'}`}>
      {icon}
      <div className="min-w-0">
        <p className={`text-sm md:text-lg font-bold ${highlight ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
        <p className="text-[9px] md:text-xs text-muted-foreground truncate">{label}</p>
      </div>
    </div>
  );
}
