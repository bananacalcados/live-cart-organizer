import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw, ExternalLink, Search, AlertCircle, CheckCircle2, Loader2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface EventCheckoutMonitorProps {
  events: { id: string; name: string }[];
}

interface CheckoutAttempt {
  id: string;
  sale_id: string;
  amount: number | null;
  payment_method: string;
  gateway: string | null;
  status: string;
  error_message: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  event_name?: string;
}

export const EventCheckoutMonitor = ({ events }: EventCheckoutMonitorProps) => {
  const [attempts, setAttempts] = useState<CheckoutAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const fetchAttempts = useCallback(async () => {
    if (events.length === 0) return;
    setLoading(true);
    try {
      // Get order IDs for selected events
      let orderQuery = supabase
        .from("orders")
        .select("id, event_id");
      
      if (selectedEventId !== "all") {
        orderQuery = orderQuery.eq("event_id", selectedEventId);
      } else {
        orderQuery = orderQuery.in("event_id", events.map(e => e.id));
      }

      const { data: orders } = await orderQuery;
      if (!orders || orders.length === 0) {
        setAttempts([]);
        setLoading(false);
        return;
      }

      const orderIds = orders.map(o => o.id);
      const eventMap = new Map(events.map(e => [e.id, e.name]));
      const orderEventMap = new Map(orders.map(o => [o.id, o.event_id]));

      // Fetch checkout attempts in batches (supabase .in() has limits)
      const batchSize = 100;
      const allAttempts: CheckoutAttempt[] = [];

      for (let i = 0; i < orderIds.length; i += batchSize) {
        const batch = orderIds.slice(i, i + batchSize);
        const { data: attemptsData } = await supabase
          .from("pos_checkout_attempts")
          .select("*")
          .in("sale_id", batch)
          .order("created_at", { ascending: false });

        if (attemptsData) {
          allAttempts.push(
            ...attemptsData.map(a => ({
              ...a,
              event_name: eventMap.get(orderEventMap.get(a.sale_id) || "") || "—",
            }))
          );
        }
      }

      // Sort all by date desc
      allAttempts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setAttempts(allAttempts);
    } catch (err) {
      console.error("Error fetching checkout attempts:", err);
    } finally {
      setLoading(false);
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    fetchAttempts();
  }, [fetchAttempts]);

  const filtered = attempts.filter(a => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const matchName = a.customer_name?.toLowerCase().includes(s);
      const matchPhone = a.customer_phone?.includes(s);
      const matchSaleId = a.sale_id.toLowerCase().includes(s);
      if (!matchName && !matchPhone && !matchSaleId) return false;
    }
    return true;
  });

  const counts = {
    total: attempts.length,
    success: attempts.filter(a => a.status === "success").length,
    failed: attempts.filter(a => a.status === "failed").length,
    processing: attempts.filter(a => a.status === "processing").length,
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge className="bg-green-500/20 text-green-700 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Sucesso</Badge>;
      case "failed":
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Falhou</Badge>;
      case "processing":
        return <Badge className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processando</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getMethodLabel = (method: string) => {
    if (method === "pix") return "PIX";
    if (method === "credit_card") return "Cartão";
    return method;
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="cursor-pointer" onClick={() => setStatusFilter("all")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{counts.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setStatusFilter("success")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{counts.success}</p>
            <p className="text-xs text-muted-foreground">Sucesso</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setStatusFilter("failed")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-destructive">{counts.failed}</p>
            <p className="text-xs text-muted-foreground">Falha</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setStatusFilter("processing")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-yellow-600">{counts.processing}</p>
            <p className="text-xs text-muted-foreground">Processando</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={selectedEventId} onValueChange={setSelectedEventId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Evento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Eventos</SelectItem>
            {events.map(e => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="success">Sucesso</SelectItem>
            <SelectItem value="failed">Falha</SelectItem>
            <SelectItem value="processing">Processando</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar nome, telefone ou ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button variant="outline" size="sm" onClick={fetchAttempts} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Table */}
      <Card>
        <ScrollArea className="max-h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Nenhuma tentativa de pagamento encontrada
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(a => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{a.customer_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{a.customer_phone || "—"}</div>
                    </TableCell>
                    <TableCell className="text-sm">{a.event_name}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {a.amount ? `R$ ${a.amount.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{getMethodLabel(a.payment_method)}</TableCell>
                    <TableCell className="text-sm capitalize">{a.gateway || "—"}</TableCell>
                    <TableCell>{getStatusBadge(a.status)}</TableCell>
                    <TableCell className="text-xs text-destructive max-w-[200px] truncate" title={a.error_message || ""}>
                      {a.error_message || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(a.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => window.open(`https://checkout.bananacalcados.com.br/checkout/order/${a.sale_id}`, "_blank")}
                        title="Abrir checkout"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </Card>
    </div>
  );
};
