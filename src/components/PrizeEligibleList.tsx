import { useState, useEffect } from "react";
import { Trophy, Clock, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface PrizeEligibleOrder {
  id: string;
  customer_instagram: string;
  customer_whatsapp: string;
  paid_at: string;
  checkout_started_at: string;
  total_value: number;
  time_to_pay_seconds: number;
}

interface PrizeEligibleListProps {
  eventId: string;
}

export function PrizeEligibleList({ eventId }: PrizeEligibleListProps) {
  const [eligibleOrders, setEligibleOrders] = useState<PrizeEligibleOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadEligibleOrders();
    
    // Subscribe to realtime changes
    const channel = supabase
      .channel('prize-eligible-realtime')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `event_id=eq.${eventId}`,
      }, () => {
        loadEligibleOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [eventId]);

  const loadEligibleOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, paid_at, checkout_started_at, products, eligible_for_prize,
          customer:customers(instagram_handle, whatsapp)
        `)
        .eq('event_id', eventId)
        .eq('eligible_for_prize', true)
        .eq('is_paid', true)
        .order('paid_at', { ascending: false });

      if (error) throw error;

      const orders: PrizeEligibleOrder[] = (data || []).map(order => {
        const products = order.products as any[];
        const totalValue = products.reduce((sum: number, p: any) => sum + (p.price * p.quantity), 0);
        const customer = order.customer as any;
        const checkoutStart = new Date(order.checkout_started_at!);
        const paidTime = new Date(order.paid_at!);
        const timeToPaySeconds = Math.round((paidTime.getTime() - checkoutStart.getTime()) / 1000);

        return {
          id: order.id,
          customer_instagram: customer?.instagram_handle || 'N/A',
          customer_whatsapp: customer?.whatsapp || 'N/A',
          paid_at: order.paid_at!,
          checkout_started_at: order.checkout_started_at!,
          total_value: totalValue,
          time_to_pay_seconds: timeToPaySeconds,
        };
      });

      setEligibleOrders(orders);
    } catch (error) {
      console.error('Error loading eligible orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimeToPay = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          Elegíveis para Roleta de Prêmios
          <Badge variant="secondary" className="ml-auto">
            {eligibleOrders.length}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Clientes que pagaram em até 10 minutos após abrir o checkout
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : eligibleOrders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Trophy className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhum cliente elegível ainda</p>
            <p className="text-xs mt-1">Clientes que pagarem em até 10 min aparecerão aqui</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {eligibleOrders.map(order => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-yellow-100 dark:bg-yellow-800 flex items-center justify-center">
                      <User className="h-4 w-4 text-yellow-700 dark:text-yellow-300" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">@{order.customer_instagram}</p>
                      <p className="text-xs text-muted-foreground">{order.customer_whatsapp}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm text-yellow-700 dark:text-yellow-300">
                      R$ {order.total_value.toFixed(2)}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatTimeToPay(order.time_to_pay_seconds)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
