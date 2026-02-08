import { useState, useMemo } from "react";
import { FileDown, Filter, AlertTriangle, Users, Package, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DbOrder } from "@/types/database";

interface OrderReportDialogProps {
  orders: DbOrder[];
}

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

export function OrderReportDialog({ orders }: OrderReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [filterDuplicates, setFilterDuplicates] = useState(false);
  const [filterPaidOnly, setFilterPaidOnly] = useState(true);
  const [filterWithGift, setFilterWithGift] = useState(false);
  const [filterFreeShipping, setFilterFreeShipping] = useState(false);

  // Filter orders
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      if (filterPaidOnly && order.stage !== 'paid' && order.stage !== 'shipped') {
        return false;
      }
      if (filterWithGift && !order.has_gift) {
        return false;
      }
      if (filterFreeShipping && !order.free_shipping) {
        return false;
      }
      return true;
    });
  }, [orders, filterPaidOnly, filterWithGift, filterFreeShipping]);

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
        const key = `${product.id}-${product.variant}`;
        
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
    
    return Object.values(products).sort((a, b) => b.quantity - a.quantity);
  }, [filteredOrders, filterDuplicates, duplicateCustomers, customerOrderCounts]);

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'Produto',
      'Variante',
      'Quantidade Total',
      'Cliente',
      'WhatsApp',
      'Pedidos do Cliente',
      'Tem Brinde',
      'Frete Grátis',
      'Valor Desconto',
      'Status Pagamento',
    ];

    const rows: string[][] = [];

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
          order.stage === 'paid' || order.stage === 'shipped' ? 'Pago' : 'Pendente',
        ]);
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileDown className="h-4 w-4" />
          Relatório
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Relatório de Produtos para Separação
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4 flex-1 overflow-hidden flex flex-col">
          {/* Filters */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Checkbox 
                id="paidOnly" 
                checked={filterPaidOnly}
                onCheckedChange={(v) => setFilterPaidOnly(!!v)}
              />
              <Label htmlFor="paidOnly" className="text-sm cursor-pointer">
                Apenas pagos
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

          <Separator />

          {/* Products List */}
          <ScrollArea className="flex-1">
            <div className="space-y-3">
              {productReport.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhum produto encontrado com os filtros selecionados
                </div>
              ) : (
                productReport.map((product) => (
                  <div 
                    key={`${product.id}-${product.variant}`}
                    className="bg-secondary/30 rounded-lg p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-medium">{product.title}</h4>
                        <p className="text-sm text-muted-foreground">{product.variant}</p>
                      </div>
                      <Badge className="bg-accent">
                        {product.quantity}x
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {product.customers.map((customer, i) => (
                        <Badge 
                          key={i} 
                          variant={customer.orderCount > 1 ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          @{customer.instagram}
                          {customer.orderCount > 1 && ` (${customer.orderCount})`}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Summary & Export */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              {productReport.length} produto(s) • {productReport.reduce((sum, p) => sum + p.quantity, 0)} unidades
            </div>
            <Button onClick={exportToCSV} className="gap-2">
              <FileDown className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
