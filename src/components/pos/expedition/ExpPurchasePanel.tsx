import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import jsPDF from "jspdf";
import * as XLSX from "@e965/xlsx";

interface Props {
  storeId: string;
  storeName?: string;
}

interface PurchaseRequest {
  id: string;
  product_name: string;
  variant_name: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  cost_price: number;
  notes: string | null;
  requested_by_name: string | null;
  created_at: string;
  list_id: string | null;
}

interface PurchaseList {
  id: string;
  name: string;
  created_at: string;
  created_by_name: string | null;
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const descr = (r: PurchaseRequest) =>
  [r.variant_name, r.size && `Tam ${r.size}`, r.sku, r.barcode].filter(Boolean).join(" • ");

const total = (rows: PurchaseRequest[]) =>
  rows.reduce((s, r) => s + (Number(r.cost_price) || 0) * (Number(r.quantity) || 0), 0);

export function ExpPurchasePanel({ storeId, storeName }: Props) {
  const [tab, setTab] = useState<"solicitacoes" | "listas">("solicitacoes");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PurchaseRequest[]>([]);
  const [lists, setLists] = useState<PurchaseList[]>([]);
  const [listItems, setListItems] = useState<Record<string, PurchaseRequest[]>>({});
  const [openList, setOpenList] = useState<PurchaseList | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nameDialog, setNameDialog] = useState(false);
  const [listName, setListName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, listRes] = await Promise.all([
        supabase
          .from("pos_purchase_requests")
          .select("*")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_purchase_lists")
          .select("*")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false }),
      ]);
      if (reqRes.error) throw reqRes.error;
      if (listRes.error) throw listRes.error;
      const all = (reqRes.data || []) as any as PurchaseRequest[];
      setPending(all.filter((r) => !r.list_id));
      const byList: Record<string, PurchaseRequest[]> = {};
      for (const r of all) if (r.list_id) (byList[r.list_id] ||= []).push(r);
      setListItems(byList);
      setLists((listRes.data || []) as any as PurchaseList[]);
    } catch (e: any) {
      toast.error(e.message || "Erro ao carregar solicitações de compra");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (storeId) load();
  }, [storeId, load]);

  const selectedRows = useMemo(() => pending.filter((r) => selected.has(r.id)), [pending, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const createList = async () => {
    const name = listName.trim();
    if (!name) return toast.error("Informe um nome para a lista");
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { data: list, error } = await supabase
        .from("pos_purchase_lists")
        .insert({
          store_id: storeId,
          name,
          created_by: auth?.user?.id ?? null,
          created_by_name:
            (auth?.user?.user_metadata as any)?.full_name || auth?.user?.email || null,
        })
        .select()
        .single();
      if (error) throw error;
      const { error: upErr } = await supabase
        .from("pos_purchase_requests")
        .update({ list_id: (list as any).id, status: "listed" })
        .in("id", selectedRows.map((r) => r.id));
      if (upErr) throw upErr;
      toast.success(`Lista "${name}" criada com ${selectedRows.length} produto(s)`);
      setNameDialog(false);
      setListName("");
      setSelected(new Set());
      setTab("listas");
      load();
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar lista de compra");
    } finally {
      setBusy(false);
    }
  };

  const removeRequest = async (id: string) => {
    const { error } = await supabase.from("pos_purchase_requests").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Solicitação removida");
    load();
  };

  const deleteList = async (list: PurchaseList) => {
    if (!confirm(`Excluir a lista "${list.name}"? Os produtos voltam para as solicitações.`)) return;
    const { error: upErr } = await supabase
      .from("pos_purchase_requests")
      .update({ list_id: null, status: "pending" })
      .eq("list_id", list.id);
    if (upErr) return toast.error(upErr.message);
    const { error } = await supabase.from("pos_purchase_lists").delete().eq("id", list.id);
    if (error) return toast.error(error.message);
    toast.success("Lista excluída");
    setOpenList(null);
    load();
  };

  /* ---------- Exportações ---------- */

  const printRows = (title: string, rows: PurchaseRequest[]) => {
    const body = rows
      .map(
        (r, i) => `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td><strong>${r.product_name}</strong><br/><span style="font-size:11px;color:#555">${descr(r)}</span></td>
        <td style="text-align:center;font-weight:bold">${r.quantity}</td>
        <td style="text-align:right">${brl(Number(r.cost_price) || 0)}</td>
        <td style="text-align:right;font-weight:bold">${brl((Number(r.cost_price) || 0) * r.quantity)}</td>
      </tr>`,
      )
      .join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>${title}</title><style>
      @page{margin:12mm}
      body{font-family:Arial,Helvetica,sans-serif;padding:16px}
      h1{font-size:20px;margin:0 0 4px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th{background:#1a1a1a;color:#f5c518;padding:8px;text-align:left;font-size:11px;text-transform:uppercase}
      td{padding:8px;border-bottom:1px solid #ddd;font-size:13px}
      tfoot td{font-size:15px;font-weight:bold;border-top:2px solid #111}
    </style></head><body>
      <h1>🛒 ${title}</h1>
      <div style="font-size:12px;color:#555">${new Date().toLocaleString("pt-BR")}${storeName ? ` • ${storeName}` : ""} • ${rows.length} produto(s) • ${rows.reduce((s, r) => s + r.quantity, 0)} par(es)</div>
      <table>
        <thead><tr><th style="width:32px">#</th><th>Produto</th><th style="width:60px">Qtd</th><th style="width:100px">Custo un.</th><th style="width:110px">Subtotal</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="4" style="text-align:right">INVESTIMENTO TOTAL</td><td style="text-align:right">${brl(total(rows))}</td></tr></tfoot>
      </table>
    </body></html>`);
    w.document.close();
    w.print();
  };

  const exportPdf = (title: string, rows: PurchaseRequest[]) => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(title, 14, 16);
    doc.setFontSize(9);
    doc.text(
      `${new Date().toLocaleString("pt-BR")}${storeName ? ` • ${storeName}` : ""} • ${rows.length} produto(s)`,
      14,
      22,
    );
    let y = 32;
    doc.setFontSize(9);
    doc.text("PRODUTO", 14, y);
    doc.text("QTD", 140, y);
    doc.text("CUSTO", 155, y);
    doc.text("SUBTOTAL", 178, y);
    y += 4;
    doc.line(14, y, 196, y);
    y += 6;
    for (const r of rows) {
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
      const name = `${r.product_name}`.slice(0, 60);
      doc.text(name, 14, y);
      doc.text(String(r.quantity), 140, y);
      doc.text(brl(Number(r.cost_price) || 0), 155, y);
      doc.text(brl((Number(r.cost_price) || 0) * r.quantity), 178, y);
      const sub = descr(r);
      if (sub) {
        y += 4;
        doc.setTextColor(120);
        doc.text(sub.slice(0, 80), 14, y);
        doc.setTextColor(0);
      }
      y += 7;
    }
    y += 2;
    doc.line(14, y, 196, y);
    y += 7;
    doc.setFontSize(11);
    doc.text(`INVESTIMENTO TOTAL: ${brl(total(rows))}`, 14, y);
    doc.save(`${title.replace(/\s+/g, "_")}.pdf`);
  };

  const exportTxt = (title: string, rows: PurchaseRequest[]) => {
    const lines = [
      title.toUpperCase(),
      `${new Date().toLocaleString("pt-BR")}${storeName ? ` - ${storeName}` : ""}`,
      "",
      ...rows.map(
        (r, i) =>
          `${String(i + 1).padStart(2, "0")}) ${r.quantity}x ${r.product_name}${descr(r) ? ` (${descr(r)})` : ""} - custo un. ${brl(Number(r.cost_price) || 0)} - subtotal ${brl((Number(r.cost_price) || 0) * r.quantity)}`,
      ),
      "",
      `INVESTIMENTO TOTAL: ${brl(total(rows))}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportXlsx = (title: string, rows: PurchaseRequest[]) => {
    const data = rows.map((r, i) => ({
      "#": i + 1,
      Produto: r.product_name,
      Variação: r.variant_name || "",
      Tamanho: r.size || "",
      SKU: r.sku || "",
      "Cód. barras": r.barcode || "",
      Qtd: r.quantity,
      "Custo unitário": Number(r.cost_price) || 0,
      Subtotal: (Number(r.cost_price) || 0) * r.quantity,
    }));
    data.push({
      "#": "" as any,
      Produto: "INVESTIMENTO TOTAL",
      Variação: "",
      Tamanho: "",
      SKU: "",
      "Cód. barras": "",
      Qtd: rows.reduce((s, r) => s + r.quantity, 0),
      "Custo unitário": "" as any,
      Subtotal: total(rows),
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Compras");
    XLSX.writeFile(wb, `${title.replace(/\s+/g, "_")}.xlsx`);
  };

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-exp-prep" />
      </div>
    );
  }

  const detailRows = openList ? listItems[openList.id] || [] : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={tab === "solicitacoes" ? "default" : "outline"}
          className="font-black"
          onClick={() => {
            setTab("solicitacoes");
            setOpenList(null);
          }}
        >
          <ShoppingCart className="h-4 w-4 mr-1" /> SOLICITAÇÕES ({pending.length})
        </Button>
        <Button
          variant={tab === "listas" ? "default" : "outline"}
          className="font-black"
          onClick={() => setTab("listas")}
        >
          <ClipboardList className="h-4 w-4 mr-1" /> LISTAS DE COMPRA ({lists.length})
        </Button>
      </div>

      {tab === "solicitacoes" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-lg font-black text-pos-text">
              {pending.length} produto(s) • {pending.reduce((s, r) => s + r.quantity, 0)} par(es)
            </span>
            <Badge className="bg-exp-prep text-white font-bold">{brl(total(pending))} estimado</Badge>
            <Button
              variant="outline"
              className="ml-auto font-bold"
              disabled={!pending.length}
              onClick={() => printRows("Produtos a comprar", pending)}
            >
              <Printer className="h-4 w-4 mr-1" /> Imprimir relatório
            </Button>
            {selectedRows.length > 0 && (
              <Button className="font-black" onClick={() => setNameDialog(true)}>
                <ClipboardList className="h-4 w-4 mr-1" /> CRIAR LISTA DE COMPRA ({selectedRows.length})
              </Button>
            )}
          </div>

          {!pending.length && (
            <div className="text-center py-16">
              <ShoppingCart className="h-14 w-14 mx-auto text-pos-muted-text/40" />
              <p className="mt-3 text-lg font-bold text-pos-muted-text">
                Nenhuma solicitação de compra. Use "Solicitar compra" na etapa Separação.
              </p>
            </div>
          )}

          {pending.map((r) => (
            <div key={r.id} className="rounded-xl bg-pos-card border-2 border-pos-border p-4 flex items-start gap-3">
              <Checkbox className="mt-1 h-6 w-6" checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-black text-pos-text">{r.product_name}</p>
                <p className="text-sm font-semibold text-pos-muted-text">{descr(r)}</p>
                <p className="text-xs font-semibold text-pos-muted-text/70 mt-1">
                  {new Date(r.created_at).toLocaleString("pt-BR")}
                  {r.requested_by_name ? ` • ${r.requested_by_name}` : ""}
                  {r.notes ? ` • ${r.notes}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-black text-pos-text">{r.quantity}</p>
                <p className="text-xs font-bold text-pos-muted-text">par(es)</p>
                <p className="text-sm font-bold text-exp-prep">
                  {brl((Number(r.cost_price) || 0) * r.quantity)}
                </p>
              </div>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeRequest(r.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {tab === "listas" && !openList && (
        <div className="space-y-3">
          {!lists.length && (
            <div className="text-center py-16">
              <ClipboardList className="h-14 w-14 mx-auto text-pos-muted-text/40" />
              <p className="mt-3 text-lg font-bold text-pos-muted-text">Nenhuma lista de compra criada</p>
            </div>
          )}
          {lists.map((l) => {
            const rows = listItems[l.id] || [];
            return (
              <button
                key={l.id}
                onClick={() => setOpenList(l)}
                className="w-full text-left rounded-xl bg-pos-card border-2 border-pos-border hover:border-exp-prep p-4 flex items-center gap-3"
              >
                <ClipboardList className="h-6 w-6 text-exp-prep" />
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-black text-pos-text">{l.name}</p>
                  <p className="text-sm font-semibold text-pos-muted-text">
                    {new Date(l.created_at).toLocaleString("pt-BR")}
                    {l.created_by_name ? ` • ${l.created_by_name}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-pos-muted-text">{rows.length} produto(s)</p>
                  <p className="text-lg font-black text-exp-prep">{brl(total(rows))}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {tab === "listas" && openList && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" className="font-bold" onClick={() => setOpenList(null)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
            <span className="text-xl font-black text-pos-text">{openList.name}</span>
            <span className="text-sm font-semibold text-pos-muted-text">
              {new Date(openList.created_at).toLocaleString("pt-BR")}
            </span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button variant="outline" className="font-bold" onClick={() => printRows(openList.name, detailRows)}>
                <Printer className="h-4 w-4 mr-1" /> Imprimir lista
              </Button>
              <Button variant="outline" className="font-bold" onClick={() => exportPdf(openList.name, detailRows)}>
                <FileText className="h-4 w-4 mr-1" /> PDF
              </Button>
              <Button variant="outline" className="font-bold" onClick={() => exportTxt(openList.name, detailRows)}>
                <FileText className="h-4 w-4 mr-1" /> TXT
              </Button>
              <Button variant="outline" className="font-bold" onClick={() => exportXlsx(openList.name, detailRows)}>
                <FileSpreadsheet className="h-4 w-4 mr-1" /> EXCEL
              </Button>
              <Button
                variant="outline"
                className="font-bold text-destructive border-destructive/40"
                onClick={() => deleteList(openList)}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            </div>
          </div>

          {detailRows.map((r, i) => (
            <div key={r.id} className="rounded-xl bg-pos-card border-2 border-pos-border p-4 flex items-start gap-3">
              <span className="text-lg font-black text-pos-muted-text w-8">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-black text-pos-text">{r.product_name}</p>
                <p className="text-sm font-semibold text-pos-muted-text">{descr(r)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-black text-pos-text">{r.quantity}</p>
                <p className="text-xs font-bold text-pos-muted-text">
                  custo un. {brl(Number(r.cost_price) || 0)}
                </p>
                <p className="text-sm font-bold text-exp-prep">
                  {brl((Number(r.cost_price) || 0) * r.quantity)}
                </p>
              </div>
            </div>
          ))}

          <div className="rounded-xl bg-pos-elevated border-2 border-exp-prep p-4 flex items-center justify-between">
            <span className="text-lg font-black text-pos-text uppercase">Investimento total</span>
            <span className="text-2xl font-black text-exp-prep">{brl(total(detailRows))}</span>
          </div>
        </div>
      )}

      <Dialog open={nameDialog} onOpenChange={setNameDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Nome da lista de compra</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Como deseja chamar esta lista?</Label>
              <Input
                value={listName}
                autoFocus
                onChange={(e) => setListName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createList()}
                placeholder="Ex.: Compra Fornecedor X — 26/07"
                className="h-12 text-lg font-bold"
              />
            </div>
            <p className="text-sm font-semibold text-pos-muted-text">
              {selectedRows.length} produto(s) • {brl(total(selectedRows))}
            </p>
            <Button className="w-full h-12 font-black" onClick={createList} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} CONFIRMAR
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ExpPurchasePanel;
