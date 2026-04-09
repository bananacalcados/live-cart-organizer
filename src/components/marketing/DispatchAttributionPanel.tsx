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
  ChevronDown, ChevronUp, Store, UserCheck, Star, Package, Phone, Tag,
  History, Info,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface BuyerProduct {
  name: string;
  variant?: string;
  qty: number;
  price: number;
}

interface PreviousPurchase {
  reference_id?: string;
  source: string;
  purchased_at: string;
  total: number | null;
  store_name: string | null;
  seller_name: string | null;
  products: BuyerProduct[];
  note?: string | null;
}

interface Buyer {
  name: string;
  phone: string;
  total: number;
  source: string;
  purchased_at: string;
  store_name: string | null;
  seller_name: string | null;
  products: BuyerProduct[];
  is_first_purchase: boolean;
  previous_purchases?: PreviousPurchase[];
}

interface AttributionResult {
  buyers: Buyer[];
  total_revenue: number;
  total_buyers: number;
  total_orders: number;
  cost: number;
  cost_per_message: number;
  template_category: string;
  template_name: string | null;
  whatsapp_label: string | null;
  whatsapp_phone: string | null;
  roi: string | null;
  roas: string | null;
  window_days: number;
}

interface DispatchAttributionPanelProps {
  dispatchId: string;
  sentCount: number;
}

const WINDOW_OPTIONS = [7, 14, 21, 30];

