import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download } from "lucide-react";

interface Row {
  cohort_month: string; buyers: number; prior_customers: number; pct_rep_60: number; pct_rep_60_live: number;
  pct_rep_90: number; pct_2plus_90: number; revenue_90d: number; revenue_per_buyer: number; partial: boolean;
}
const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthLabel = (d: string) => { const [y, m] = d.split("-"); return `${m}/${y}`; };
const HEADER = ["Coorte", "Compradores", "Já eram clientes", "% recompra 60d", "% recompra 60d em live", "% recompra 90d", "% 2+ compras 90d", "Receita 90d", "Receita/comprador", "Parcial"];

export function LiveRepurchaseCohorts() {
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase.rpc("live_repurchase_cohorts" as any, { p_filter: filter }).then(({ data }) => {
      setRows((data as any) || []);
      setLoading(false);
    });
  }, [filter]);

  const exportCsv = () => {
    const lines = [HEADER, ...rows.map((r) => [monthLabel(r.cohort_month), r.buyers, r.prior_customers, r.pct_rep_60, r.pct_rep_60_live, r.pct_rep_90, r.pct_2plus_90, r.revenue_90d, r.revenue_per_buyer, r.partial ? "sim" : "não"])];
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "coortes-recompra-live.csv";
    a.click();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Coortes de recompra (mês da 1ª compra em live)</h3>
          <p className="text-[11px] text-muted-foreground">Coortes com menos de 60 dias são parciais.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 text-xs w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="new">Só quem nunca tinha comprado</SelectItem>
              <SelectItem value="existing">Só quem já era cliente</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5 mr-1" />CSV
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>{HEADER.slice(0, 9).map((h) => <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.cohort_month}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {monthLabel(r.cohort_month)} {r.partial && <Badge variant="outline" className="ml-1 text-[9px]">parcial</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{r.buyers}</TableCell>
                  <TableCell className="text-xs">{r.prior_customers}</TableCell>
                  <TableCell className="text-xs">{r.pct_rep_60}%</TableCell>
                  <TableCell className="text-xs">{r.pct_rep_60_live}%</TableCell>
                  <TableCell className="text-xs">{r.pct_rep_90}%</TableCell>
                  <TableCell className="text-xs">{r.pct_2plus_90}%</TableCell>
                  <TableCell className="text-xs">{brl(r.revenue_90d)}</TableCell>
                  <TableCell className="text-xs">{brl(r.revenue_per_buyer)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
