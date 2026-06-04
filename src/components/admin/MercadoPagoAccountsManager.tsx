import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, CheckCircle2, AlertTriangle, CreditCard, Copy, Webhook } from "lucide-react";

interface MpAccount {
  id: string;
  name: string;
  cnpj: string | null;
  description: string | null;
  has_access_token?: boolean;
  public_key: string | null;
  is_sandbox: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const emptyForm = {
  name: "",
  cnpj: "",
  description: "",
  access_token: "",
  public_key: "",
  is_sandbox: false,
};

export function MercadoPagoAccountsManager() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<MpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MpAccount | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const fetchAccounts = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("mercadopago_accounts")
      .select("id, name, cnpj, description, public_key, has_access_token, is_sandbox, is_active, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      setAccounts((data as MpAccount[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (acc: MpAccount) => {
    setEditing(acc);
    setForm({
      name: acc.name,
      cnpj: acc.cnpj || "",
      description: acc.description || "",
      access_token: "",
      public_key: acc.public_key || "",
      is_sandbox: acc.is_sandbox,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || (!editing && !form.access_token.trim())) {
      toast({
        title: "Campos obrigatórios",
        description: editing ? "Nome é obrigatório" : "Nome e Access Token são obrigatórios",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const payload: any = {
          name: form.name.trim(),
          cnpj: form.cnpj.trim() || null,
          description: form.description.trim() || null,
          public_key: form.public_key.trim() || null,
          is_sandbox: form.is_sandbox,
        };
        // Só substitui o token se um novo valor for informado (em branco = mantém o atual)
        if (form.access_token.trim()) payload.access_token = form.access_token.trim();
        const { error } = await (supabase as any)
          .from("mercadopago_accounts")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
        toast({ title: "Conta atualizada" });
      } else {
        const { error } = await (supabase as any)
          .from("mercadopago_accounts")
          .insert({
            name: form.name.trim(),
            cnpj: form.cnpj.trim() || null,
            description: form.description.trim() || null,
            access_token: form.access_token.trim(),
            public_key: form.public_key.trim() || null,
            is_sandbox: form.is_sandbox,
            is_active: false,
          });
        if (error) throw error;
        toast({ title: "Conta cadastrada", description: "Use o botão 'Ativar' para começar a usar." });
      }
      setDialogOpen(false);
      fetchAccounts();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id: string) => {
    const { error } = await (supabase as any).rpc("set_active_mp_account", { p_account_id: id });
    if (error) {
      toast({ title: "Erro ao ativar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Conta ativada", description: "Novos PIX/Boleto serão processados por essa conta." });
      fetchAccounts();
    }
  };

  const handleDelete = async (acc: MpAccount) => {
    if (acc.is_active) {
      toast({ title: "Não pode excluir", description: "Ative outra conta antes de excluir esta.", variant: "destructive" });
      return;
    }
    if (!confirm(`Excluir a conta "${acc.name}"? Pedidos antigos vinculados continuarão funcionando (uso histórico do token).`)) return;
    const { error } = await (supabase as any).from("mercadopago_accounts").delete().eq("id", acc.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Conta excluída" });
      fetchAccounts();
    }
  };

  const projectId = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID || "tqxhcyuxgqbzqwoidpie";
  const webhookUrl = `https://${projectId}.supabase.co/functions/v1/payment-webhook`;

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast({ title: "URL copiada", description: "Cole no painel do Mercado Pago." });
    } catch {
      toast({ title: "Erro ao copiar", description: webhookUrl, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Contas Mercado Pago
          </CardTitle>
          <CardDescription>
            Gerencie múltiplas contas (CNPJs). A conta marcada como <Badge variant="default" className="mx-1">Ativa</Badge>
            processa todos os novos PIX e boletos. Pedidos já criados continuam usando o token original.
          </CardDescription>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Nova Conta
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Painel de Webhook URL — válida para todas as contas */}
        <div className="rounded-md border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Webhook className="h-4 w-4" />
            URL de Webhook (Notificações)
          </div>
          <p className="text-xs text-muted-foreground">
            Cadastre essa URL em cada conta do Mercado Pago em
            {" "}
            <strong>Suas Integrações → Webhooks → Configurar notificações → URL para Produção</strong>.
            Marque o evento <strong>Pagamentos</strong>. A mesma URL serve para todas as contas — o sistema identifica
            automaticamente qual conta processou cada pagamento.
          </p>
          <div className="flex items-center gap-2">
            <Input value={webhookUrl} readOnly className="font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={copyWebhook}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : accounts.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-5 w-5 inline mr-2 text-yellow-500" />
            Nenhuma conta cadastrada. O sistema está usando o token configurado em variáveis de ambiente (compatibilidade legado).
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>CPF/CNPJ</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Ambiente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell>
                    <div className="font-medium">{acc.name}</div>
                    {acc.description && (
                      <div className="text-xs text-muted-foreground">{acc.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{acc.cnpj || "—"}</TableCell>
                  <TableCell className="text-xs">
                    {acc.has_access_token ? (
                      <Badge variant="outline" className="text-green-600 border-green-600">Configurado</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">—</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {acc.is_sandbox ? (
                      <Badge variant="outline" className="text-yellow-600 border-yellow-600">Sandbox</Badge>
                    ) : (
                      <Badge variant="outline" className="text-green-600 border-green-600">Produção</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {acc.is_active ? (
                      <Badge className="bg-green-600 hover:bg-green-700">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Ativa
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inativa</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {!acc.is_active && (
                      <Button size="sm" variant="default" onClick={() => handleActivate(acc.id)}>
                        Ativar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openEdit(acc)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(acc)} disabled={acc.is_active}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Conta" : "Nova Conta Mercado Pago"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nome *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Loja Centro - CNPJ X" />
              </div>
              <div>
                <Label>CPF ou CNPJ</Label>
                <Input
                  value={form.cnpj}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  placeholder="000.000.000-00 ou 00.000.000/0001-00"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Aceita conta pessoa física (CPF) ou jurídica (CNPJ).
                </p>
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Notas internas" />
              </div>
              <div>
                <Label>Access Token * (Mercado Pago)</Label>
                <Input
                  value={form.access_token}
                  onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                  placeholder="APP_USR-xxxxxxxxxxxx"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label>Public Key</Label>
                <Input
                  value={form.public_key}
                  onChange={(e) => setForm({ ...form, public_key: e.target.value })}
                  placeholder="APP_USR-xxxxxxxxxxxx"
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="sandbox"
                  checked={form.is_sandbox}
                  onCheckedChange={(v) => setForm({ ...form, is_sandbox: v })}
                />
                <Label htmlFor="sandbox" className="cursor-pointer">Conta de teste (sandbox)</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Salvando…" : editing ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
