import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, FileText, Loader2, Search, Wand2, Hash, Palette } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProductColorAliasDialog } from "@/components/inventory/ProductColorAliasDialog";
import { ShopifyMissingColorsDialog } from "@/components/inventory/ShopifyMissingColorsDialog";

type CodeRow = {
  code: string;
  letter: string | null;
  master_id: string;
  product_name: string | null;
  color: string | null;
  category: string | null;
  sale_price: number | null;
  total_stock: number | null;
  shopify_ok: boolean | null;
  shopify_status: string | null;
  shopify_sizes_ok: number | null;
  shopify_sizes_total: number | null;
};

const STATUS_LABEL: Record<string, string> = {
  ok: "ok",
  partial_sizes: "tamanhos parciais",
  product_missing: "produto inativo/inexistente",
  not_published_lovable: "não publicado no Lovable",
  color_missing: "cor faltando",
  unlinked: "sem vínculo",
  pending_check: "aguardando checagem",
};
const STATUS_REASON: Record<string, string> = {
  product_missing: "O produto não foi encontrado na Shopify ou não está ativo lá.",
  not_published_lovable: "O produto existe na Shopify, mas não está publicado no canal Lovable.",
  color_missing: "Nenhum SKU desta cor do ERP foi encontrado no produto da Shopify.",
  unlinked: "Nenhum SKU deste produto do ERP foi encontrado na Shopify.",
  pending_check: "Ainda não foi verificado na Shopify.",
};
function ShopifyBadge({ r, sku }: { r: CodeRow; sku?: string }) {
  const st = r.shopify_status || "pending_check";
  if (st === "ok") return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">ok</Badge>;
  if (st === "partial_sizes") return <Badge className="bg-amber-400 text-amber-950 hover:bg-amber-400">{r.shopify_sizes_ok ?? 0} de {r.shopify_sizes_total ?? 0} tamanhos</Badge>;
  const showSku = st === "product_missing" || st === "color_missing";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help"><Badge variant="destructive">{STATUS_LABEL[st] || st}</Badge></span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{STATUS_REASON[st] || STATUS_LABEL[st] || st}</p>
          {showSku && <p className="mt-1">SKU de exemplo no ERP: <b>{sku || "sem SKU"}</b></p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
type Letter = { letter: string; label: string };

const PAGE = 50;
const COLS = "code,letter,master_id,product_name,color,category,sale_price,total_stock,shopify_ok,shopify_status,shopify_sizes_ok,shopify_sizes_total";
const brl = (v: number | null) =>
  `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normColor = (c: string | null) => (c ?? "").trim().toLowerCase();

export default function InventoryProductCodes() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [matchCodes, setMatchCodes] = useState<string[] | null>(null);
  const [letter, setLetter] = useState("all");
  const [onlyStock, setOnlyStock] = useState(false);
  const [onlyOk, setOnlyOk] = useState(true);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [syncing, setSyncing] = useState(false);
  const [warnAction, setWarnAction] = useState<null | (() => void)>(null);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [selected, setSelected] = useState<Map<string, CodeRow>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfMode, setPdfMode] = useState<"filtered" | "selected" | "stock">("filtered");
  const [exporting, setExporting] = useState(false);
  const [reload, setReload] = useState(0);
  const [exampleSku, setExampleSku] = useState<Record<string, string>>({});
  const [aliasOpen, setAliasOpen] = useState(false);

  // SKU de exemplo (1ª variação da cor) só para os códigos visíveis com problema: 1 consulta por página.
  useEffect(() => {
    const bad = rows.filter((r) => r.shopify_status === "product_missing" || r.shopify_status === "color_missing");
    if (!bad.length) { setExampleSku({}); return; }
    let cancel = false;
    supabase.from("product_variants").select("master_id,color,size,sku")
      .in("master_id", [...new Set(bad.map((r) => r.master_id))]).eq("is_active", true)
      .order("size").limit(1000)
      .then(({ data }) => {
        if (cancel) return;
        const out: Record<string, string> = {};
        for (const v of (data as any[]) ?? []) {
          const k = `${v.master_id}|${normColor(v.color)}`;
          if (!out[k] && v.sku) out[k] = v.sku;
        }
        setExampleSku(out);
      });
    return () => { cancel = true; };
  }, [rows]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [debounced, letter, onlyStock, onlyOk]);

  // Resumo por status (contagens no servidor).
  useEffect(() => {
    const sts = ["ok", "partial_sizes", "color_missing", "unlinked", "product_missing", "not_published_lovable", "pending_check"];
    Promise.all(sts.map((st) => (supabase.from("v_product_color_codes" as any).select("code", { count: "exact", head: true }) as any).eq("shopify_status", st)))
      .then((res) => setSummary(Object.fromEntries(sts.map((st, i) => [st, res[i].count ?? 0]))));
  }, [reload]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-shopify-mirror", { body: {} });
      if (error) throw error;
      toast.success(`Verificado: ${Object.entries((data as any)?.by_status || (data as any)?.counts || {}).map(([k, v]) => `${v} ${STATUS_LABEL[k] || k}`).join(" · ")}`);
      setReload((x) => x + 1);
    } catch (e: any) {
      toast.error("Erro ao verificar na Shopify: " + (e?.message || e));
    } finally { setSyncing(false); }
  };
  /** Sem o filtro "Somente ok", avisa antes de exportar. */
  const guardExport = (fn: () => void) => { if (onlyOk) fn(); else setWarnAction(() => fn); };

  useEffect(() => {
    supabase.from("product_code_letters").select("letter,label").order("letter").then(({ data }) => setLetters((data as Letter[]) ?? []));
  }, []);

  const buildQuery = (opts: { stock?: boolean; count?: boolean } = {}) => {
    let q: any = supabase.from("v_product_color_codes" as any).select(COLS, opts.count ? { count: "exact" } : undefined);
    // Busca flexível: sem acento, sem maiúsculas e tolerante a erro de digitação (resolvida no servidor).
    if (debounced) q = q.in("code", matchCodes && matchCodes.length ? matchCodes : ["__none__"]);
    if (letter !== "all") q = q.eq("letter", letter);
    if (onlyStock || opts.stock) q = q.gt("total_stock", 0);
    if (onlyOk) q = q.eq("shopify_ok", true);
    return q.order("letter").order("seq");
  };

  useEffect(() => {
    setMatchCodes(null);
    if (!debounced) return;
    let cancel = false;
    setLoading(true);
    (supabase.rpc as any)("search_product_code_keys", { p_query: debounced, p_limit: 200 })
      .then(({ data, error }: any) => {
        if (cancel) return;
        if (error) toast.error("Erro na busca: " + error.message);
        setMatchCodes(((data ?? []) as any[]).map((r) => (typeof r === "string" ? r : r.search_product_code_keys)));
      });
    return () => { cancel = true; };
  }, [debounced]);

  useEffect(() => {
    if (debounced && matchCodes === null) return;
    let cancel = false;
    setLoading(true);
    buildQuery({ count: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
      .then(({ data, count, error }: any) => {
        if (cancel) return;
        if (error) toast.error("Erro ao carregar códigos: " + error.message);
        setRows(data ?? []);
        setTotal(count ?? 0);
        setLoading(false);
      });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchCodes, letter, onlyStock, onlyOk, page, reload]);

  const fetchAll = async (stock = false): Promise<CodeRow[]> => {
    const out: CodeRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await buildQuery({ stock }).range(from, from + 999);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };

  const toggle = (r: CodeRow) => {
    setSelected(prev => {
      const m = new Map(prev);
      m.has(r.code) ? m.delete(r.code) : m.set(r.code, r);
      return m;
    });
  };
  const allPageSelected = rows.length > 0 && rows.every(r => selected.has(r.code));
  const togglePage = () => {
    setSelected(prev => {
      const m = new Map(prev);
      if (allPageSelected) rows.forEach(r => m.delete(r.code));
      else rows.forEach(r => m.set(r.code, r));
      return m;
    });
  };

  const generateMissing = async () => {
    setGenerating(true);
    try {
      const existing = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await (supabase.from("v_product_color_codes" as any).select("master_id,color") as any)
          .order("code").range(from, from + 999);
        if (error) throw error;
        (data ?? []).forEach((r: any) => existing.add(`${r.master_id}|${normColor(r.color)}`));
        if (!data || data.length < 1000) break;
      }
      const missing = new Map<string, { master_id: string; color: string | null }>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("product_variants").select("id,master_id,color,products_master!inner(is_active)")
          .eq("is_active", true).eq("products_master.is_active", true).order("id").range(from, from + 999);
        if (error) throw error;
        (data ?? []).forEach((v: any) => {
          const k = `${v.master_id}|${normColor(v.color)}`;
          if (!existing.has(k) && !missing.has(k)) missing.set(k, { master_id: v.master_id, color: v.color?.trim() || null });
        });
        if (!data || data.length < 1000) break;
      }
      let created = 0, failed = 0;
      for (const m of missing.values()) {
        const { error } = await (supabase.rpc as any)("ensure_product_color_code", { p_master_id: m.master_id, p_color: m.color });
        error ? failed++ : created++;
      }
      toast.success(`${created} código(s) criado(s)${failed ? ` · ${failed} com erro` : ""}`);
      setReload(x => x + 1);
    } catch (e: any) {
      toast.error("Erro ao gerar códigos: " + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await fetchAll();
      const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["Código", "Produto", "Cor", "Categoria", "Preço", "Estoque"].join(";"),
        ...all.map(r => [r.code, r.product_name, r.color, r.category,
          Number(r.sale_price ?? 0).toFixed(2).replace(".", ","), r.total_stock ?? 0].map(esc).join(";"))];
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `codigos-produto-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      toast.error("Erro ao exportar: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const list = pdfMode === "selected"
        ? Array.from(selected.values()).filter((r) => !onlyOk || r.shopify_ok === true)
        : await fetchAll(pdfMode === "stock");
      if (!list.length) { toast.error("Nenhum código para exportar"); return; }
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = 80, H = 50, GAP = 4, cols = 2, rowsPer = 5;
      const mx = (210 - (cols * W + (cols - 1) * GAP)) / 2;
      const my = (297 - (rowsPer * H + (rowsPer - 1) * GAP)) / 2;
      list.forEach((r, i) => {
        const pos = i % (cols * rowsPer);
        if (i > 0 && pos === 0) doc.addPage();
        const x = mx + (pos % cols) * (W + GAP);
        const y = my + Math.floor(pos / cols) * (H + GAP);
        doc.setDrawColor(200); doc.setLineWidth(0.1); doc.rect(x, y, W, H);
        doc.setFont("helvetica", "bold"); doc.setFontSize(64);
        doc.text(r.code, x + W / 2, y + 22, { align: "center" });
        doc.setFont("helvetica", "normal"); doc.setFontSize(9);
        const nameLines = doc.splitTextToSize(r.product_name ?? "", W - 6).slice(0, 2);
        doc.text(nameLines, x + 3, y + 30);
        let ny = y + 30 + nameLines.length * 3.8;
        if (r.color) { doc.setFont("helvetica", "bold"); doc.text(doc.splitTextToSize(r.color, W - 6)[0], x + 3, ny); }
        doc.setFont("helvetica", "bold"); doc.setFontSize(13);
        doc.text(brl(r.sale_price), x + W - 3, y + H - 3, { align: "right" });
      });
      doc.save(`etiquetas-codigos-${new Date().toISOString().slice(0, 10)}.pdf`);
      setPdfOpen(false);
    } catch (e: any) {
      toast.error("Erro ao gerar PDF: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const letterLabel = useMemo(() => new Map(letters.map(l => [l.letter, l.label])), [letters]);

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Link to="/inventory"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Códigos de Produto</h1>
            <p className="text-sm text-muted-foreground">{total.toLocaleString("pt-BR")} códigos · {selected.size} selecionado(s)</p>
            <p className="text-xs font-medium">
              {summary.ok ?? 0} ok · {summary.partial_sizes ?? 0} parciais · {summary.color_missing ?? 0} cor faltando · {summary.unlinked ?? 0} sem vínculo
              {(summary.product_missing ?? 0) > 0 && ` · ${summary.product_missing} produto inativo`}
              {(summary.not_published_lovable ?? 0) > 0 && ` · ${summary.not_published_lovable} não publicados`}
              {(summary.pending_check ?? 0) > 0 && ` · ${summary.pending_check} aguardando`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setAliasOpen(true)}>
            <Palette className="h-4 w-4 mr-1" /> De-para de cores
          </Button>
          <Button variant="outline" size="sm" onClick={generateMissing} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />} Gerar códigos faltantes
          </Button>
          <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />} Verificar na Shopify agora
          </Button>
          <Button variant="outline" size="sm" onClick={() => guardExport(exportCsv)} disabled={exporting}>
            <Download className="h-4 w-4 mr-1" /> Exportar lista
          </Button>
          <Button size="sm" onClick={() => setPdfOpen(true)}>
            <FileText className="h-4 w-4 mr-1" /> Etiquetas PDF
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {letters.map(l => (
          <Badge key={l.letter} variant="secondary" className="font-normal"><b className="mr-1">{l.letter}</b>= {l.label}</Badge>
        ))}
      </div>

      <Card className="mb-4">
        <CardContent className="p-3 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar por código, produto ou cor" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={letter} onValueChange={setLetter}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as letras</SelectItem>
              {letters.map(l => <SelectItem key={l.letter} value={l.letter}>{l.letter} — {l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyStock} onCheckedChange={v => setOnlyStock(!!v)} /> Com estoque
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyOk} onCheckedChange={v => setOnlyOk(!!v)} /> Somente ok na Shopify
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2 w-8"><Checkbox checked={allPageSelected} onCheckedChange={togglePage} /></th>
                  <th className="p-2">Código</th><th className="p-2">Produto</th><th className="p-2">Cor</th>
                  <th className="p-2">Categoria</th><th className="p-2 text-right">Preço</th><th className="p-2 text-right">Estoque</th><th className="p-2">Shopify</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground"><Hash className="h-5 w-5 inline mr-1" />Nenhum código encontrado</td></tr>
                ) : rows.map(r => (
                  <tr key={r.code} className="border-t hover:bg-muted/30">
                    <td className="p-2"><Checkbox checked={selected.has(r.code)} onCheckedChange={() => toggle(r)} /></td>
                    <td className="p-2 text-xl font-bold font-mono text-primary">{r.code}</td>
                    <td className="p-2">{r.product_name}</td>
                    <td className="p-2">{r.color ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-2 text-muted-foreground">{r.category ?? (r.letter ? letterLabel.get(r.letter) : "")}</td>
                    <td className="p-2 text-right whitespace-nowrap">{brl(r.sale_price)}</td>
                    <td className={`p-2 text-right ${Number(r.total_stock ?? 0) > 0 ? "" : "text-muted-foreground"}`}>{r.total_stock ?? 0}</td>
                    <td className="p-2"><ShopifyBadge r={r} sku={exampleSku[`${r.master_id}|${normColor(r.color)}`]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <span className="text-muted-foreground">Página {page + 1} de {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ProductColorAliasDialog open={aliasOpen} onOpenChange={setAliasOpen} onSaved={() => setReload((value) => value + 1)} />

      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Etiquetas 8 × 5 cm (A4)</DialogTitle></DialogHeader>
          <RadioGroup value={pdfMode} onValueChange={v => setPdfMode(v as any)} className="space-y-2">
            <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="filtered" /> Todos os códigos filtrados ({total})</Label>
            <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="selected" disabled={!selected.size} /> Só os selecionados ({selected.size})</Label>
            <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="stock" /> Só os com estoque (dos filtrados)</Label>
          </RadioGroup>
          <DialogFooter>
            <Button onClick={() => guardExport(exportPdf)} disabled={exporting}>
              {exporting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!warnAction} onOpenChange={(v) => { if (!v) setWarnAction(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Atenção</DialogTitle></DialogHeader>
          <p className="text-sm">A exportação inclui códigos que não estão na Shopify.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWarnAction(null)}>Cancelar</Button>
            <Button onClick={() => { const fn = warnAction; setWarnAction(null); fn?.(); }}>Exportar mesmo assim</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
