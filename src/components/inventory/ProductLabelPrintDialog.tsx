import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Printer, Tag } from "lucide-react";
import { toast } from "sonner";
import JsBarcode from "jsbarcode";
import { buildA4Pages, sheetCount, SHEETS, A4_27, type A4Layout, type SheetId, type SheetSpec } from "@/lib/labels/a4Sheet";
import {
  buildStockLabelItems, fillableLabelQuantity, isExpiredLabelCount,
  parseLabelQuantity, previewStockAfter, type StockLabelMode, type StockLabelScope,
} from "@/lib/labels/stockLabelBatch";
import { applyStockLabelBatch, fetchVariantCodes, loadStockLabelPreview } from "@/lib/labels/stockLabelApi";
import { useTeamIdentity } from "@/hooks/chat/useTeamIdentity";

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
  masterId?: string | null;
}

interface Props {
  masterId?: string | null;
  /** Permite abrir pelo SKU-pai no catálogo unificado e carregar as variações reais. */
  masterSku?: string | null;
  productName?: string;
  items?: LabelItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Variant = LabelItem;
type Format = SheetId | "old";
interface StorePreview {
  stock: number;
  pending: number;
  posProductId: string | null;
  code: string | null;
}
interface ApplyResult {
  batch_id: string;
  numero: number;
  labels: number;
  changed: number;
  total_delta: number;
  skipped?: Array<{ code: string; reason: string }>;
}

const STORES = [
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro" },
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Perola" },
];
const FORMAT_KEY = "label-format-v1";

export function loadLabelFormat(): Format {
  try {
    const v = localStorage.getItem(FORMAT_KEY);
    if (v === "a4" || v === "letter30" || v === "old") return v;
  } catch { /* ignore */ }
  // Sem preferência salva: padrão é o papel Carta de 30 etiquetas.
  return "letter30";
}
function saveLabelFormat(f: Format) { try { localStorage.setItem(FORMAT_KEY, f); } catch { /* ignore */ } }
/** Último modelo de folha usado (reimpressão); "old" cai no A4. */
export function loadLabelSheet(): SheetSpec {
  const f = loadLabelFormat();
  return f === "letter30" ? SHEETS.letter30 : A4_27;
}

export function loadLabelLayout(sheet: SheetSpec = A4_27): A4Layout {
  try {
    const raw = localStorage.getItem(sheet.layoutKey);
    if (raw) return { ...sheet.defaultLayout, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return sheet.defaultLayout;
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
  if (!w) { toast.error("Pop-up bloqueado. Permita pop-ups para imprimir."); return false; }
  w.document.write(html);
  w.document.close();
  return true;
}

const LETTER30_CSS = `
  @page { size: 215.9mm 279.4mm; margin: 0; }
  .page { width: 215.9mm; height: 279.4mm; }
  .cell { width: 66.7mm; height: 25.4mm; padding: 1.5mm 2.5mm; }
  .nm { font-size: 7.5pt; line-height: 1.15; }
  .row2 { margin-top: 0.3mm; }
  .cd { font-size: 14pt; }
  .vt { font-size: 7.5pt; }
  .row3 { gap: 1mm; }
  .bc { height: 7.5mm; max-width: 80%; min-width: 0; }
  .pr { font-size: 7.5pt; }`;

function a4Html(cells: string[], title: string, layout: A4Layout, start: number, testOutline = false, sheet: SheetSpec = A4_27) {
  const pages = buildA4Pages(cells, start, layout, testOutline, sheet);
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
  .num { font-size: 10pt; font-weight: 700; margin: auto; }${sheet.id === "letter30" ? LETTER30_CSS : ""}
</style></head><body>${pages}
<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`;
}

/** Reimpressão A4 pura: não consulta nem altera estoque e nunca cria lote. */
export function printA4VariantLabels({
  items,
  quantities,
  title,
  fallbackProductName = "",
  fallbackPrice = null,
  showPrice = false,
  startPos = 1,
  sheet = loadLabelSheet(),
  layout,
}: {
  items: LabelItem[];
  quantities: Record<string, number>;
  title: string;
  fallbackProductName?: string;
  fallbackPrice?: number | null;
  showPrice?: boolean;
  startPos?: number;
  layout?: A4Layout;
  sheet?: SheetSpec;
}) {
  const cells: string[] = [];
  const bcCache = new Map<string, string>();
  for (const v of items) {
    const n = quantities[v.id] || 0;
    if (n <= 0 || !v.code) continue;
    const code = v.code;
    if (!bcCache.has(code)) bcCache.set(code, makeBarcodeDataUrl(code, true));
    const vt = [v.color, v.size].filter(Boolean).join(" · ");
    const price = v.price ?? fallbackPrice;
    const html = `<div class="nm">${escapeHtml(v.name || fallbackProductName)}</div>
      <div class="row2"><span class="cd">${escapeHtml(code)}</span><span class="vt">${escapeHtml(vt)}</span></div>
      <div class="row3"><img class="bc" src="${bcCache.get(code)}" />${showPrice && price ? `<span class="pr">${brl(Number(price))}</span>` : ""}</div>`;
    for (let i = 0; i < n; i++) cells.push(html);
  }
  if (!cells.length) { toast.error("Nenhuma etiqueta com código para imprimir."); return false; }
  return openPrint(a4Html(cells, title, layout ?? loadLabelLayout(sheet), startPos, false, sheet));
}

export function ProductLabelPrintDialog({ masterId, masterSku, productName, items, open, onOpenChange }: Props) {
  const { senderName } = useTeamIdentity();
  const [loading, setLoading] = useState(false);
  const [master, setMaster] = useState<{ name: string; sku_root: string; sale_price: number | null } | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [format, setFormatState] = useState<Format>(loadLabelFormat);
  const sheet: SheetSpec = format === "letter30" ? SHEETS.letter30 : A4_27;
  const isSheet = format !== "old";
  const [storeId, setStoreId] = useState("");
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [storePreview, setStorePreview] = useState<Record<string, StorePreview> | null>(null);
  const [filling, setFilling] = useState(false);
  const [startPos, setStartPos] = useState(1);
  const [showPrice, setShowPrice] = useState(false);
  const [layout, setLayout] = useState<A4Layout>(() => loadLabelLayout(loadLabelSheet()));
  const setFormat = (f: Format) => {
    setFormatState(f);
    saveLabelFormat(f);
    const sp = f === "letter30" ? SHEETS.letter30 : A4_27;
    setLayout(loadLabelLayout(sp));
    setStartPos((p) => Math.min(sp.perSheet, p));
  };
  const [mode, setMode] = useState<StockLabelMode>("print_only");
  const [scope, setScope] = useState<StockLabelScope>("selected");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const previewRequest = useRef(0);

  const updateLayout = (k: keyof A4Layout, v: number) => {
    setLayout((p) => {
      const next = { ...p, [k]: Number.isFinite(v) ? v : 0 };
      try { localStorage.setItem(sheet.layoutKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const attachCodes = async (list: Variant[]) => {
    const map = await fetchVariantCodes(list.map((v) => v.id));
    return list.map((v) => ({ ...v, code: map.get(v.id) || v.code || null }));
  };

  const load = useCallback(async () => {
    previewRequest.current += 1;
    setStorePreview(null); setStoreId(""); setOpenedAt(null); setStartPos(1);
    setMode("print_only"); setScope("selected"); setConfirmOpen(false);
    setLoading(true);
    try {
      let list: Variant[] = [];
      if (items && !masterId && !masterSku) {
        setMaster({ name: productName || "", sku_root: "", sale_price: null });
        list = items;
      } else if (masterId || masterSku) {
        let query = supabase.from("products_master").select("id, name, sku_root, sale_price");
        const { data: m, error: masterError } = masterId
          ? await query.eq("id", masterId).single()
          : await query.eq("sku_root", masterSku!).single();
        if (masterError) throw masterError;
        setMaster(m as any);
        const resolvedMasterId = (m as any).id as string;
        const { data: vs, error: variantsError } = await supabase.from("product_variants").select("id, sku, gtin, size, color")
          .eq("master_id", resolvedMasterId).eq("is_active", true).order("size");
        if (variantsError) throw variantsError;
        list = ((vs || []) as Variant[]).map((v) => ({
          ...v, name: (m as any)?.name, price: (m as any)?.sale_price ?? null, masterId: resolvedMasterId,
        }));
      } else return;
      list = await attachCodes(list);
      setVariants(list);
      setQty(Object.fromEntries(list.map((v) => [v.id, ""])));
    } catch (e: any) {
      toast.error("Erro ao carregar: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [masterId, masterSku, items, productName]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const loadStorePreview = useCallback(async (id: string) => {
    if (!id) return;
    const request = ++previewRequest.current;
    setStoreId(id);
    setFilling(true);
    try {
      const masterIds = Array.from(new Set(variants.map((v) => v.masterId).filter(Boolean))) as string[];
      const { openedAt: now, preview: next } = await loadStockLabelPreview(masterIds, id);
      if (request !== previewRequest.current) return;
      setOpenedAt(now);
      setStorePreview(next);
      setVariants((current) => current.map((v) => next[v.id]?.code ? { ...v, code: next[v.id].code } : v));
    } catch (e: any) {
      if (request === previewRequest.current) {
        setOpenedAt(null);
        setStorePreview(null);
        toast.error("Erro ao ler saldo: " + e.message);
      }
    } finally {
      if (request === previewRequest.current) setFilling(false);
    }
  }, [variants]);

  const setQ = (id: string, value: string) => {
    if (value !== "" && !/^\d+$/.test(value)) return;
    setQty((p) => ({ ...p, [id]: value }));
  };
  const numericQty = useMemo(() => Object.fromEntries(
    Object.entries(qty).map(([id, value]) => [id, parseLabelQuantity(value) || 0])
  ), [qty]);
  const totalLabels = Object.values(numericQty).reduce((a, b) => a + b, 0);
  const totalSheets = sheetCount(totalLabels, startPos, sheet);
  const variantIds = useMemo(() => variants.map((v) => v.id), [variants]);
  const masterIds = useMemo(() => Array.from(new Set(variants.map((v) => v.masterId).filter(Boolean))) as string[], [variants]);
  const singleProduct = masterIds.length === 1;
  const batchItems = useMemo(
    () => buildStockLabelItems(variantIds, qty, mode, scope),
    [variantIds, qty, mode, scope],
  );

  useEffect(() => { if (!singleProduct && scope === "product") setScope("selected"); }, [singleProduct, scope]);

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

  function fillFromStore() {
    if (!storePreview) return;
    const next = { ...qty };
    for (const v of variants) {
      const preview = storePreview[v.id];
      next[v.id] = String(fillableLabelQuantity(preview?.stock || 0, preview?.pending || 0));
    }
    setQty(next);
  }

  function printA4() {
    if (totalLabels === 0) { toast.error("Informe a quantidade de etiquetas."); return; }
    const missing = variants.filter((v) => (numericQty[v.id] || 0) > 0 && !v.code);
    if (missing.length) { toast.error(`${missing.length} variação(ões) sem código. Tente de novo em instantes.`); return; }
    printA4VariantLabels({
      items: variants,
      quantities: numericQty,
      title: `Etiquetas — ${master?.name || productName || ""}`,
      fallbackProductName: master?.name || productName || "",
      fallbackPrice: master?.sale_price,
      showPrice,
      startPos,
      layout,
      sheet,
    });
  }

  function printTest() {
    const cells = Array.from({ length: sheet.perSheet }, (_, i) => `<div class="num">${i + 1}</div>`);
    openPrint(a4Html(cells, "Folha de teste", layout, 1, true, sheet));
  }

  function printOld() {
    if (totalLabels === 0) { toast.error("Informe a quantidade de etiquetas."); return; }
    const labelsHtml: string[] = [];
    for (const v of variants) {
      const count = numericQty[v.id] || 0;
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
<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`);
  }

  function printNow() {
    if (isSheet) printA4();
    else printOld();
  }

  async function applyBatch(applyMode: StockLabelMode) {
    if (!storeId) {
      if (applyMode === "print_only") printNow();
      else toast.error("Escolha a loja antes de aplicar o estoque.");
      return;
    }
    if (!openedAt || !storePreview) {
      toast.error("Aguarde o saldo da loja carregar.");
      return;
    }
    setApplying(true);
    try {
      const itemsToApply = buildStockLabelItems(variantIds, qty, applyMode, scope);
      const result = await applyStockLabelBatch({
        storeId, mode: applyMode, items: itemsToApply, openedAt,
        masterId: singleProduct ? masterIds[0] : undefined, scope, userName: senderName || undefined,
      });
      const skipped = result.skipped || [];
      if (applyMode === "print_only") {
        toast.success(`Impressão registrada no lote #${result.numero}.`);
      } else {
        toast.success(`Lote #${result.numero} aplicado: ${result.changed || 0} itens alterados.`);
      }
      if (skipped.length) {
        toast.warning("Algumas variações foram ignoradas.", {
          description: skipped.map((s) => `${s.code}: ${s.reason}`).join("\n"),
          duration: 10000,
        });
      }
      setConfirmOpen(false);
      printNow();
      if (applyMode !== "print_only") void loadStorePreview(storeId);
    } catch (e: any) {
      const message = e?.message || "Erro ao aplicar o lote.";
      toast.error(message);
      if (isExpiredLabelCount(message)) await loadStorePreview(storeId);
    } finally {
      setApplying(false);
    }
  }

  function handlePrint() {
    if (totalLabels === 0) { toast.error("Informe a quantidade de etiquetas."); return; }
    if (mode === "print_only") void applyBatch("print_only");
    else if (!storeId) toast.error("Escolha a loja antes de aplicar o estoque.");
    else setConfirmOpen(true);
  }

  const confirmationRows = batchItems.map((item) => {
    const variant = variants.find((v) => v.id === item.variant_id)!;
    const preview = storePreview?.[item.variant_id];
    const after = mode === "print_only" ? null : previewStockAfter(
      mode,
      preview?.stock || 0,
      preview?.pending || 0,
      item.qty,
    );
    return { item, variant, preview, after };
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(value) => { if (!applying) onOpenChange(value); }}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl"><Tag className="h-6 w-6" /> Imprimir Etiquetas</DialogTitle>
            {master && (
              <DialogDescription className="text-base text-foreground/80">
                <span className="font-bold text-foreground">{master.name}</span>
                <span className="ml-2 font-mono text-sm font-semibold text-foreground">{master.sku_root}</span>
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-foreground">Formato</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
                <SelectTrigger className="h-11 text-base font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="letter30">Carta – 30 por folha (66,7 × 25,4 mm)</SelectItem>
                  <SelectItem value="a4">A4 – 27 por folha (63,5 × 31 mm)</SelectItem>
                  <SelectItem value="old">8 × 5 cm (antigo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-foreground">Loja {mode !== "print_only" && <span className="text-destructive">*</span>}</Label>
              <Select value={storeId} onValueChange={(value) => void loadStorePreview(value)} disabled={filling || variants.length === 0}>
                <SelectTrigger className="h-11 text-base font-medium"><SelectValue placeholder={filling ? "Carregando saldo…" : "Escolher loja"} /></SelectTrigger>
                <SelectContent>{STORES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-foreground">O que fazer ao confirmar</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as StockLabelMode)}>
                <SelectTrigger className="h-11 text-base font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="print_only">Só imprimir</SelectItem>
                  <SelectItem value="balance">Imprimir + Balanço (o saldo vira o que contei)</SelectItem>
                  <SelectItem value="add">Imprimir + Adicionar ao estoque (chegada de mercadoria)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === "balance" ? (
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-foreground">Abrangência do balanço</Label>
                <Select value={scope} onValueChange={(value) => setScope(value as StockLabelScope)} disabled={!singleProduct}>
                  <SelectTrigger className="h-11 text-base font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="selected">Só as cores/tamanhos que preenchi</SelectItem>
                    {singleProduct && <SelectItem value="product">Produto inteiro — o que eu não preencher vira 0</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex items-end">
                <Button variant="outline" onClick={fillFromStore} disabled={!storePreview || filling} className="w-full">
                  Preencher com o saldo da loja
                </Button>
              </div>
            )}
          </div>

          {mode === "balance" && (
            <div className="space-y-2">
              <p className="rounded-md border-2 border-primary/60 bg-primary/10 p-3 text-base font-semibold text-foreground">
                Conte TODOS os pares desta loja, inclusive os já separados para envio. O sistema desconta sozinho os vendidos aguardando envio. Não conclua expedição deste produto enquanto conta.
              </p>
              <Button variant="outline" size="sm" onClick={fillFromStore} disabled={!storePreview || filling}>
                Preencher com o saldo da loja
              </Button>
            </div>
          )}

          {isSheet && (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-6 items-end">
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-foreground">Começar na posição</Label>
                <Input type="number" min={1} max={sheet.perSheet} className="h-11 text-base font-semibold" value={startPos}
                  onChange={(e) => setStartPos(Math.min(sheet.perSheet, Math.max(1, parseInt(e.target.value) || 1)))} />
              </div>
              {([["top", "Margem sup. (mm)"], ["left", "Margem esq. (mm)"], ["colGap", "Entre colunas"], ["rowGap", "Entre linhas"]] as const).map(([k, l]) => (
                <div key={k} className="space-y-1">
                  <Label className="text-sm font-semibold text-foreground">{l}</Label>
                  <Input type="number" step="0.1" className="h-11 text-base font-semibold" value={layout[k]} onChange={(e) => updateLayout(k, parseFloat(e.target.value))} />
                </div>
              ))}
              <label className="flex h-11 items-center gap-2 text-base font-semibold text-foreground">
                <Checkbox className="h-5 w-5 border-2" checked={showPrice} onCheckedChange={(v) => setShowPrice(!!v)} /> Mostrar preço
              </label>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : variants.length === 0 ? (
            <div className="py-12 text-center text-base font-medium text-foreground/70">Nenhuma variação ativa para este produto.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border-2 border-foreground/20">
              <table className="w-full text-base">
                <thead>
                  <tr className="bg-secondary">
                    <th className="p-3 text-left text-base font-bold text-secondary-foreground">Cor</th>
                    {grid.sizes.map((s) => <th key={s} className="p-3 text-center text-base font-bold text-secondary-foreground">{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 align-top">
                        {multiProduct && <div className="max-w-[180px] truncate text-sm font-semibold text-foreground/80">{r.product}</div>}
                        <div className="text-base font-bold text-foreground">{r.label}</div>
                      </td>
                      {grid.sizes.map((s) => {
                        const v = r.cells[s];
                        if (!v) return <td key={s} className="p-2 text-center text-lg font-semibold text-foreground/60">—</td>;
                        const preview = storePreview?.[v.id];
                        return (
                          <td key={s} className="p-1 text-center align-top">
                            <Input type="number" min="0" step="1" value={qty[v.id] ?? ""} onChange={(e) => setQ(v.id, e.target.value)}
                              placeholder="—" className="mx-auto h-10 w-20 border-2 text-center text-base font-bold text-foreground" aria-label={`Quantidade ${v.code || v.sku}`} />
                            <div className="mt-1 inline-block rounded bg-secondary px-1.5 py-0.5 font-mono text-sm font-bold text-secondary-foreground">{v.code || "sem código"}</div>
                            {storePreview && <div className="mt-1 text-sm font-semibold text-foreground">saldo {preview?.stock ?? 0}</div>}
                            {!!preview?.pending && <div className="mt-1 rounded-md border border-primary/70 bg-primary/25 px-1.5 py-1 text-sm font-extrabold leading-snug text-foreground">+{preview.pending} vendido(s) aguardando envio</div>}
                            {storePreview && !preview?.posProductId && <div className="mt-1 text-sm font-bold text-destructive">sem cadastro nesta loja</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {format === "letter30" && (
            <p className="rounded-md border-2 border-primary/60 bg-primary/10 p-2 text-sm font-semibold text-foreground">
              No diálogo de impressão escolha papel Carta (Letter), escala 100% e margens Nenhuma.
            </p>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2 items-stretch sm:items-center sm:justify-between">
            <span className="text-base font-semibold text-foreground">
              Total: <strong className="text-lg">{totalLabels}</strong> etiqueta(s)
              {isSheet && <> · <strong className="text-lg">{totalSheets}</strong> folha(s)</>}
            </span>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setQty(Object.fromEntries(variants.map((v) => [v.id, ""])))}>Limpar campos</Button>
              {isSheet && <Button variant="outline" onClick={printTest}>Imprimir folha de teste</Button>}
              <Button onClick={handlePrint} disabled={totalLabels === 0 || applying || filling}>
                {applying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Printer className="h-4 w-4 mr-1" />}
                {mode === "print_only" ? "Imprimir" : "Conferir e imprimir"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(value) => { if (!applying) setConfirmOpen(value); }}>
        <AlertDialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">Conferir antes de aplicar</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground/80">
              Esta é apenas a prévia. O banco calcula e grava o saldo definitivo ao confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            {confirmationRows.map(({ item, variant, preview, after }) => (
              <div key={item.variant_id} className="flex items-start justify-between gap-3 rounded-md border-2 p-3 text-base">
                <div>
                  <div className="font-mono text-base font-bold text-foreground">{variant.code || variant.sku}</div>
                  <div className="text-sm font-semibold text-foreground/80">{[variant.color, variant.size].filter(Boolean).join(" · ")}</div>
                  {!preview?.posProductId && <div className="text-sm font-bold text-destructive">Sem cadastro nesta loja: será ignorada.</div>}
                </div>
                <div className="whitespace-nowrap text-right text-lg font-bold text-foreground">
                  saldo {preview?.stock ?? 0} → {after}
                  <div className="text-sm font-semibold text-foreground/80">{item.qty} etiqueta(s){mode === "balance" ? ` · ${preview?.pending || 0} pendente(s)` : ""}</div>
                </div>
              </div>
            ))}
          </div>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel disabled={applying}>Cancelar</AlertDialogCancel>
            <Button variant="outline" disabled={applying} onClick={() => void applyBatch("print_only")}>Só imprimir</Button>
            <Button disabled={applying} onClick={() => void applyBatch(mode)}>
              {applying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Imprimir e aplicar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
