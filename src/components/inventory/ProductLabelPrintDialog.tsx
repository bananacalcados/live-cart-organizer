import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Printer, Tag, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import JsBarcode from "jsbarcode";

export interface LabelItem {
  id: string;
  sku: string;
  gtin: string | null;
  size: string | null;
  color: string | null;
}

interface Props {
  /** Modo catálogo legacy: carrega variações por master. */
  masterId?: string | null;
  /** Modo direto (catálogo unificado): passa itens e nome já prontos. */
  productName?: string;
  items?: LabelItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Variant = LabelItem;

/** Gera o código de barras como dataURL (PNG) usando JsBarcode. */
function makeBarcodeDataUrl(code: string): string {
  try {
    const canvas = document.createElement("canvas");
    // EAN-13 quando tiver 13 dígitos, senão CODE128 (cobre SKU alfanumérico).
    const isEan13 = /^\d{13}$/.test(code);
    JsBarcode(canvas, code, {
      format: isEan13 ? "EAN13" : "CODE128",
      width: 2,
      height: 60,
      displayValue: true,
      fontSize: 14,
      margin: 4,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function escapeHtml(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c)
  );
}

export function ProductLabelPrintDialog({ masterId, productName, items, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [master, setMaster] = useState<{ name: string; sku_root: string } | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    // Modo direto: usa os itens fornecidos.
    if (items && items.length >= 0 && !masterId) {
      setMaster({ name: productName || "", sku_root: "" });
      setVariants(items);
      const initQty: Record<string, number> = {};
      items.forEach((v) => (initQty[v.id] = 1));
      setQty(initQty);
      return;
    }
    if (!masterId) return;
    setLoading(true);
    try {
      const { data: m } = await supabase
        .from("products_master")
        .select("name, sku_root")
        .eq("id", masterId)
        .single();
      setMaster(m as any);

      const { data: vs } = await supabase
        .from("product_variants")
        .select("id, sku, gtin, size, color")
        .eq("master_id", masterId)
        .eq("is_active", true)
        .order("size");
      const list = (vs || []) as Variant[];
      setVariants(list);
      const initQty: Record<string, number> = {};
      list.forEach((v) => (initQty[v.id] = 1));
      setQty(initQty);
    } catch (e: any) {
      toast.error("Erro ao carregar: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [masterId, items, productName]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);


  const setQ = (id: string, val: number) =>
    setQty((p) => ({ ...p, [id]: Math.max(0, val) }));

  const totalLabels = Object.values(qty).reduce((a, b) => a + (b || 0), 0);

  function handlePrint() {
    if (totalLabels === 0) {
      toast.error("Informe a quantidade de etiquetas.");
      return;
    }
    const labelsHtml: string[] = [];
    for (const v of variants) {
      const count = qty[v.id] || 0;
      if (count <= 0) continue;
      const code = (v.gtin && v.gtin.trim()) || v.sku;
      const barcode = makeBarcodeDataUrl(code);
      const variantParts = [v.size, v.color].filter(Boolean).join(" · ");
      for (let i = 0; i < count; i++) {
        labelsHtml.push(`
          <div class="label">
            <div class="name">${escapeHtml(master?.name || "")}</div>
            ${variantParts ? `<div class="variant">${escapeHtml(variantParts)}</div>` : ""}
            ${barcode ? `<img class="barcode" src="${barcode}" />` : `<div class="code">${escapeHtml(code)}</div>`}
          </div>
        `);
      }
    }

    const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Etiquetas — ${escapeHtml(master?.name || "")}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .sheet {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 2mm;
  }
  .label {
    width: 80mm;
    height: 50mm;
    border: 0.3mm dashed #bbb;
    padding: 3mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .name {
    font-size: 11pt;
    font-weight: 700;
    line-height: 1.15;
    max-height: 12mm;
    overflow: hidden;
  }
  .variant {
    font-size: 10pt;
    font-weight: 600;
    margin-top: 1mm;
    color: #222;
  }
  .barcode { margin-top: 2mm; max-width: 72mm; max-height: 22mm; }
  .code { margin-top: 2mm; font-family: monospace; font-size: 10pt; }
  @media print { .label { border-color: #ddd; } }
</style></head>
<body>
  <div class="sheet">${labelsHtml.join("")}</div>
  <script>
    window.onload = function () { setTimeout(function () { window.print(); }, 300); };
  </script>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Pop-up bloqueado. Permita pop-ups para imprimir.");
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Imprimir Etiquetas
          </DialogTitle>
          {master && (
            <DialogDescription>
              <span className="font-medium text-foreground">{master.name}</span>
              <span className="ml-2 font-mono text-xs">{master.sku_root}</span>
              <span className="block text-xs mt-1">
                Etiqueta 8cm × 5cm · folha A4 (10 por página) · código de barras p/ bipagem.
              </span>
            </DialogDescription>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : variants.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Nenhuma variação ativa para este produto.
          </div>
        ) : (
          <div className="space-y-2">
            {variants.map((v) => {
              const code = (v.gtin && v.gtin.trim()) || v.sku;
              const variantParts = [v.size, v.color].filter(Boolean).join(" · ");
              return (
                <Card key={v.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {v.size && <Badge variant="secondary">{v.size}</Badge>}
                        {v.color && <Badge variant="outline">{v.color}</Badge>}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground mt-1 truncate">
                        {v.gtin ? `GTIN: ${v.gtin}` : `SKU: ${v.sku}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7"
                        onClick={() => setQ(v.id, (qty[v.id] || 0) - 1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min="0"
                        value={qty[v.id] ?? 0}
                        onChange={(e) => setQ(v.id, parseInt(e.target.value) || 0)}
                        className="h-8 w-16 text-center"
                      />
                      <Button size="icon" variant="outline" className="h-7 w-7"
                        onClick={() => setQ(v.id, (qty[v.id] || 0) + 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 items-stretch sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            Total: <strong>{totalLabels}</strong> etiqueta(s)
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button onClick={handlePrint} disabled={totalLabels === 0}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
