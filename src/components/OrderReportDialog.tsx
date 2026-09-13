import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { FileDown, Filter, AlertTriangle, Users, Package, X, Search, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";
import { DbOrder } from "@/types/database";

interface OrderReportDialogProps {
  orders: DbOrder[];
  eventId?: string | null;
}

type PaymentFilter = "pago" | "nao_pago" | "ambos";

type LinhaGrade = {
  produto_nome: string;
  cor: string;
  total_vendido: number;
  grades: number;
  status: "lucro" | "empate" | "prejuizo" | "sem_grade";
  vendidos: { tam: string; qtd: number; estouro: boolean }[];
  vender_mais: { tam: string; qtd: number }[];
  tamanhos_estouro: string[];
  grade_cheia: boolean;
  tamanhos_fora_da_grade: { tam: string; qtd: number }[];
};

const PAYMENT_OPTIONS: { id: PaymentFilter; label: string }[] = [
  { id: "pago", label: "PAGOS" },
  { id: "nao_pago", label: "NÃO PAGOS" },
  { id: "ambos", label: "AMBOS" },
];

// Colunas (stages) considerados "pagos"/pós-pagamento que podem entrar no relatório
const REPORT_STAGES: { id: string; label: string }[] = [
  { id: "paid", label: "Pago" },
  { id: "awaiting_shipping", label: "Aguardando Envio" },
  { id: "awaiting_mototaxi", label: "Aguardando Mototaxista" },
  { id: "awaiting_pickup", label: "Aguardando Retirada" },
  { id: "shipped", label: "Enviado" },
  { id: "completed", label: "Concluído" },
];
const ALL_REPORT_STAGE_IDS = REPORT_STAGES.map((s) => s.id);

const STATUS_STYLES: Record<LinhaGrade["status"], { label: string; pill: string; row?: string }> = {
  lucro: { label: "Lucro", pill: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  empate: { label: "Empate", pill: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  prejuizo: {
    label: "Prejuízo",
    pill: "bg-destructive/15 text-destructive border-destructive/30",
    row: "bg-destructive/5",
  },
  sem_grade: { label: "Fora da grade", pill: "bg-muted text-muted-foreground border-border" },
};

interface ReportProduct {
  id: string;
  title: string;
  variant: string;
  quantity: number;
  ordersIds: string[];
  customers: {
    instagram: string;
    whatsapp?: string;
    orderCount: number;
  }[];
}

export function OrderReportDialog({ orders, eventId }: OrderReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [filterDuplicates, setFilterDuplicates] = useState(false);
  const [filterWithGift, setFilterWithGift] = useState(false);
  const [filterFreeShipping, setFilterFreeShipping] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  // Unificar produtos idênticos (mesmo título + variante) em 1 linha
  const [unifyProducts, setUnifyProducts] = useState(true);
  // Colunas selecionadas para o relatório (todas as pós-pagamento por padrão)
  const [selectedStages, setSelectedStages] = useState<string[]>(ALL_REPORT_STAGE_IDS);
  // Filtro de pagamento (controla painel + exportação)
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("pago");

  const [gradeRows, setGradeRows] = useState<LinhaGrade[]>([]);
  const [loadingGrade, setLoadingGrade] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const toggleStage = (id: string) =>
    setSelectedStages((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  const loadGrade = useCallback(async () => {
    if (!eventId) return;
    setLoadingGrade(true);
    setGradeError(null);
    const { data, error } = await (supabase as any).rpc("get_relatorio_grade_live", {
      p_live_id: eventId,
      p_status: paymentFilter,
    });
    if (error) {
      setGradeError(error.message);
      setGradeRows([]);
    } else {
      setGradeRows((data as LinhaGrade[]) ?? []);
      setUpdatedAt(new Date());
    }
    setLoadingGrade(false);
  }, [eventId, paymentFilter]);

  useEffect(() => {
    if (!open || !eventId) return;
    loadGrade();
  }, [open, eventId, loadGrade]);

  // Tempo real: recarrega a RPC com debounce a cada mudança nos pedidos da live
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !eventId) return;
    const channel = supabase
      .channel(`grade-report-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `event_id=eq.${eventId}` },
        () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => loadGrade(), 500);
        },
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [open, eventId, loadGrade]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    const q = customerQuery.trim().toLowerCase().replace(/^@/, "");
    return orders.filter(order => {
      if (order.merged_into_order_id) {
        return false;
      }
      const paid = isOrderMarkedPaid(order);
      if (paymentFilter === "pago" && !paid) return false;
      if (paymentFilter === "nao_pago" && paid) return false;
      // As colunas (stages) só restringem o recorte de pedidos pagos
      if (paymentFilter === "pago" && !selectedStages.includes(order.stage ?? "")) {
        return false;
      }
      if (filterWithGift && !order.has_gift) {
        return false;
      }
      if (filterFreeShipping && !order.free_shipping) {
        return false;
      }
      if (q) {
        const handle = (order.customer?.instagram_handle || "").toLowerCase();
        const whats = (order.customer?.whatsapp || "").replace(/\D/g, "");
        if (!handle.includes(q) && !(q.replace(/\D/g, "") && whats.includes(q.replace(/\D/g, "")))) {
          return false;
        }
      }
      return true;
    });
  }, [orders, selectedStages, filterWithGift, filterFreeShipping, customerQuery, paymentFilter]);


  // Find customers with multiple orders
  const customerOrderCounts = useMemo(() => {
    const counts: Record<string, { instagram: string; whatsapp?: string; orderIds: string[] }> = {};
    
    for (const order of filteredOrders) {
      const key = order.customer_id;
      if (!counts[key]) {
        counts[key] = {
          instagram: order.customer?.instagram_handle || '',
          whatsapp: order.customer?.whatsapp,
          orderIds: [],
        };
      }
      counts[key].orderIds.push(order.id);
    }
    
    return counts;
  }, [filteredOrders]);

  // Get duplicate customers
  const duplicateCustomers = useMemo(() => {
    return Object.entries(customerOrderCounts)
      .filter(([_, data]) => data.orderIds.length > 1)
      .map(([id, data]) => ({ id, ...data }));
  }, [customerOrderCounts]);

  // Build product report
  const productReport = useMemo(() => {
    const products: Record<string, ReportProduct> = {};
    
    const ordersToProcess = filterDuplicates
      ? filteredOrders.filter(o => duplicateCustomers.some(dc => dc.orderIds.includes(o.id)))
      : filteredOrders;
    
    for (const order of ordersToProcess) {
      for (const product of order.products) {
        // Ao unificar, agrupa por título + variante (mesmo que o id difira entre pedidos)
        const key = unifyProducts
          ? `${product.title}||${product.variant}`
          : `${product.id}-${product.variant}`;
        
        if (!products[key]) {
          products[key] = {
            id: product.id,
            title: product.title,
            variant: product.variant,
            quantity: 0,
            ordersIds: [],
            customers: [],
          };
        }
        
        products[key].quantity += product.quantity;
        products[key].ordersIds.push(order.id);
        
        // Add customer info
        const customerKey = order.customer_id;
        const existingCustomer = products[key].customers.find(c => c.instagram === order.customer?.instagram_handle);
        if (!existingCustomer) {
          products[key].customers.push({
            instagram: order.customer?.instagram_handle || '',
            whatsapp: order.customer?.whatsapp,
            orderCount: customerOrderCounts[customerKey]?.orderIds.length || 1,
          });
        }
      }
    }
    
    const list = Object.values(products);
    // Ao unificar: ordena por nome do produto e depois variante, mantendo
    // produtos "pais" (mesmo título) próximos e tamanhos em sequência.
    if (unifyProducts) {
      return list.sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title, 'pt-BR', { numeric: true, sensitivity: 'base' });
        if (byTitle !== 0) return byTitle;
        return a.variant.localeCompare(b.variant, 'pt-BR', { numeric: true, sensitivity: 'base' });
      });
    }
    return list.sort((a, b) => b.quantity - a.quantity);
  }, [filteredOrders, filterDuplicates, duplicateCustomers, customerOrderCounts, unifyProducts]);


  // Export to CSV
  const exportToCSV = () => {
    let headers: string[];
    const rows: string[][] = [];

    if (unifyProducts) {
      // Uma linha por produto (título + variante), quantidade somada e clientes agrupados
      headers = [
        'Produto',
        'Variante',
        'Quantidade Total',
        'Clientes',
        'Nº de Clientes',
      ];
      for (const product of productReport) {
        rows.push([
          product.title,
          product.variant,
          product.quantity.toString(),
          product.customers
            .map((c) => `@${c.instagram}${c.orderCount > 1 ? ` (${c.orderCount})` : ''}`)
            .join(' | '),
          product.customers.length.toString(),
        ]);
      }
    } else {
      headers = [
        'Produto',
        'Variante',
        'Quantidade Total',
        'Cliente',
        'WhatsApp',
        'Pedidos do Cliente',
        'Tem Brinde',
        'Frete Grátis',
        'Valor Desconto',
        'Coluna / Status',
      ];

      const ordersToExport = filterDuplicates
        ? filteredOrders.filter(o => duplicateCustomers.some(dc => dc.orderIds.includes(o.id)))
        : filteredOrders;

      for (const order of ordersToExport) {
        const orderCount = customerOrderCounts[order.customer_id]?.orderIds.length || 1;

        for (const product of order.products) {
          rows.push([
            product.title,
            product.variant,
            product.quantity.toString(),
            order.customer?.instagram_handle || '',
            order.customer?.whatsapp || '',
            orderCount.toString(),
            order.has_gift ? 'Sim' : 'Não',
            order.free_shipping ? 'Sim' : 'Não',
            order.discount_value ? `${order.discount_type === 'percentage' ? order.discount_value + '%' : 'R$' + order.discount_value}` : '-',
            REPORT_STAGES.find((s) => s.id === order.stage)?.label || order.stage || '-',
          ]);
        }
      }
    }

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio-produtos-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const totalPares = gradeRows.reduce((sum, r) => sum + (r.total_vendido || 0), 0);
  const totalGrades = gradeRows.reduce((sum, r) => sum + (r.grades || 0), 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setPaymentFilter("pago");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileDown className="h-4 w-4" />
          Relatório
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Relatório de Grades da Live
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
          {/* Filtro de pagamento + atualização */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as PaymentFilter)}>
              <TabsList>
                {PAYMENT_OPTIONS.map((opt) => (
                  <TabsTrigger key={opt.id} value={opt.id} className="text-xs">
                    {opt.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {updatedAt && (
                <span>
                  atualizado às{" "}
                  {updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={loadGrade} disabled={!eventId || loadingGrade}>
                <RefreshCw className={cn("h-4 w-4", loadingGrade && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Painel de grades */}
          <div className="rounded-lg border flex-1 min-h-0 flex flex-col">
            <div className="grid grid-cols-[minmax(0,2fr)_150px_minmax(0,2fr)_minmax(0,2fr)] gap-3 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground shrink-0">
              <span>Produto · cor</span>
              <span>Status</span>
              <span>Vendidos</span>
              <span>Vender mais</span>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              {!eventId ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Selecione uma live para ver o painel de grades.
                </div>
              ) : loadingGrade && gradeRows.length === 0 ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : gradeError ? (
                <div className="p-6 text-center text-sm text-destructive">{gradeError}</div>
              ) : gradeRows.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhum par no filtro atual
                </div>
              ) : (
                gradeRows.map((row, idx) => {
                  const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.sem_grade;
                  const estouro = new Set(row.tamanhos_estouro ?? []);
                  return (
                    <div
                      key={`${row.produto_nome}-${row.cor}-${idx}`}
                      className={cn(
                        "grid grid-cols-[minmax(0,2fr)_150px_minmax(0,2fr)_minmax(0,2fr)] gap-3 px-3 py-2 border-t items-start text-sm",
                        style.row,
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{row.produto_nome}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {row.cor} · {row.total_vendido} pares
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", style.pill)}>
                          {style.label}
                        </span>
                        {row.status !== "sem_grade" && (
                          <span className="font-mono text-xs text-muted-foreground">{row.grades}g</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(row.vendidos ?? []).map((v) => (
                          <span
                            key={`v-${v.tam}`}
                            className={cn(
                              "font-mono text-xs rounded px-1.5 py-0.5 bg-muted/60 text-muted-foreground",
                              (v.estouro || estouro.has(v.tam)) && "bg-amber-500/15 text-amber-600",
                            )}
                          >
                            {v.tam}×{v.qtd}
                          </span>
                        ))}
                        {(row.tamanhos_fora_da_grade ?? []).length > 0 && (
                          <span className="font-mono text-[11px] text-muted-foreground/80">
                            fora: {row.tamanhos_fora_da_grade.map((f) => `${f.tam}×${f.qtd}`).join(" ")}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {row.status === "sem_grade" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : row.grade_cheia || (row.vender_mais ?? []).length === 0 ? (
                          <span className="text-xs font-medium text-emerald-600">Grade cheia</span>
                        ) : (
                          row.vender_mais.map((v) => (
                            <span
                              key={`m-${v.tam}`}
                              className="font-mono text-xs font-semibold rounded px-1.5 py-0.5 bg-primary/15 text-primary"
                            >
                              {v.tam}×{v.qtd}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </ScrollArea>
            {gradeRows.length > 0 && (
              <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
                {gradeRows.length} modelo(s)/cor · {totalPares} pares · {totalGrades} grade(s)
              </div>
            )}
          </div>

          <Separator />

          {/* Exportação */}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
              <FileDown className="h-4 w-4" />
              Exportação (CSV) e filtros
            </summary>

            <div className="space-y-4 pt-4">
              {/* Filtro por @ do cliente */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filtrar por @ ou WhatsApp do cliente..."
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  className="pl-9"
                />
                {customerQuery && (
                  <button
                    onClick={() => setCustomerQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Filtro por coluna (stage) */}
              {paymentFilter === "pago" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Colunas incluídas no relatório</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedStages(ALL_REPORT_STAGE_IDS)}
                        className="text-xs text-primary hover:underline"
                      >
                        Todas
                      </button>
                      <span className="text-xs text-muted-foreground">·</span>
                      <button
                        type="button"
                        onClick={() => setSelectedStages([])}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {REPORT_STAGES.map((s) => (
                      <div key={s.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`stage-${s.id}`}
                          checked={selectedStages.includes(s.id)}
                          onCheckedChange={() => toggleStage(s.id)}
                        />
                        <Label htmlFor={`stage-${s.id}`} className="text-sm cursor-pointer">
                          {s.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="unifyProducts"
                    checked={unifyProducts}
                    onCheckedChange={(v) => setUnifyProducts(!!v)}
                  />
                  <Label htmlFor="unifyProducts" className="text-sm cursor-pointer flex items-center gap-1 font-medium">
                    <Package className="h-3 w-3" />
                    Unificar produtos (mesmo modelo, cor e tamanho em 1 linha)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="duplicates"
                    checked={filterDuplicates}
                    onCheckedChange={(v) => setFilterDuplicates(!!v)}
                  />
                  <Label htmlFor="duplicates" className="text-sm cursor-pointer flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Apenas clientes com múltiplos pedidos
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="withGift"
                    checked={filterWithGift}
                    onCheckedChange={(v) => setFilterWithGift(!!v)}
                  />
                  <Label htmlFor="withGift" className="text-sm cursor-pointer">
                    Com brinde
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="freeShipping"
                    checked={filterFreeShipping}
                    onCheckedChange={(v) => setFilterFreeShipping(!!v)}
                  />
                  <Label htmlFor="freeShipping" className="text-sm cursor-pointer">
                    Frete grátis
                  </Label>
                </div>
              </div>

              {/* Duplicate Customers Warning */}
              {duplicateCustomers.length > 0 && (
                <div className="bg-stage-awaiting/10 border border-stage-awaiting/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-stage-awaiting font-medium mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    {duplicateCustomers.length} cliente(s) com múltiplos pedidos
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {duplicateCustomers.map((dc) => (
                      <Badge key={dc.id} variant="outline" className="text-xs">
                        @{dc.instagram} ({dc.orderIds.length} pedidos)
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    💡 Considere juntar os produtos destes clientes em uma única caixa para economizar frete.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t">
                <div className="text-sm text-muted-foreground">
                  {productReport.length} produto(s) • {productReport.reduce((sum, p) => sum + p.quantity, 0)} unidades
                </div>
                <Button onClick={exportToCSV} className="gap-2">
                  <FileDown className="h-4 w-4" />
                  Exportar CSV
                </Button>
              </div>
            </div>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
