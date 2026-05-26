import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";

interface Fee {
  id: string;
  acquirer: string;
  product: string;
  method: string;
  brand: string | null;
  installments: number;
  fee_pct: number;
  fixed_fee: number;
  days_to_receive: number;
  receipt_schedule: string;
  active: boolean;
  notes: string | null;
}

const ACQUIRERS = ["mercadopago", "cielo", "stone", "rede", "pagseguro", "getnet", "outros"];
const PRODUCTS = [
  { v: "mp_checkout", l: "Checkout Online" },
  { v: "mp_point", l: "Maquininha Física" },
  { v: "mp_link", l: "Link de Pagamento" },
  { v: "other", l: "Outro" },
];
const METHODS = [
  { v: "credit", l: "Crédito" },
  { v: "debit", l: "Débito" },
  { v: "pix", l: "PIX" },
  { v: "boleto", l: "Boleto" },
];
const SCHEDULES = ["D0", "D14", "D30", "instant", "D+3"];

export function PaymentFeesManager() {
  const [fees, setFees] = useState<Fee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAcquirer, setFilterAcquirer] = useState("mercadopago");
  const [filterProduct, setFilterProduct] = useState("mp_checkout");
  const [editing, setEditing] = useState<Record<string, Partial<Fee>>>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_method_fees")
      .select("*")
      .order("acquirer").order("product").order("method").order("installments");
    if (error) toast.error(error.message);
    else setFees((data as Fee[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = fees.filter(f => f.acquirer === filterAcquirer && f.product === filterProduct);

  const updateField = (id: string, patch: Partial<Fee>) => {
    setEditing(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const saveRow = async (id: string) => {
    const patch = editing[id];
    if (!patch) return;
    const { error } = await supabase.from("payment_method_fees").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Taxa atualizada");
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });
    load();
  };

  const toggleActive = async (id: string, active: boolean) => {
    const { error } = await supabase.from("payment_method_fees").update({ active }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const deleteRow = async (id: string) => {
    if (!confirm("Excluir esta taxa?")) return;
    const { error } = await supabase.from("payment_method_fees").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removida");
    load();
  };

  const addRow = async () => {
    const { error } = await supabase.from("payment_method_fees").insert({
      acquirer: filterAcquirer,
      product: filterProduct,
      method: "credit",
      installments: 1,
      fee_pct: 0,
      fixed_fee: 0,
      receipt_schedule: "D0",
    });
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Taxas de Pagamento</span>
          <Button size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure as taxas por adquirente, produto e método. Usadas para calcular automaticamente o custo de cada venda no fluxo de caixa.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Adquirente</label>
            <Select value={filterAcquirer} onValueChange={setFilterAcquirer}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{ACQUIRERS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Produto</label>
            <Select value={filterProduct} onValueChange={setFilterProduct}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{PRODUCTS.map(p => <SelectItem key={p.v} value={p.v}>{p.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Método</TableHead>
                <TableHead>Parcelas</TableHead>
                <TableHead>Bandeira</TableHead>
                <TableHead>Taxa %</TableHead>
                <TableHead>Tarifa fixa</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead>Ativa</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Carregando…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhuma taxa cadastrada para esta combinação.</TableCell></TableRow>}
              {filtered.map(f => {
                const e = editing[f.id] || {};
                const v = { ...f, ...e };
                const dirty = !!editing[f.id];
                return (
                  <TableRow key={f.id} className={dirty ? "bg-muted/50" : ""}>
                    <TableCell>
                      <Select value={v.method} onValueChange={(x) => updateField(f.id, { method: x })}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{METHODS.map(m => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" className="h-8 w-16" value={v.installments}
                        onChange={(ev) => updateField(f.id, { installments: parseInt(ev.target.value) || 1 })} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 w-24" placeholder="—" value={v.brand || ""}
                        onChange={(ev) => updateField(f.id, { brand: ev.target.value || null })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="0.01" className="h-8 w-24" value={v.fee_pct}
                        onChange={(ev) => updateField(f.id, { fee_pct: parseFloat(ev.target.value) || 0 })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="0.01" className="h-8 w-24" value={v.fixed_fee}
                        onChange={(ev) => updateField(f.id, { fixed_fee: parseFloat(ev.target.value) || 0 })} />
                    </TableCell>
                    <TableCell>
                      <Select value={v.receipt_schedule} onValueChange={(x) => updateField(f.id, { receipt_schedule: x })}>
                        <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>{SCHEDULES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch checked={f.active} onCheckedChange={(c) => toggleActive(f.id, c)} />
                    </TableCell>
                    <TableCell className="flex gap-1">
                      {dirty && <Button size="sm" variant="default" onClick={() => saveRow(f.id)}><Save className="h-3.5 w-3.5" /></Button>}
                      <Button size="sm" variant="ghost" onClick={() => deleteRow(f.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex gap-2 flex-wrap text-xs text-muted-foreground">
          <Badge variant="outline">D0 = na hora</Badge>
          <Badge variant="outline">D14 = 14 dias</Badge>
          <Badge variant="outline">D30 = 30 dias</Badge>
          <Badge variant="outline">instant = imediato (PIX/Point)</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