export function DispatchAttributionPanel({ dispatchId, sentCount }: DispatchAttributionPanelProps) {
  const [windowDays, setWindowDays] = useState(7);
  const [result, setResult] = useState<AttributionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedWindow, setLoadedWindow] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const fetchAttribution = async (days: number) => {
    setWindowDays(days);
    setIsLoading(true);
    setExpandedIndex(null);
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
          {/* Dispatch info */}
          {(result.whatsapp_label || result.template_name) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {result.whatsapp_label && (
                <div className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  <span>{result.whatsapp_label}</span>
                  {result.whatsapp_phone && <span className="font-mono">({result.whatsapp_phone})</span>}
                </div>
              )}
              {result.template_name && (
                <div className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  <span className="font-mono">{result.template_name}</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0">
                    {result.template_category === 'UTILITY' ? 'Utilidade' : 'Marketing'}
                  </Badge>
                </div>
              )}
            </div>
          )}

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
                R$ {result.cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-muted-foreground">
                Custo Envio ({result.template_category === 'UTILITY' ? 'Utilidade' : 'Marketing'})
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {result.roas && (
              <Card className={`p-3 text-center ${Number(result.roas) >= 1 ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-destructive/10'}`}>
                <div className={`text-lg font-bold ${Number(result.roas) >= 1 ? 'text-emerald-600' : 'text-destructive'}`}>
                  ROAS: {result.roas}x
                </div>
                <div className="text-xs text-muted-foreground">
                  Faturamento ÷ Custo (janela {result.window_days} dias)
                </div>
              </Card>
            )}
            {result.roi && (
              <Card className={`p-3 text-center ${Number(result.roi) > 0 ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-destructive/10'}`}>
                <div className={`text-lg font-bold ${Number(result.roi) > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  ROI: {result.roi}%
                </div>
                <div className="text-xs text-muted-foreground">
                  Retorno sobre investimento
                </div>
              </Card>
            )}
          </div>

          {result.buyers.length > 0 ? (
            <div>
              <div className="text-sm font-medium mb-2">
                Clientes que compraram ({result.buyers.length} pedidos)
              </div>
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-8"></TableHead>
                      <TableHead className="text-xs">Cliente</TableHead>
                      <TableHead className="text-xs">Telefone</TableHead>
                      <TableHead className="text-xs">Valor</TableHead>
                      <TableHead className="text-xs">Canal</TableHead>
                      <TableHead className="text-xs">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.buyers.map((b, i) => (
                      <>
                        <TableRow
                          key={`row-${i}`}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                        >
                          <TableCell className="px-1">
                            {expandedIndex === i
                              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            <div className="flex items-center gap-1.5">
                              {b.name}
                              {b.is_first_purchase && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500 text-amber-600">
                                  <Star className="h-2.5 w-2.5 mr-0.5" />
                                  1ª compra
                                </Badge>
                              )}
                            </div>
                          </TableCell>
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

                        {expandedIndex === i && (
                          <TableRow key={`detail-${i}`} className="bg-muted/30">
                            <TableCell colSpan={6} className="p-3">
                              <div className="space-y-3">
                                {/* Current purchase details */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                  <div className="space-y-1.5">
                                    {b.store_name && (
                                      <div className="flex items-center gap-1.5">
                                        <Store className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span className="text-muted-foreground">Loja:</span>
                                        <span className="font-medium">{b.store_name}</span>
                                      </div>
                                    )}
                                    {b.seller_name && (
                                      <div className="flex items-center gap-1.5">
                                        <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span className="text-muted-foreground">Vendedora:</span>
                                        <span className="font-medium">{b.seller_name}</span>
                                      </div>
                                    )}
                                    {!b.store_name && !b.seller_name && b.source !== "PDV" && (
                                      <span className="text-muted-foreground">Venda online</span>
                                    )}
                                    <div className="flex items-center gap-1.5 mt-1">
                                      {b.is_first_purchase ? (
                                        <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30 text-[10px]">
                                          <Star className="h-2.5 w-2.5 mr-0.5" />
                                          Primeira compra — Cliente novo!
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary" className="text-[10px]">
                                          Cliente recorrente
                                        </Badge>
                                      )}
                                    </div>
                                  </div>

                                  <div className="sm:col-span-2">
                                    {b.products && b.products.length > 0 ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                                          <span className="text-muted-foreground font-medium">
                                            Produtos ({b.products.length})
                                          </span>
                                        </div>
                                        {b.products.map((p, pi) => (
                                          <div key={pi} className="flex justify-between items-center bg-background/50 rounded px-2 py-1">
                                            <div>
                                              <span className="font-medium">{p.name}</span>
                                              {p.variant && <span className="text-muted-foreground ml-1">({p.variant})</span>}
                                              {p.qty > 1 && <span className="text-muted-foreground ml-1">x{p.qty}</span>}
                                            </div>
                                            <span className="text-green-600 font-medium">
                                              R$ {(p.price * p.qty).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground">Produtos não disponíveis</span>
                                    )}
                                  </div>
                                </div>

                                {/* Previous purchases */}
                                {b.previous_purchases && b.previous_purchases.length > 0 && (
                                  <div className="border-t pt-2 mt-2">
                                    <div className="flex items-center gap-1.5 mb-2">
                                      <History className="h-3.5 w-3.5 text-blue-500" />
                                      <span className="text-xs font-medium text-blue-600">
                                        Compras anteriores ({b.previous_purchases.length})
                                      </span>
                                    </div>
                                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                      {b.previous_purchases.map((pp, ppi) => (
                                        <div key={ppi} className="bg-background/60 rounded-md p-2 text-xs border border-border/50">
                                          <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                              <Badge variant="outline" className="text-[9px]">{pp.source}</Badge>
                                              <span className="text-muted-foreground">
                                                {format(new Date(pp.purchased_at), "dd/MM/yyyy", { locale: ptBR })}
                                              </span>
                                            </div>
                                            {pp.total != null && (
                                              <span className="font-semibold text-green-600">
                                                R$ {pp.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                              </span>
                                            )}
                                          </div>
                                          {pp.store_name && (
                                            <div className="flex items-center gap-1 text-muted-foreground">
                                              <Store className="h-3 w-3" />
                                              <span>{pp.store_name}</span>
                                              {pp.seller_name && <span>• {pp.seller_name}</span>}
                                            </div>
                                          )}
                                          {pp.note && (
                                            <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
                                              <Info className="h-3 w-3" />
                                              <span className="italic">{pp.note}</span>
                                            </div>
                                          )}
                                          {pp.products && pp.products.length > 0 && (
                                            <div className="mt-1 space-y-0.5">
                                              {pp.products.slice(0, 5).map((p, pi) => (
                                                <div key={pi} className="flex justify-between text-[10px]">
                                                  <span>
                                                    {p.name}
                                                    {p.variant && <span className="text-muted-foreground"> ({p.variant})</span>}
                                                    {p.qty > 1 && <span className="text-muted-foreground"> x{p.qty}</span>}
                                                  </span>
                                                  <span className="text-muted-foreground">
                                                    R$ {(p.price * p.qty).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                                  </span>
                                                </div>
                                              ))}
                                              {pp.products.length > 5 && (
                                                <span className="text-[10px] text-muted-foreground">
                                                  +{pp.products.length - 5} produto(s)
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
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
