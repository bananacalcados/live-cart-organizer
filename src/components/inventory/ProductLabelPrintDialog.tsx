import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Printer, Tag } from "lucide-react";
import { toast } from "sonner";
import JsBarcode from "jsbarcode";
import { buildA4Pages, LABELS_PER_SHEET, type A4Layout } from "@/lib/labels/a4Sheet";

export interface LabelItem {
  id: string;
  sku: string;
  gtin: string | null;
  size: string | null;
  color: string | null;
  /** Nome do produto (modo em massa). */
  name?: string | null;
  price?: number | null;
  code?: string | null;
}

interface Props {
  masterId?: string | null;
  productName?: string;
  items?: LabelItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Variant = LabelItem;
type Format = "a4" | "old";

const STORES = [
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro" },
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Perola" },
];
const LAYOUT_KEY = "label-a4-layout-v1";
const DEFAULT_LAYOUT: A4Layout = { top: 9, left: 7.2, colGap: 2.5, rowGap: 0 };

function loadLayout(): A4Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

function makeBarcodeDataUrl(code: string, crisp = false): string {
  try {
    const canvas = document.createElement("canvas");
    if (crisp) {
      JsBarcode(canvas, code, { format: "CODE128", width: 3, height: 90, displayValue: false, margin: 0, lineColor: "#000", background: "#fff" });
    } else {
      const isEan13 = /^\d{13}$/.test(code);
      JsBarcode(canvas, code, { format: isEan13 ? "EAN13" : "CODE128", width: 2, height: 60, displayValue: true, fontSize: 14, margin: 4 });
    }
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

const sizeSort = (a: string, b: string) => {
  const na = parseFloat(a), nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
};

const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function openPrint(html: string) {
  const w = window.open("", "_blank");
  if (!w) { toast.error("Pop-up bloqueado. Permita pop-ups para imprimir."); return; }
  w.document.write(html);
  w.document.close();
}

export function ProductLabelPrintDialog({ masterId, productName, items, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [master, setMaster] = useState<{ name: string; sku_root: string; sale_price: number | null } | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [format, setFormat] = useState<Format>("a4");
  const [storeId, setStoreId] = useState<string>("");
  const [storeStock, setStoreStock] = useState<Record<string, number> | null>(null);
  const [filling, setFilling] = useState(false);
  const [startPos, setStartPos] = useState(1);
  const [showPrice, setShowPrice] = useState(false);
  const [layout, setLayout] = useState<A4Layout>(loadLayout);

  const updateLayout = (k: keyof A4Layout, v: number) => {
    setLayout((p) => {
      const next = { ...p, [k]: Number.isFinite(v) ? v : 0 };
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const attachCodes = async (list: Variant[]) => {
    const ids = list.map((v) => v.id);
    const map = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await (supabase.from("product_variant_codes" as any) as any)
        .select("variant_id, code").in("variant_id", ids.slice(i, i + 200));
      (data || []).forEach((r: any) => map.set(r.variant_id, r.code));
    }
    return list.map((v) => ({ ...v, code: map.get(v.id) || v.code || null }));
  };

  const load = useCallback(async () => {
    setStoreStock(null); setStoreId(""); setStartPos(1);
    setLoading(true);
    try {
      let list: Variant[] = [];
      if (items && !masterId) {
        setMaster({ name: productName || "", sku_root: "", sale_price: null });
        list = items;
      } else if (masterId) {
        const { data: m } = await supabase.from("products_master").select("name, sku_root, sale_price").eq("id", masterId).single();
        setMaster(m as any);
        const { data: vs } = await supabase.from("product_variants").select("id, sku, gtin, size, color")
          .eq("master_id", masterId).eq("is_active", true).order("size");
        list = ((vs || []) as Variant[]).map((v) => ({ ...v, name: (m as any)?.name, price: (m as any)?.sale_price ?? null }));
      } else return;
      list = await attachCodes(list);
      setVariants(list);
      const init: Record<string, number> = {};
      list.forEach((v) => (init[v.id] = 0));
      setQty(init);
    } catch (e: any) {
      toast.error("Erro ao carregar: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [masterId, items, productName]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const setQ = (id: string, val: number) => setQty((p) => ({ ...p, [id]: Math.max(0, val || 0) }));
  const totalLabels = Object.values(qty).reduce((a, b) => a + (b || 0), 0);
  const totalSheets = totalLabels > 0 ? Math.ceil((totalLabels + startPos - 1) / LABELS_PER_SHEET) : 0;

  // Grade: linhas = (produto) + cor; colunas = tamanhos.
  const grid = useMemo(() => {
    const sizes = Array.from(new Set(variants.map((v) => v.size || "—"))).sort(sizeSort);
    const rows = new Map<string, { label: string; product: string; cells: Record<string, Variant> }>();
    for (const v of variants) {
      const key = `${v.name || ""}|${v.color || "—"}`;
      if (!rows.has(key)) rows.set(key, { label: v.color || "—", product: v.name || "", cells: {} });
      rows.get(key)!.cells[v.size || "—"] = v;
    }
    return { sizes, rows: Array.from(rows.values()) };
  }, [variants]);
  const multiProduct = new Set(variants.map((v) => v.name || "")).size > 1;

  async function fillFromStore(id: string) {
    setStoreId(id);
    setFilling(true);
    try {
      const gtins = Array.from(new Set(variants.map((v) => v.gtin?.trim()).filter(Boolean))) as string[];
      const skus = Array.from(new Set(variants.filter((v) => !v.gtin?.trim()).map((v) => v.sku).filter(Boolean)));
      const byBarcode = new Map<string, number>(); const bySku = new Map<string, number>();
      for (let i = 0; i < gtins.length; i += 150) {
        const { data } = await supabase.from("pos_products").select("barcode, stock").eq("store_id", id).in("barcode", gtins.slice(i, i + 150));
        (data || []).forEach((r: any) => byBarcode.set(r.barcode, (byBarcode.get(r.barcode) || 0) + Number(r.stock || 0)));
      }
      for (let i = 0; i < skus.length; i += 150) {
        const { data } = await supabase.from("pos_products").select("sku, stock").eq("store_id", id).in("sku", skus.slice(i, i + 150));
        (data || []).forEach((r: any) => bySku.set(r.sku, (bySku.get(r.sku) || 0) + Number(r.stock || 0)));
      }
      const stock: Record<string, number> = {};
      const nextQty: Record<string, number> = {};
      for (const v of variants) {
        const s = v.gtin?.trim() ? (byBarcode.get(v.gtin.trim()) ?? 0) : (bySku.get(v.sku) ?? 0);
        stock[v.id] = s;
        nextQty[v.id] = Math.max(0, Math.floor(s));
      }
      setStoreStock(stock);
      setQty(nextQty);
    } catch (e: any) {
      toast.error("Erro ao ler saldo: " + e.message);
    } finally {
      setFilling(false);
    }
  }

  function a4Html(cells: string[], title: string, testOutline = false, start = startPos) {
    const pages = buildA4Pages(cells, start, layout, testOutline);
    return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; color: #000; }
  html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; }
  .page { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .cell { position: absolute; width: 63.5mm; height: 31mm; padding: 2mm 2.5mm; overflow: hidden; display: flex; flex-direction: column; }
  .cell.outline { outline: 0.2mm solid #000; outline-offset: -0.1mm; }
  .nm { font-size: 8pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
  .row2 { display: flex; align-items: baseline; justify-content: space-between; gap: 1.5mm; margin-top: 0.5mm; }
  .cd { font-size: 16pt; font-weight: 900; line-height: 1; letter-spacing: -0.2pt; white-space: nowrap; }
  .vt { font-size: 8pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row3 { display: flex; align-items: flex-end; justify-content: space-between; margin-top: auto; }
  .bc { width: 80%; height: 9mm; image-rendering: pixelated; image-rendering: crisp-edges; display: block; }
  .pr { font-size: 8pt; font-weight: 900; white-space: nowrap; }
  .num { font-size: 10pt; font-weight: 700; margin: auto; }
</style></head><body>${pages}
<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script></body></html>`;
  }

  function printA4() {
    if (totalLabels === 0) { toast.error("Informe a quantidade de etiquetas."); return; }
    const missing = variants.filter((v) => (qty[v.id] || 0) > 0 && !v.code);
    if (missing.length) { toast.error(`${missing.length} variação(ões) sem código. Tente de novo em instantes.`); return; }
    const cells: string[] = [];
    const bcCache = new Map<string, string>();
    for (const v of variants) {
      const n = qty[v.id] || 0;
      if (n <= 0) continue;
      const code = v.code!;
      if (!bcCache.has(code)) bcCache.set(code, makeBarcodeDataUrl(code, true));
      const vt = [v.color, v.size].filter(Boolean).join(" · ");
      const price = v.price ?? master?.sale_price ?? null;
      const html = `<div class="nm">${escapeHtml(v.name || master?.name || "")}</div>
        <div class="row2"><span class="cd">${escapeHtml(code)}</span><span class="vt">${escapeHtml(vt)}</span></div>
        <div class="row3"><img class="bc" src="${bcCache.get(code)}" />${showPrice && price ? `<span class="pr">${brl(Number(price))}</span>` : ""}</div>`;
      for (let i = 0; i < n; i++) cells.push(html);
    }
    openPrint(a4Html(cells, `Etiquetas — ${master?.name || ""}`));
  }

  function printTest() {
    const cells = Array.from({ length: LABELS_PER_SHEET }, (_, i) => `<div class="num">${i + 1}</div>`);
    openPrint(a4Html(cells, "Folha de teste", true, 1));
  }

  function printOld() {
    if (totalLabels === 0) { toast.error("Informe a quantidade de etiquetas."); return; }
    const labelsHtml: string[] = [];
    for (const v of variants) {
      const count = qty[v.id] || 0;
      if (count <= 0) continue;
      const code = (v.gtin && v.gtin.trim()) || v.sku;
      const barcode = makeBarcodeDataUrl(code);
      const variantParts = [v.size, v.color].filter(Boolean).join(" · ");
      for (let i = 0; i < count; i++) {
        labelsHtml.push(`<div class="label"><div class="name">${escapeHtml(v.name || master?.name || "")}</div>
          ${variantParts ? `<div class="variant">${escapeHtml(variantParts)}</div>` : ""}
          ${barcode ? `<img class="barcode" src="${barcode}" />` : `<div class="code">${escapeHtml(code)}</div>`}</div>`);
      }
    }
    openPrint(`<!doctype html><html><head><meta charset="utf-8" /><title>Etiquetas — ${escapeHtml(master?.name || "")}</title>
<style>
  @page { size: A4; margin: 8mm; } * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .sheet { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 2mm; }
  .label { width: 80mm; height: 50mm; border: 0.3mm dashed #bbb; padding: 3mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; page-break-inside: avoid; }
  .name { font-size: 11pt; font-weight: 700; line-height: 1.15; max-height: 12mm; overflow: hidden; }
  .variant { font-size: 10pt; font-weight: 600; margin-top: 1mm; color: #222; }
  .barcode { margin-top: 2mm; max-width: 72mm; max-height: 22mm; }
  .code { margin-top: 2mm; font-family: monospace; font-size: 10pt; }
  @media print { .label { border-color: #ddd; } }
</style></head><body><div class="sheet">${labelsHtml.join("")}</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script></body></html>`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag className="h-5 w-5" /> Imprimir Etiquetas</DialogTitle>
          {master && (
            <DialogDescription>
              <span className="font-medium text-foreground">{master.name}</span>
              <span className="ml-2 font-mono text-xs">{master.sku_root}</span>
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Formato</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="a4">A4 – 27 por folha (63,5 × 31 mm)</SelectItem>
                <SelectItem value="old">8 × 5 cm (antigo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Preencher com o saldo da loja…</Label>
            <Select value={storeId} onValueChange={fillFromStore} disabled={filling || variants.length === 0}>
              <SelectTrigger className="h-9"><SelectValue placeholder={filling ? "Carregando…" : "Escolher loja"} /></SelectTrigger>
              <SelectContent>{STORES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {format === "a4" && (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-6 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Começar na posição</Label>
              <Input type="number" min={1} max={27} className="h-9" value={startPos}
                onChange={(e) => setStartPos(Math.min(27, Math.max(1, parseInt(e.target.value) || 1)))} />
            </div>
            {([["top", "Margem sup. (mm)"], ["left", "Margem esq. (mm)"], ["colGap", "Entre colunas"], ["rowGap", "Entre linhas"]] as const).map(([k, l]) => (
              <div key={k} className="space-y-1">
                <Label className="text-xs">{l}</Label>
                <Input type="number" step="0.1" className="h-9" value={layout[k]} onChange={(e) => updateLayout(k, parseFloat(e.target.value))} />
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm h-9">
              <Checkbox checked={showPrice} onCheckedChange={(v) => setShowPrice(!!v)} /> Mostrar preço
            </label>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : variants.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Nenhuma variação ativa para este produto.</div>
        ) : (
          <div className="overflow-x-auto border rounded">
            <table className="text-sm w-full">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left p-2 font-medium">Cor</th>
                  {grid.sizes.map((s) => <th key={s} className="p-2 font-medium text-center">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 align-top">
                      {multiProduct && <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{r.product}</div>}
                      <div className="font-medium">{r.label}</div>
                    </td>
                    {grid.sizes.map((s) => {
                      const v = r.cells[s];
                      if (!v) return <td key={s} className="p-1 text-center text-muted-foreground">—</td>;
                      return (
                        <td key={s} className="p-1 text-center align-top">
                          <Input type="number" min="0" value={qty[v.id] ?? 0} onChange={(e) => setQ(v.id, parseInt(e.target.value))}
                            className="h-8 w-16 text-center mx-auto" aria-label={`Quantidade ${v.code || v.sku}`} />
                          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{v.code || "sem código"}</div>
                          {storeStock && <div className="text-[10px] text-muted-foreground">saldo {storeStock[v.id] ?? 0}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 items-stretch sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            Total: <strong>{totalLabels}</strong> etiqueta(s)
            {format === "a4" && <> · <strong>{totalSheets}</strong> folha(s)</>}
          </span>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setQty(Object.fromEntries(variants.map((v) => [v.id, 0])))}>Zerar tudo</Button>
            {format === "a4" && <Button variant="outline" onClick={printTest}>Imprimir folha de teste</Button>}
            <Button onClick={format === "a4" ? printA4 : printOld} disabled={totalLabels === 0}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
