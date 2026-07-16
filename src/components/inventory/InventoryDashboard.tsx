import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, RefreshCw, Package, DollarSign, TrendingUp, Boxes,
  Store as StoreIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StoreSnapshot = {
  store_id: string;
  store_name: string;
  skus: number;
  pairs: number;
  cost: number;
  sale: number;
};

const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number) => v.toLocaleString("pt-BR");

export function InventoryDashboard() {
  const [snapshot, setSnapshot] = useState<StoreSnapshot[]>([]);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // ---- Snapshot ao vivo do banco (pos_products) — auditoria interna ----
  const loadSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    const { data: stores } = await supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .eq("is_simulation", false)
      .order("name");

    if (!stores) {
      setSnapshot([]);
      setLoadingSnapshot(false);
      return;
    }

    const results: StoreSnapshot[] = [];
    for (const s of stores) {
      let from = 0;
      const pageSize = 1000;
      let skus = 0;
      let pairs = 0;
      let cost = 0;
      let sale = 0;
      while (true) {
        const { data, error } = await supabase
          .from("pos_products")
          .select("stock, cost_price, price")
          .eq("store_id", s.id)
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        for (const p of data) {
          const stock = Number((p as any).stock ?? 0);
          const c = Number((p as any).cost_price ?? 0);
          const pr = Number((p as any).price ?? 0);
          skus += 1;
          if (stock > 0) {
            pairs += stock;
            cost += stock * c;
            sale += stock * pr;
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      results.push({ store_id: s.id, store_name: s.name, skus, pairs, cost, sale });
    }
    setSnapshot(results);
    setLastRefresh(new Date());
    setLoadingSnapshot(false);
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  // Realtime: refresh do snapshot quando pos_products muda
  useEffect(() => {
    const ch = supabase
      .channel("inventory-dashboard-products")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_products" },
        () => { loadSnapshot(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadSnapshot]);

  const totals = snapshot.reduce(
    (a, s) => ({
      skus: a.skus + s.skus,
      pairs: a.pairs + s.pairs,
      cost: a.cost + s.cost,
      sale: a.sale + s.sale,
    }),
    { skus: 0, pairs: 0, cost: 0, sale: 0 },
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard de Estoque</h2>
          <p className="text-sm text-muted-foreground">
            Auditoria interna consolidada das lojas reais. Dados apurados diretamente do
            catálogo do sistema (sem depender de sistemas externos).
            {lastRefresh && (
              <> · Atualizado em {lastRefresh.toLocaleTimeString("pt-BR")}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadSnapshot()}
            disabled={loadingSnapshot}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", loadingSnapshot && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs consolidados */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          label="SKUs cadastrados"
          value={fmtNum(totals.skus)}
          icon={<Package className="h-5 w-5" />}
          loading={loadingSnapshot}
        />
        <KpiCard
          label="Pares em estoque"
          value={fmtNum(totals.pairs)}
          icon={<Boxes className="h-5 w-5" />}
          loading={loadingSnapshot}
        />
        <KpiCard
          label="Custo total em estoque"
          value={fmtMoney(totals.cost)}
          icon={<DollarSign className="h-5 w-5" />}
          loading={loadingSnapshot}
        />
        <KpiCard
          label="Valor de venda em estoque"
          value={fmtMoney(totals.sale)}
          icon={<TrendingUp className="h-5 w-5" />}
          loading={loadingSnapshot}
        />
      </div>

      {/* Tabela por loja */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StoreIcon className="h-5 w-5" />
            Detalhamento por loja
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingSnapshot ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead className="text-right">SKUs</TableHead>
                  <TableHead className="text-right">Pares em estoque</TableHead>
                  <TableHead className="text-right">Custo em estoque</TableHead>
                  <TableHead className="text-right">Venda em estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.map((s) => (
                  <TableRow key={s.store_id}>
                    <TableCell className="font-medium">{s.store_name}</TableCell>
                    <TableCell className="text-right">{fmtNum(s.skus)}</TableCell>
                    <TableCell className="text-right">{fmtNum(s.pairs)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.cost)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.sale)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/40">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">{fmtNum(totals.skus)}</TableCell>
                  <TableCell className="text-right">{fmtNum(totals.pairs)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.cost)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.sale)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}
