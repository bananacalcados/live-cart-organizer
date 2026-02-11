import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, AlertTriangle, Users, Package } from 'lucide-react';

interface Props {
  orders: any[];
  searchTerm: string;
  showGrouping: boolean;
  onRefresh: () => void;
}

export function ExpeditionOrdersList({ orders, searchTerm, showGrouping, onRefresh }: Props) {
  const filtered = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    if (!term) return true;
    return (
      o.shopify_order_name?.toLowerCase().includes(term) ||
      o.customer_name?.toLowerCase().includes(term) ||
      o.customer_email?.toLowerCase().includes(term)
    );
  });

  const approved = filtered.filter(o => o.financial_status === 'paid' || o.financial_status === 'partially_paid');
  const pending = filtered.filter(o => o.financial_status !== 'paid' && o.financial_status !== 'partially_paid');

  // Grouping logic
  const customerGroups = new Map<string, any[]>();
  if (showGrouping) {
    approved.forEach(order => {
      const key = order.customer_email || order.customer_name || order.id;
      if (!customerGroups.has(key)) customerGroups.set(key, []);
      customerGroups.get(key)!.push(order);
    });
  }

  const multiOrderCustomers = Array.from(customerGroups.entries()).filter(([, orders]) => orders.length > 1);

  const handleAutoGroup = async () => {
    try {
      for (const [email, groupOrders] of multiOrderCustomers) {
        const { data: group } = await supabase
          .from('expedition_groups')
          .insert({
            customer_email: email,
            customer_name: groupOrders[0].customer_name,
            order_count: groupOrders.length,
            total_items: groupOrders.reduce((sum: number, o: any) => 
              sum + (o.expedition_order_items?.length || 0), 0),
          })
          .select()
          .single();

        if (group) {
          const ids = groupOrders.map((o: any) => o.id);
          await supabase
            .from('expedition_orders')
            .update({ group_id: group.id, expedition_status: 'grouped' })
            .in('id', ids);
        }
      }
      toast.success(`${multiOrderCustomers.length} grupos criados!`);
      onRefresh();
    } catch (error: any) {
      toast.error(`Erro ao agrupar: ${error.message}`);
    }
  };

  if (showGrouping) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Agrupamento por Cliente</h2>
            <p className="text-sm text-muted-foreground">
              {multiOrderCustomers.length} clientes com múltiplos pedidos
            </p>
          </div>
          {multiOrderCustomers.length > 0 && (
            <Button onClick={handleAutoGroup} className="gap-2">
              <Users className="h-4 w-4" />
              Agrupar Automaticamente
            </Button>
          )}
        </div>

        {multiOrderCustomers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nenhum cliente com múltiplos pedidos encontrado.
            </CardContent>
          </Card>
        ) : (
          multiOrderCustomers.map(([email, groupOrders]) => (
            <Card key={email} className="border-l-4 border-l-primary">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{groupOrders[0].customer_name || email}</CardTitle>
                  <Badge variant="secondary">{groupOrders.length} pedidos</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{email}</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {groupOrders.map((o: any) => (
                    <div key={o.id} className="flex items-center justify-between p-2 rounded bg-secondary/50">
                      <div>
                        <span className="font-medium text-sm">{o.shopify_order_name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {o.expedition_order_items?.length || 0} itens
                        </span>
                      </div>
                      <span className="text-sm font-medium">
                        R$ {Number(o.total_price || 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="approved">
        <TabsList>
          <TabsTrigger value="approved" className="gap-2">
            <CheckCircle2 className="h-4 w-4" /> Aprovados ({approved.length})
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <AlertTriangle className="h-4 w-4" /> Pendentes ({pending.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approved" className="space-y-2 mt-4">
          {approved.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido aprovado.</CardContent></Card>
          ) : (
            approved.map(order => <OrderRow key={order.id} order={order} />)
          )}
        </TabsContent>

        <TabsContent value="pending" className="space-y-2 mt-4">
          {pending.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido pendente.</CardContent></Card>
          ) : (
            pending.map(order => <OrderRow key={order.id} order={order} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrderRow({ order }: { order: any }) {
  const statusColors: Record<string, string> = {
    pending_sync: 'bg-muted text-muted-foreground',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    grouped: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    picking: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    packed: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    dispatched: 'bg-primary/10 text-primary',
  };

  const addr = order.shipping_address as any;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Package className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{order.shopify_order_name || order.shopify_order_number}</span>
                <Badge className={statusColors[order.expedition_status] || 'bg-muted'}>
                  {order.expedition_status}
                </Badge>
                {order.group_id && (
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" /> Agrupado
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {order.customer_name} • {order.customer_email}
              </p>
              {addr && (
                <p className="text-xs text-muted-foreground">
                  {addr.city}/{addr.province} - CEP: {addr.zip}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-foreground">R$ {Number(order.total_price || 0).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">
              {order.expedition_order_items?.length || 0} itens • {order.total_weight_grams || 0}g
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
