import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Gift, Search, Plus, Trash2, CheckCircle, Clock, Phone,
  Mail, Tag, Filter, X, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Prize {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  customer_email: string | null;
  prize_label: string;
  prize_type: string;
  prize_value: number;
  coupon_code: string;
  is_redeemed: boolean;
  redeemed_at: string | null;
  expires_at: string;
  source: string;
  notes: string | null;
  created_at: string;
}

const PRIZE_TYPE_LABELS: Record<string, string> = {
  discount_percent: "% Desconto",
  discount_fixed: "R$ Desconto",
  free_shipping: "Frete Grátis",
  gift: "Brinde",
  cashback: "Cashback",
  custom: "Personalizado",
};

const generateCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "PRIZE-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

export function PrizeManager() {
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "redeemed" | "expired">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    customer_phone: "",
    customer_name: "",
    customer_email: "",
    prize_label: "",
    prize_type: "discount_percent",
    prize_value: "",
    expiry_days: "30",
    notes: "",
  });

  const fetchPrizes = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("customer_prizes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      setPrizes((data as Prize[]) || []);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao carregar prêmios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrizes(); }, [fetchPrizes]);

  const createPrize = async () => {
    if (!form.customer_phone.trim() || !form.prize_label.trim()) {
      toast.error("Telefone e nome do prêmio são obrigatórios");
      return;
    }
    setCreating(true);
    try {
      const expiryDays = parseInt(form.expiry_days) || 30;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiryDays);

      const { error } = await supabase.from("customer_prizes").insert({
        customer_phone: form.customer_phone.replace(/\D/g, ""),
        customer_name: form.customer_name || null,
        customer_email: form.customer_email || null,
        prize_label: form.prize_label,
        prize_type: form.prize_type,
        prize_value: parseFloat(form.prize_value) || 0,
        coupon_code: generateCode(),
        expires_at: expiresAt.toISOString(),
        source: "crm_manual",
        notes: form.notes || null,
      });
      if (error) throw error;
      toast.success("Prêmio concedido!");
      setShowCreate(false);
      setForm({ customer_phone: "", customer_name: "", customer_email: "", prize_label: "", prize_type: "discount_percent", prize_value: "", expiry_days: "30", notes: "" });
      fetchPrizes();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao criar prêmio");
    } finally {
      setCreating(false);
    }
  };

  const deletePrize = async (id: string) => {
    try {
      const { error } = await supabase.from("customer_prizes").delete().eq("id", id);
      if (error) throw error;
      setPrizes(prev => prev.filter(p => p.id !== id));
      toast.success("Prêmio removido");
    } catch { toast.error("Erro ao remover"); }
  };

  const markRedeemed = async (id: string) => {
    try {
      const { error } = await supabase
        .from("customer_prizes")
        .update({ is_redeemed: true, redeemed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      setPrizes(prev => prev.map(p => p.id === id ? { ...p, is_redeemed: true, redeemed_at: new Date().toISOString() } : p));
      toast.success("Prêmio marcado como resgatado");
    } catch { toast.error("Erro ao atualizar"); }
  };

  const now = new Date();
  const filtered = prizes.filter(p => {
    if (statusFilter === "active" && (p.is_redeemed || new Date(p.expires_at) < now)) return false;
    if (statusFilter === "redeemed" && !p.is_redeemed) return false;
    if (statusFilter === "expired" && (p.is_redeemed || new Date(p.expires_at) >= now)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.customer_phone.includes(q) ||
        p.customer_name?.toLowerCase().includes(q) ||
        p.coupon_code.toLowerCase().includes(q) ||
        p.prize_label.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeCount = prizes.filter(p => !p.is_redeemed && new Date(p.expires_at) >= now).length;
  const redeemedCount = prizes.filter(p => p.is_redeemed).length;
  const expiredCount = prizes.filter(p => !p.is_redeemed && new Date(p.expires_at) < now).length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">{prizes.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground">Ativos</p><p className="text-2xl font-bold text-emerald-600">{activeCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground">Resgatados</p><p className="text-2xl font-bold text-blue-600">{redeemedCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 px-4"><p className="text-xs text-muted-foreground">Expirados</p><p className="text-2xl font-bold text-muted-foreground">{expiredCount}</p></CardContent></Card>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por telefone, nome, código..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-[140px] h-9"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="redeemed">Resgatados</SelectItem>
            <SelectItem value="expired">Expirados</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" className="gap-1 ml-auto" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" />Dar Prêmio
        </Button>
      </div>

      {/* Table */}
      <ScrollArea className="h-[calc(100vh-420px)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Prêmio</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum prêmio encontrado</TableCell></TableRow>
            ) : filtered.slice(0, 200).map(p => {
              const isExpired = !p.is_redeemed && new Date(p.expires_at) < now;
              return (
                <TableRow key={p.id} className="text-sm">
                  <TableCell>
                    <div>
                      <p className="font-medium">{p.customer_name || "—"}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{p.customer_phone}</p>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{p.prize_label}</TableCell>
                  <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{p.coupon_code}</span></TableCell>
                  <TableCell className="text-xs">
                    {p.prize_type === "discount_percent" ? `${p.prize_value}%` :
                     p.prize_type === "free_shipping" ? "Frete grátis" :
                     `R$ ${p.prize_value.toFixed(2)}`}
                  </TableCell>
                  <TableCell>
                    {p.is_redeemed ? (
                      <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 text-[10px]">Resgatado</Badge>
                    ) : isExpired ? (
                      <Badge variant="secondary" className="text-[10px]">Expirado</Badge>
                    ) : (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px]">Ativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(p.expires_at).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {p.source === "wheel" ? "Roleta" : p.source === "crm_manual" ? "CRM" : p.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {!p.is_redeemed && !isExpired && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => markRedeemed(p.id)} title="Marcar como resgatado">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deletePrize(p.id)} title="Remover">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {filtered.length > 200 && <p className="text-xs text-muted-foreground text-center py-2">Mostrando 200 de {filtered.length}</p>}
      </ScrollArea>

      {/* Create Prize Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Gift className="h-5 w-5" />Conceder Prêmio</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Telefone do cliente *</Label>
              <Input placeholder="11999999999" value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nome</Label>
                <Input placeholder="Nome do cliente" value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input placeholder="email@exemplo.com" value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Nome do prêmio *</Label>
              <Input placeholder="Ex: 10% off na próxima compra" value={form.prize_label} onChange={e => setForm(f => ({ ...f, prize_label: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={form.prize_type} onValueChange={v => setForm(f => ({ ...f, prize_type: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="discount_percent">% Desconto</SelectItem>
                    <SelectItem value="discount_fixed">R$ Desconto</SelectItem>
                    <SelectItem value="free_shipping">Frete Grátis</SelectItem>
                    <SelectItem value="gift">Brinde</SelectItem>
                    <SelectItem value="cashback">Cashback</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Valor</Label>
                <Input type="number" placeholder="10" value={form.prize_value} onChange={e => setForm(f => ({ ...f, prize_value: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Validade (dias)</Label>
                <Input type="number" placeholder="30" value={form.expiry_days} onChange={e => setForm(f => ({ ...f, expiry_days: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Input placeholder="Notas internas..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button size="sm" onClick={createPrize} disabled={creating} className="gap-1">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" />}
              Conceder Prêmio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
