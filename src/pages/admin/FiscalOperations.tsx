import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Pencil } from "lucide-react";

type Row = any;

const UFs = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const empty = {
  ncm: "",
  uf_origem: "MG",
  uf_destino: "",
  tipo_operacao: "venda",
  cfop: "5102",
  cst_icms: "",
  csosn_icms: "102",
  aliq_icms: 0,
  cst_pis: "49",
  aliq_pis: 0,
  cst_cofins: "49",
  aliq_cofins: 0,
  origem_mercadoria: 0,
  description: "",
  priority: 0,
  is_active: true,
};

export default function FiscalOperations() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).from("fiscal_operations")
      .select("*").order("priority", { ascending: false }).order("created_at", { ascending: false });
    if (error) toast.error(error.message); else setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setOpen(true); };
  const openEdit = (r: Row) => { setForm({ ...r }); setOpen(true); };

  const save = async () => {
    setSaving(true);
    const payload = {
      ...form,
      ncm: form.ncm?.trim() || null,
      uf_destino: form.uf_destino?.trim() || null,
      cst_icms: form.cst_icms?.trim() || null,
      csosn_icms: form.csosn_icms?.trim() || null,
      aliq_icms: Number(form.aliq_icms || 0),
      aliq_pis: Number(form.aliq_pis || 0),
      aliq_cofins: Number(form.aliq_cofins || 0),
      origem_mercadoria: Number(form.origem_mercadoria || 0),
      priority: Number(form.priority || 0),
    };
    const { error } = form.id
      ? await (supabase as any).from("fiscal_operations").update(payload).eq("id", form.id)
      : await (supabase as any).from("fiscal_operations").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Regra salva");
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta regra?")) return;
    const { error } = await (supabase as any).from("fiscal_operations").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removida");
    load();
  };

  const seedDefaults = async () => {
    if (!confirm("Inserir regras padrão para Simples Nacional (calçados MG → BR)?")) return;
    const seeds = [
      { uf_origem: "MG", uf_destino: "MG", tipo_operacao: "venda", cfop: "5102", csosn_icms: "102", cst_pis: "49", cst_cofins: "49", origem_mercadoria: 0, priority: 1, description: "Venda dentro de MG (Simples) — calçados nacionais" },
      { uf_origem: "MG", uf_destino: null, tipo_operacao: "venda", cfop: "6102", csosn_icms: "102", cst_pis: "49", cst_cofins: "49", origem_mercadoria: 0, priority: 1, description: "Venda fora de MG (Simples) — calçados nacionais" },
    ];
    const { error } = await (supabase as any).from("fiscal_operations").insert(seeds);
    if (error) return toast.error(error.message);
    toast.success("Regras seed inseridas");
    load();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Admin</Button></Link>
          <h1 className="text-2xl font-bold">Regras Fiscais</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={seedDefaults}>Seed padrão SN</Button>
          <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Nova regra</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Regras cadastradas</CardTitle>
          <CardDescription>Resolução por prioridade: NCM+UF exato → NCM+qualquer UF → qualquer NCM+UF → fallback geral.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>NCM</TableHead><TableHead>Orig→Dest</TableHead><TableHead>Op</TableHead>
                <TableHead>CFOP</TableHead><TableHead>CST/CSOSN</TableHead><TableHead>ICMS%</TableHead>
                <TableHead>PIS</TableHead><TableHead>COFINS</TableHead><TableHead>Prio</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.ncm || "*"}</TableCell>
                    <TableCell className="text-xs">{r.uf_origem} → {r.uf_destino || "*"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{r.tipo_operacao}</Badge></TableCell>
                    <TableCell className="font-mono">{r.cfop}</TableCell>
                    <TableCell className="text-xs">{r.cst_icms || r.csosn_icms || "—"}</TableCell>
                    <TableCell>{Number(r.aliq_icms).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{r.cst_pis}/{Number(r.aliq_pis).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{r.cst_cofins}/{Number(r.aliq_cofins).toFixed(2)}</TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Nenhuma regra. Use "Seed padrão SN".</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar regra fiscal" : "Nova regra fiscal"}</DialogTitle>
            <DialogDescription>Deixe NCM ou UF destino em branco para curinga.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>NCM (8 dígitos)</Label><Input value={form.ncm} onChange={e => setForm({ ...form, ncm: e.target.value })} placeholder="* = qualquer" /></div>
            <div><Label>UF Origem</Label>
              <Select value={form.uf_origem} onValueChange={v => setForm({ ...form, uf_origem: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UFs.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>UF Destino</Label>
              <Select value={form.uf_destino || "ALL"} onValueChange={v => setForm({ ...form, uf_destino: v === "ALL" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ALL">* (qualquer)</SelectItem>{UFs.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Operação</Label>
              <Select value={form.tipo_operacao} onValueChange={v => setForm({ ...form, tipo_operacao: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="venda">Venda</SelectItem><SelectItem value="devolucao">Devolução</SelectItem><SelectItem value="transferencia">Transferência</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>CFOP</Label><Input value={form.cfop} onChange={e => setForm({ ...form, cfop: e.target.value })} /></div>
            <div><Label>Origem mercadoria (0-8)</Label><Input type="number" value={form.origem_mercadoria} onChange={e => setForm({ ...form, origem_mercadoria: e.target.value })} /></div>
            <div><Label>CSOSN (Simples)</Label><Input value={form.csosn_icms} onChange={e => setForm({ ...form, csosn_icms: e.target.value })} placeholder="ex: 102" /></div>
            <div><Label>CST ICMS (Lucro)</Label><Input value={form.cst_icms} onChange={e => setForm({ ...form, cst_icms: e.target.value })} placeholder="ex: 00" /></div>
            <div><Label>Alíq. ICMS %</Label><Input type="number" step="0.01" value={form.aliq_icms} onChange={e => setForm({ ...form, aliq_icms: e.target.value })} /></div>
            <div><Label>CST PIS</Label><Input value={form.cst_pis} onChange={e => setForm({ ...form, cst_pis: e.target.value })} /></div>
            <div><Label>Alíq. PIS %</Label><Input type="number" step="0.01" value={form.aliq_pis} onChange={e => setForm({ ...form, aliq_pis: e.target.value })} /></div>
            <div><Label>CST COFINS</Label><Input value={form.cst_cofins} onChange={e => setForm({ ...form, cst_cofins: e.target.value })} /></div>
            <div><Label>Alíq. COFINS %</Label><Input type="number" step="0.01" value={form.aliq_cofins} onChange={e => setForm({ ...form, aliq_cofins: e.target.value })} /></div>
            <div><Label>Prioridade</Label><Input type="number" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} /></div>
            <div className="col-span-3"><Label>Descrição</Label><Input value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
