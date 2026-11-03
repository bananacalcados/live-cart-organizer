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
import { ArrowLeft, Download, FileText, Loader2, Search, Wand2, Hash } from "lucide-react";
import { toast } from "sonner";

type CodeRow = {
  code: string;
  letter: string | null;
  master_id: string;
  product_name: string | null;
  color: string | null;
  category: string | null;
  sale_price: number | null;
  total_stock: number | null;
};
type Letter = { letter: string; label: string };

const PAGE = 50;
const COLS = "code,letter,master_id,product_name,color,category,sale_price,total_stock";
const brl = (v: number | null) =>
  `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normColor = (c: string | null) => (c ?? "").trim().toLowerCase();

export default function InventoryProductCodes() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [letter, setLetter] = useState("all");
  const [onlyStock, setOnlyStock] = useState(false);
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

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [debounced, letter, onlyStock]);

  useEffect(() => {
    supabase.from("product_code_letters").select("letter,label").order("letter").then(({ data }) => setLetters((data as Letter[]) ?? []));
  }, []);

  const buildQuery = (opts: { stock?: boolean; count?: boolean } = {}) => {
    let q: any = supabase.from("v_product_color_codes" as any).select(COLS, opts.count ? { count: "exact" } : undefined);
    if (debounced) {
      const s = debounced.replace(/[%,()]/g, " ");
      q = q.or(`code.ilike.%${s}%,product_name.ilike.%${s}%,color.ilike.%${s}%`);
    }
    if (letter !== "all") q = q.eq("letter", letter);
    if (onlyStock || opts.stock) q = q.gt("total_stock", 0);
    return q.order("letter").order("seq");
  };

  useEffect(() => {
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
  }, [debounced, letter, onlyStock, page, reload]);

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
        const { data, error } = await supabase.from("product_variants").select("id,master_id,color")
          .eq("is_active", true).order("id").range(from, from + 999);
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
      const list = pdfMode === "selected" ? Array.from(selected.values()) : await fetchAll(pdfMode === "stock");
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
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={generateMissing} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />} Gerar códigos faltantes
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
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
                  <th className="p-2">Categoria</th><th className="p-2 text-right">Preço</th><th className="p-2 text-right">Estoque</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground"><Hash className="h-5 w-5 inline mr-1" />Nenhum código encontrado</td></tr>
                ) : rows.map(r => (
                  <tr key={r.code} className="border-t hover:bg-muted/30">
                    <td className="p-2"><Checkbox checked={selected.has(r.code)} onCheckedChange={() => toggle(r)} /></td>
                    <td className="p-2 text-xl font-bold font-mono text-primary">{r.code}</td>
                    <td className="p-2">{r.product_name}</td>
                    <td className="p-2">{r.color ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-2 text-muted-foreground">{r.category ?? (r.letter ? letterLabel.get(r.letter) : "")}</td>
                    <td className="p-2 text-right whitespace-nowrap">{brl(r.sale_price)}</td>
                    <td className={`p-2 text-right ${Number(r.total_stock ?? 0) > 0 ? "" : "text-muted-foreground"}`}>{r.total_stock ?? 0}</td>
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

      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Etiquetas 8 × 5 cm (A4)</DialogTitle></DialogHeader>
          <RadioGroup value={pdfMode} onValueChange={v => setPdfMode(v as any)} className="space-y-2">
            <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="filtered" /> Todos os códigos filtrados ({total})</Label>
            <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="selected" disabled={!selected.size} /> Só os selecionados ({selected.size})</Label>
            <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="stock" /> Só os com estoque (dos filtrados)</Label>
          </RadioGroup>
          <DialogFooter>
            <Button onClick={exportPdf} disabled={exporting}>
              {exporting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
