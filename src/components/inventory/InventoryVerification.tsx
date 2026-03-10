import { useState, useMemo } from "react";
import { CheckCircle2, AlertTriangle, Download, ClipboardCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface CountItem {
  id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  counted_quantity: number;
  current_stock: number | null;
  divergence: number | null;
}

interface Props {
  countItems: CountItem[];
  storeName: string;
  countDate: string;
  countScope: string;
}

export function InventoryVerification({ countItems, storeName, countDate, countScope }: Props) {
  const [manualCounts, setManualCounts] = useState<Record<string, string>>({});
  const [confirmedItems, setConfirmedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyDivergent, setShowOnlyDivergent] = useState(false);

  const setManualCount = (itemId: string, value: string) => {
    setManualCounts(prev => ({ ...prev, [itemId]: value }));
    // Remove from confirmed if value changes
    setConfirmedItems(prev => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  };

  const confirmItem = (itemId: string) => {
    setConfirmedItems(prev => new Set(prev).add(itemId));
  };

  const getVerificationStatus = (item: CountItem) => {
    const manualVal = manualCounts[item.id];
    if (manualVal === undefined || manualVal === "") return "pending";
    const manual = parseFloat(manualVal);
    if (isNaN(manual)) return "pending";
    if (manual === item.counted_quantity) return "ok";
    return "divergent";
  };

  const filteredItems = useMemo(() => {
    let items = countItems;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i =>
        i.product_name.toLowerCase().includes(q) ||
        i.sku?.toLowerCase().includes(q) ||
        i.barcode?.toLowerCase().includes(q)
      );
    }
    if (showOnlyDivergent) {
      items = items.filter(i => getVerificationStatus(i) === "divergent");
    }
    return items;
  }, [countItems, searchQuery, showOnlyDivergent, manualCounts]);

  const stats = useMemo(() => {
    let verified = 0, divergent = 0, pending = 0;
    countItems.forEach(item => {
      const status = getVerificationStatus(item);
      if (status === "ok") verified++;
      else if (status === "divergent") divergent++;
      else pending++;
    });
    return { verified, divergent, pending, total: countItems.length };
  }, [countItems, manualCounts]);

  const handleConfirmAll = () => {
    // Auto-fill manual counts with scanned counts for items not yet filled
    const updated = { ...manualCounts };
    countItems.forEach(item => {
      if (updated[item.id] === undefined || updated[item.id] === "") {
        updated[item.id] = String(item.counted_quantity);
      }
    });
    setManualCounts(updated);
    toast.success("Todos os itens sem conferência foram preenchidos com a quantidade bipada.");
  };

  const generateReport = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("pt-BR");
    const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const rows = countItems.map(item => {
      const manual = manualCounts[item.id];
      const manualQty = manual !== undefined && manual !== "" ? parseFloat(manual) : null;
      const status = getVerificationStatus(item);
      const diff = manualQty !== null ? manualQty - item.counted_quantity : null;
      return {
        produto: item.product_name,
        sku: item.sku || "",
        barcode: item.barcode || "",
        qtd_bipada: item.counted_quantity,
        qtd_conferida: manualQty ?? "",
        diferenca: diff ?? "",
        status: status === "ok" ? "OK" : status === "divergent" ? "DIVERGENTE" : "PENDENTE",
        estoque_tiny: item.current_stock ?? "",
      };
    });

    // Sort: divergent first, then pending, then ok
    const order = { DIVERGENTE: 0, PENDENTE: 1, OK: 2 };
    rows.sort((a, b) => (order[a.status as keyof typeof order] ?? 2) - (order[b.status as keyof typeof order] ?? 2));

    const divergentRows = rows.filter(r => r.status === "DIVERGENTE");

    // Generate CSV
    const header = "Produto;SKU;Código de Barras;Qtd Bipada;Qtd Conferida;Diferença;Status;Estoque Tiny";
    const csvRows = rows.map(r =>
      `"${r.produto}";"${r.sku}";"${r.barcode}";${r.qtd_bipada};${r.qtd_conferida};${r.diferenca};${r.status};${r.estoque_tiny}`
    );
    const csv = [header, ...csvRows].join("\n");

    // Generate printable HTML report
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Relatório de Conferência - ${storeName}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; padding: 15px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 12px; }
  .summary { display: flex; gap: 20px; margin-bottom: 16px; padding: 10px; background: #f5f5f5; border-radius: 6px; }
  .summary-item { text-align: center; }
  .summary-item .num { font-size: 22px; font-weight: bold; }
  .summary-item .label { font-size: 10px; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #333; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #ddd; font-size: 10px; }
  tr:nth-child(even) { background: #fafafa; }
  .divergent { background: #fff3cd !important; font-weight: bold; }
  .ok { color: #28a745; }
  .div-badge { background: #dc3545; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 9px; }
  .ok-badge { background: #28a745; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 9px; }
  .pend-badge { background: #6c757d; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 9px; }
  .no-print { margin-bottom: 10px; }
  @media print { .no-print { display: none; } }
  ${divergentRows.length > 0 ? `.divergent-section { margin-top: 20px; padding: 10px; border: 2px solid #dc3545; border-radius: 6px; }
  .divergent-section h2 { color: #dc3545; font-size: 14px; margin-bottom: 8px; }` : ''}
</style></head><body>
<div class="no-print"><button onclick="window.print()" style="padding:8px 16px;cursor:pointer;">🖨️ Imprimir</button></div>
<h1>Relatório de Conferência de Estoque</h1>
<div class="meta">
  Loja: <strong>${storeName}</strong> · Tipo: ${countScope === 'total' ? 'Balanço Total' : 'Balanço Parcial'}
  · Data do balanço: ${new Date(countDate).toLocaleDateString("pt-BR")}
  · Conferência: ${dateStr} às ${timeStr}
</div>
<div class="summary">
  <div class="summary-item"><div class="num">${stats.total}</div><div class="label">Total de Itens</div></div>
  <div class="summary-item"><div class="num" style="color:#28a745">${stats.verified}</div><div class="label">Conferidos OK</div></div>
  <div class="summary-item"><div class="num" style="color:#dc3545">${stats.divergent}</div><div class="label">Divergentes</div></div>
  <div class="summary-item"><div class="num" style="color:#6c757d">${stats.pending}</div><div class="label">Pendentes</div></div>
</div>
<table>
  <thead><tr><th>#</th><th>Produto</th><th>SKU</th><th>Cód. Barras</th><th>Qtd Bipada</th><th>Qtd Conferida</th><th>Dif.</th><th>Status</th><th>Estoque Tiny</th></tr></thead>
  <tbody>
${rows.map((r, i) => `<tr class="${r.status === 'DIVERGENTE' ? 'divergent' : ''}">
  <td>${i + 1}</td><td>${r.produto}</td><td>${r.sku}</td><td>${r.barcode}</td>
  <td>${r.qtd_bipada}</td><td>${r.qtd_conferida}</td>
  <td>${r.diferenca !== "" ? (Number(r.diferenca) > 0 ? '+' : '') + r.diferenca : ''}</td>
  <td><span class="${r.status === 'DIVERGENTE' ? 'div-badge' : r.status === 'OK' ? 'ok-badge' : 'pend-badge'}">${r.status}</span></td>
  <td>${r.estoque_tiny}</td>
</tr>`).join("")}
  </tbody>
</table>
${divergentRows.length > 0 ? `<div class="divergent-section">
  <h2>⚠️ Itens com Divergência na Conferência (${divergentRows.length})</h2>
  <p style="font-size:10px;color:#666;margin-bottom:8px;">Estes itens apresentaram diferença entre a quantidade bipada e a quantidade conferida manualmente. Recomenda-se recontar esses itens.</p>
  <table>
    <thead><tr><th>Produto</th><th>SKU</th><th>Qtd Bipada</th><th>Qtd Conferida</th><th>Diferença</th></tr></thead>
    <tbody>
${divergentRows.map(r => `<tr class="divergent">
  <td>${r.produto}</td><td>${r.sku}</td><td>${r.qtd_bipada}</td><td>${r.qtd_conferida}</td>
  <td>${Number(r.diferenca) > 0 ? '+' : ''}${r.diferenca}</td>
</tr>`).join("")}
    </tbody>
  </table>
</div>` : ''}
</body></html>`;

    // Download CSV
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conferencia-estoque-${storeName.replace(/\s/g, "-")}-${dateStr.replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    // Open printable report
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }

    toast.success("Relatório gerado! CSV baixado e página de impressão aberta.");
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-500">{stats.verified}</p>
            <p className="text-xs text-muted-foreground">Conferidos OK</p>
          </CardContent>
        </Card>
        <Card className="border-destructive/30">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-destructive">{stats.divergent}</p>
            <p className="text-xs text-muted-foreground">Divergentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">Pendentes</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar produto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant={showOnlyDivergent ? "default" : "outline"}
          size="sm"
          onClick={() => setShowOnlyDivergent(!showOnlyDivergent)}
          className="gap-1"
          disabled={stats.divergent === 0}
        >
          <AlertTriangle className="h-4 w-4" />
          Só divergentes ({stats.divergent})
        </Button>
        <Button variant="outline" size="sm" onClick={handleConfirmAll} className="gap-1">
          <CheckCircle2 className="h-4 w-4" />
          Preencher todos
        </Button>
        <Button size="sm" onClick={generateReport} className="gap-1">
          <Download className="h-4 w-4" />
          Gerar Relatório
        </Button>
      </div>

      {/* Verification Table */}
      <ScrollArea className="h-[450px] border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Produto</TableHead>
              <TableHead className="text-center w-[12%]">Bipado</TableHead>
              <TableHead className="text-center w-[18%]">Conferência</TableHead>
              <TableHead className="text-center w-[12%]">Dif.</TableHead>
              <TableHead className="text-center w-[18%]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map(item => {
              const status = getVerificationStatus(item);
              const manualVal = manualCounts[item.id];
              const manualQty = manualVal !== undefined && manualVal !== "" ? parseFloat(manualVal) : null;
              const diff = manualQty !== null ? manualQty - item.counted_quantity : null;
              const isConfirmed = confirmedItems.has(item.id);

              return (
                <TableRow
                  key={item.id}
                  className={cn(
                    status === "divergent" && "bg-amber-50/50 dark:bg-amber-950/20",
                    status === "ok" && isConfirmed && "bg-green-50/30 dark:bg-green-950/10"
                  )}
                >
                  <TableCell>
                    <p className="text-sm font-medium truncate max-w-[280px]">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku && `SKU: ${item.sku}`}{item.barcode && ` · ${item.barcode}`}
                    </p>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="text-sm font-bold">
                      {item.counted_quantity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Input
                      type="number"
                      min="0"
                      value={manualCounts[item.id] ?? ""}
                      onChange={(e) => setManualCount(item.id, e.target.value)}
                      placeholder="—"
                      className={cn(
                        "w-20 h-8 text-center text-sm mx-auto",
                        status === "divergent" && "border-destructive ring-1 ring-destructive/30",
                        status === "ok" && "border-green-500 ring-1 ring-green-500/30"
                      )}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    {diff !== null && diff !== 0 && (
                      <Badge className={cn(
                        "text-xs",
                        diff > 0 ? "bg-blue-500" : "bg-destructive"
                      )}>
                        {diff > 0 ? "+" : ""}{diff}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {status === "pending" && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    {status === "ok" && !isConfirmed && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-green-600 hover:text-green-700"
                        onClick={() => confirmItem(item.id)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        OK
                      </Button>
                    )}
                    {status === "ok" && isConfirmed && (
                      <Badge variant="outline" className="text-xs border-green-500 text-green-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Conferido
                      </Badge>
                    )}
                    {status === "divergent" && (
                      <Badge variant="outline" className="text-xs border-destructive text-destructive">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Recontar
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {filteredItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {countItems.length === 0 ? "Nenhum item para conferir" : "Nenhum resultado encontrado"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Divergence alert */}
      {stats.divergent > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">
                {stats.divergent} item(ns) com divergência na conferência
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                A quantidade conferida manualmente não bate com a bipagem. Recomenda-se recontar esses itens antes de prosseguir com a correção de estoque.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
