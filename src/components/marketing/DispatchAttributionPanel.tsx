import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShoppingCart, DollarSign, Users, TrendingUp, Loader2, BarChart3,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Buyer {
  name: string;
  phone: string;
  total: number;
  source: string;
  purchased_at: string;
}

interface AttributionResult {
  buyers: Buyer[];
  total_revenue: number;
  total_buyers: number;
  total_orders: number;
  cost: number;
  roi: string | null;
  window_days: number;
}

interface DispatchAttributionPanelProps {
  dispatchId: string;
  sentCount: number;
  costPerMessage: number | null;
}

const WINDOW_OPTIONS = [7, 14, 21, 30];

export function DispatchAttributionPanel({ dispatchId, sentCount, costPerMessage }: DispatchAttributionPanelProps) {
  const [windowDays, setWindowDays] = useState(7);
  const [result, setResult] = useState<AttributionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedWindow, setLoadedWindow] = useState<number | null>(null);

  const fetchAttribution = async (days: number) => {
    setWindowDays(days);
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dispatch-attribution", {
        body: { dispatch_id: dispatchId, window_days: days },
      });
      if (error) throw error;
      setResult(data);
      setLoadedWindow(days);
    } catch (err) {
      console.error("Attribution error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const cost = (costPerMessage || 0) * (sentCount || 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Atribuição de Vendas
        </div>
        <div className="flex items-center gap-1">
          {WINDOW_OPTIONS.map((w) => (
            <Button
              key={w}
              variant={windowDays === w && loadedWindow === w ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => fetchAttribution(w)}
              disabled={isLoading}
            >
              {w}d
            </Button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Calculando atribuição ({windowDays} dias)...
        </div>
      )}

      {!isLoading && !result && (
        <Card className="p-4 text-center text-sm text-muted-foreground">
          Selecione uma janela de atribuição acima para ver as vendas atribuídas a este disparo.
        </Card>
      )}

      {!isLoading && result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card className="p-3 text-center">
              <Users className="h-4 w-4 mx-auto mb-1 text-primary" />
              <div className="text-2xl font-bold">{result.total_buyers}</div>
              <div className="text-xs text-muted-foreground">Compradores</div>
            </Card>
            <Card className="p-3 text-center">
              <ShoppingCart className="h-4 w-4 mx-auto mb-1 text-emerald-600" />
              <div className="text-2xl font-bold text-emerald-600">{result.total_orders}</div>
              <div className="text-xs text-muted-foreground">Pedidos</div>
            </Card>
            <Card className="p-3 text-center">
              <DollarSign className="h-4 w-4 mx-auto mb-1 text-green-600" />
              <div className="text-xl font-bold text-green-600">
                R$ {result.total_revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-muted-foreground">Faturado</div>
            </Card>
            <Card className="p-3 text-center">
              <BarChart3 className="h-4 w-4 mx-auto mb-1 text-amber-600" />
              <div className="text-xl font-bold text-amber-600">
                R$ {cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-muted-foreground">Custo Envio</div>
            </Card>
          </div>

          {result.roi && (
            <Card className={`p-3 text-center ${Number(result.roi) > 0 ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-destructive/10'}`}>
              <div className={`text-lg font-bold ${Number(result.roi) > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                ROI: {result.roi}%
              </div>
              <div className="text-xs text-muted-foreground">
                Retorno sobre investimento (janela {result.window_days} dias)
              </div>
            </Card>
          )}

          {result.buyers.length > 0 ? (
            <div>
              <div className="text-sm font-medium mb-2">
                Clientes que compraram ({result.buyers.length} pedidos)
              </div>
              <ScrollArea className="max-h-[250px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Cliente</TableHead>
                      <TableHead className="text-xs">Telefone</TableHead>
                      <TableHead className="text-xs">Valor</TableHead>
                      <TableHead className="text-xs">Canal</TableHead>
                      <TableHead className="text-xs">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.buyers.map((b, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{b.name}</TableCell>
                        <TableCell className="text-xs font-mono">{b.phone}</TableCell>
                        <TableCell className="text-xs font-semibold text-green-600">
                          R$ {b.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{b.source}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(b.purchased_at), "dd/MM HH:mm", { locale: ptBR })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          ) : (
            <Card className="p-4 text-center text-sm text-muted-foreground">
              Nenhuma venda atribuída nesta janela de {result.window_days} dias.
            </Card>
          )}
        </>
      )}
    </div>
  );
}
