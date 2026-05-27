import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Landmark, ArrowLeftRight } from "lucide-react";

interface BankAccount {
  id: string;
  name: string;
  bank_name: string | null;
  account_type: string | null;
  initial_balance: number;
  balance: number;
  notes: string | null;
  is_active: boolean;
  store_id: string | null;
}

interface Store { id: string; name: string; }

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export function BankAccountsManager({ stores }: { stores: Store[] }) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [balances, setBalances] = useState<Record<string, { in: number; out: number }>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<BankAccount> | null>(null);
  const [transfer, setTransfer] = useState<{ from?: string; to?: string; amount?: string; date?: string; description?: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("bank_accounts" as any).select("*").order("name");
    const accs = ((data as any[]) || []) as BankAccount[];
    setAccounts(accs);

    if (accs.length) {
      const { data: entries } = await supabase
        .from("cash_flow_entries")
        .select("bank_account_id, direction, amount")
        .in("bank_account_id", accs.map((a) => a.id));
      const agg: Record<string, { in: number; out: number }> = {};
      (entries || []).forEach((e: any) => {
        const id = e.bank_account_id;
        if (!id) return;
        agg[id] = agg[id] || { in: 0, out: 0 };
        agg[id][e.direction as "in" | "out"] += Number(e.amount || 0);
      });
      setBalances(agg);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const currentBalance = (a: BankAccount) =>
    Number(a.initial_balance || 0) + (balances[a.id]?.in || 0) - (balances[a.id]?.out || 0);

  const save = async () => {
    if (!editing?.name?.trim()) return toast({ title: "Nome obrigatório", variant: "destructive" });
    const payload = {
      name: editing.name,
      bank_name: editing.bank_name || null,
      account_type: editing.account_type || "corrente",
      initial_balance: Number(editing.initial_balance || 0),
      store_id: editing.store_id || null,
      notes: editing.notes || null,
      is_active: editing.is_active ?? true,
    };
    const q = editing.id
      ? supabase.from("bank_accounts" as any).update(payload).eq("id", editing.id)
      : supabase.from("bank_accounts" as any).insert(payload);
    const { error } = await q;
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Salvo" });
    setEditing(null);
    load();
  };

  const toggleActive = async (a: BankAccount) => {
    await supabase.from("bank_accounts" as any).update({ is_active: !a.is_active }).eq("id", a.id);
    load();
  };

  const del = async (a: BankAccount) => {
    if (!confirm(`Excluir conta "${a.name}"? Lançamentos vinculados ficam sem conta.`)) return;
    const { error } = await supabase.from("bank_accounts" as any).delete().eq("id", a.id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    load();
  };

  const doTransfer = async () => {
    if (!transfer?.from || !transfer?.to || !transfer?.amount) {
      return toast({ title: "Preencha origem, destino e valor", variant: "destructive" });
    }
    if (transfer.from === transfer.to) {
      return toast({ title: "Contas devem ser diferentes", variant: "destructive" });
    }
    const amt = Number(transfer.amount);
    if (!amt || amt <= 0) return toast({ title: "Valor inválido", variant: "destructive" });
    const date = transfer.date || new Date().toISOString().slice(0, 10);
    const pair = crypto.randomUUID();
    const desc = transfer.description || `Transferência entre contas`;
    const fromAcc = accounts.find((a) => a.id === transfer.from);
    const toAcc = accounts.find((a) => a.id === transfer.to);

    const { error } = await supabase.from("cash_flow_entries").insert([
      {
        entry_date: date, direction: "out", amount: amt,
        description: `${desc} → ${toAcc?.name}`,
        source: "transfer", is_transfer: true, transfer_pair_id: pair,
        bank_account_id: transfer.from, status: "confirmed", confidence: 1,
      },
      {
        entry_date: date, direction: "in", amount: amt,
        description: `${desc} ← ${fromAcc?.name}`,
        source: "transfer", is_transfer: true, transfer_pair_id: pair,
        bank_account_id: transfer.to, status: "confirmed", confidence: 1,
      },
    ]);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Transferência registrada" });
    setTransfer(null);
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4" /> Contas Bancárias
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setTransfer({})}>
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1" /> Transferência
            </Button>
            <Button size="sm" onClick={() => setEditing({ is_active: true, account_type: "corrente", initial_balance: 0 })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Nova Conta
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {editing && (
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <div className="text-xs font-medium">{editing.id ? "Editar conta" : "Nova conta"}</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input placeholder="Nome (ex: Itaú PJ)" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <Input placeholder="Banco" value={editing.bank_name || ""} onChange={(e) => setEditing({ ...editing, bank_name: e.target.value })} />
                <Select value={editing.account_type || "corrente"} onValueChange={(v) => setEditing({ ...editing, account_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corrente">Conta Corrente</SelectItem>
                    <SelectItem value="poupanca">Poupança</SelectItem>
                    <SelectItem value="caixa_loja">Caixa da Loja</SelectItem>
                    <SelectItem value="cofre">Cofre</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" step="0.01" placeholder="Saldo inicial" value={editing.initial_balance ?? 0} onChange={(e) => setEditing({ ...editing, initial_balance: Number(e.target.value) })} />
                <Select value={editing.store_id || "__none__"} onValueChange={(v) => setEditing({ ...editing, store_id: v === "__none__" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Loja vinculada (opcional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Nenhuma —</SelectItem>
                    {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Observações" value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={save}>Salvar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              </div>
            </div>
          )}

          {transfer && (
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <div className="text-xs font-medium">Nova transferência entre contas</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Select value={transfer.from || ""} onValueChange={(v) => setTransfer({ ...transfer, from: v })}>
                  <SelectTrigger><SelectValue placeholder="De" /></SelectTrigger>
                  <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={transfer.to || ""} onValueChange={(v) => setTransfer({ ...transfer, to: v })}>
                  <SelectTrigger><SelectValue placeholder="Para" /></SelectTrigger>
                  <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" step="0.01" placeholder="Valor" value={transfer.amount || ""} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} />
                <Input type="date" value={transfer.date || ""} onChange={(e) => setTransfer({ ...transfer, date: e.target.value })} />
                <Input placeholder="Descrição (opcional)" className="md:col-span-2" value={transfer.description || ""} onChange={(e) => setTransfer({ ...transfer, description: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={doTransfer}>Registrar</Button>
                <Button size="sm" variant="ghost" onClick={() => setTransfer(null)}>Cancelar</Button>
              </div>
            </div>
          )}

          {loading && <div className="text-sm text-muted-foreground">Carregando…</div>}
          {!loading && accounts.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma conta cadastrada. Clique em "Nova Conta" para começar.
            </div>
          )}
          {!loading && accounts.map((a) => (
            <div key={a.id} className={`flex items-center gap-3 p-3 border rounded-lg ${!a.is_active ? "opacity-50" : ""}`}>
              <Landmark className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-sm font-medium flex items-center gap-2">
                  {a.name}
                  {a.bank_name && <Badge variant="outline" className="text-[10px]">{a.bank_name}</Badge>}
                  {!a.is_active && <Badge variant="secondary" className="text-[10px]">inativa</Badge>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {a.account_type} {a.notes && `• ${a.notes}`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Saldo atual</div>
                <div className={`text-sm font-bold ${currentBalance(a) < 0 ? "text-destructive" : ""}`}>{fmt(currentBalance(a))}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(a)}>
                <Badge variant={a.is_active ? "default" : "outline"} className="text-[10px]">{a.is_active ? "on" : "off"}</Badge>
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del(a)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
