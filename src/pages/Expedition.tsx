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
import { RefreshCw, Package, Truck, Loader2, CheckCircle2, AlertTriangle, Search, ScanBarcode, RotateCcw, Users, ClipboardList, PackageCheck, Receipt, Tag, ShieldCheck, FileBarChart, CalendarIcon, HeadphonesIcon } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ExpeditionOrdersList } from '@/components/expedition/ExpeditionOrdersList';
import { ExpeditionPickingList } from '@/components/expedition/ExpeditionPickingList';
import { ExpeditionPackingStation } from '@/components/expedition/ExpeditionPackingStation';
import { ExpeditionFreightQuote } from '@/components/expedition/ExpeditionFreightQuote';
import { ExpeditionDispatch } from '@/components/expedition/ExpeditionDispatch';
import { ExpeditionReturns } from '@/components/expedition/ExpeditionReturns';
import { SupportDashboard } from '@/components/expedition/SupportDashboard';

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

  useEffect(() => {
    fetchOrders();
    const channel = supabase
      .channel('expedition-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expedition_orders' }, () => fetchOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchOrders]);

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
    picking: orders.filter(o => o.expedition_status === 'picking' || o.expedition_status === 'picked').length,
    packed: orders.filter(o => o.expedition_status === 'packed' || o.expedition_status === 'packing').length,
    dispatched: orders.filter(o => o.expedition_status === 'dispatched').length,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Expedição</h1>
              <p className="text-xs text-muted-foreground">Gestão de envios</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <NavLink to="/events">CRM</NavLink>
            <NavLink to="/chat">Chat</NavLink>
            <NavLink to="/marketing">Marketing</NavLink>
            <Button onClick={syncOrders} disabled={isSyncing} variant="outline" className="gap-2">
              {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sincronizar Shopify
            </Button>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="border-b border-border/40 bg-card">
        <div className="container py-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <StatCard label="Total" value={stats.total} icon={<Package className="h-4 w-4" />} />
            <StatCard label="Aprovados" value={stats.approved} icon={<CheckCircle2 className="h-4 w-4 text-green-500" />} />
            <StatCard label="Pendentes" value={stats.pending} icon={<AlertTriangle className="h-4 w-4 text-yellow-500" />} />
            <StatCard label="Separando" value={stats.picking} icon={<ClipboardList className="h-4 w-4 text-blue-500" />} />
            <StatCard label="Embalados" value={stats.packed} icon={<PackageCheck className="h-4 w-4 text-purple-500" />} />
            <StatCard label="Despachados" value={stats.dispatched} icon={<Truck className="h-4 w-4 text-primary" />} />
          </div>
        </div>
      </div>

      {/* Step Navigation */}
      <div className="border-b border-border/40 bg-card/50">
        <div className="container py-2">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              const isActive = activeStep === step.id;
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold bg-background/20">
                    {i + 1}
                  </span>
                  <Icon className="h-4 w-4" />
                  <span className="hidden md:inline font-medium">{step.label}</span>
                </button>
              );
            })}
            {/* Support tab */}
            <button
              onClick={() => setActiveStep('support')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${
                activeStep === 'support'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <HeadphonesIcon className="h-4 w-4" />
              <span className="hidden md:inline font-medium">Suporte</span>
            </button>
            {/* Returns tab */}
            <button
              onClick={() => setActiveStep('returns')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-all ml-auto ${
                activeStep === 'returns'
                  ? 'bg-destructive text-destructive-foreground shadow-md'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden md:inline font-medium">Devoluções</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container py-4">
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

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-background border border-border/50">
      {icon}
      <div>
        <p className="text-lg font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
