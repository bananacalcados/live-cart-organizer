import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Instagram, Eye, EyeOff, Trash2, RefreshCw } from "lucide-react";

interface IgAccount {
  id: string;
  label: string;
  phone_display: string | null;
  instagram_account_id: string | null;
  instagram_username: string | null;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
}

export function InstagramAccountManager() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formLabel, setFormLabel] = useState("");
  const [formToken, setFormToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const fetchAccounts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_numbers_safe")
      .select("id, label, phone_display, instagram_account_id, instagram_username, is_active, is_default, created_at")
      .eq("provider", "instagram")
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Erro", description: "Falha ao carregar contas do Instagram", variant: "destructive" });
    } else {
      setAccounts((data || []) as IgAccount[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAccounts(); }, []);

  const resetForm = () => {
    setFormLabel("");
    setFormToken("");
    setShowToken(false);
    setEditingId(null);
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };
  const openEdit = (acc: IgAccount) => {
    resetForm();
    setEditingId(acc.id);
    setFormLabel(acc.label || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingId && !formToken.trim()) {
      toast({ title: "Token obrigatório", description: "Cole o token de acesso da conta do Instagram.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-account-connect", {
        body: {
          id: editingId || undefined,
          label: formLabel.trim() || undefined,
          accessToken: formToken.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.details?.error?.message || data.error);
      toast({
        title: "Conta salva",
        description: data?.account?.instagram_username
          ? `@${data.account.instagram_username} conectada com sucesso.`
          : "Conta atualizada.",
      });
      setDialogOpen(false);
      resetForm();
      fetchAccounts();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message || "Verifique o token e tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (acc: IgAccount) => {
    const { error } = await supabase
      .from("whatsapp_numbers")
      .update({ is_active: !acc.is_active })
      .eq("id", acc.id);
    if (error) {
      toast({ title: "Erro", description: "Não foi possível alterar o status.", variant: "destructive" });
    } else {
      fetchAccounts();
    }
  };

  const handleRegisterPrimary = async () => {
    if (!confirm("Registrar a conta principal (a que já estava conectada internamente via token global)? As DMs antigas do Instagram serão vinculadas a ela.")) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-account-connect", {
        body: { useGlobalToken: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.details?.error?.message || data.error);
      toast({
        title: "Conta principal registrada",
        description: `${data?.account?.instagram_username ? "@" + data.account.instagram_username : "Conta"} vinculada. ${data?.backfilled || 0} conversas antigas atualizadas.`,
      });
      fetchAccounts();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao registrar a conta principal.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (acc: IgAccount) => {
    if (!confirm(`Remover a conta ${acc.instagram_username ? "@" + acc.instagram_username : acc.label}?`)) return;
    const { error } = await supabase.from("whatsapp_numbers").delete().eq("id", acc.id);
    if (error) {
      toast({ title: "Erro", description: "Não foi possível remover a conta.", variant: "destructive" });
    } else {
      toast({ title: "Removida", description: "Conta do Instagram removida." });
      fetchAccounts();
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Instagram className="h-5 w-5" /> Contas do Instagram
            </h3>
            <p className="text-sm text-muted-foreground">
              Conecte uma ou mais contas do Instagram para receber e responder DMs no chat.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchAccounts}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar conta
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingId ? "Editar conta do Instagram" : "Nova conta do Instagram"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Nome / apelido (opcional)</Label>
                    <Input
                      value={formLabel}
                      onChange={(e) => setFormLabel(e.target.value)}
                      placeholder="Ex.: Instagram Loja 2"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Token de acesso {editingId && <span className="text-muted-foreground">(deixe em branco para manter)</span>}</Label>
                    <div className="relative">
                      <Input
                        type={showToken ? "text" : "password"}
                        value={formToken}
                        onChange={(e) => setFormToken(e.target.value)}
                        placeholder="Token gerado no app da Meta para este perfil"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowToken((s) => !s)}
                      >
                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O @usuário e o ID da conta são detectados automaticamente a partir do token.
                    </p>
                  </div>
                  <Button className="w-full" onClick={handleSave} disabled={saving}>
                    {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Conectar conta"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conta do Instagram conectada ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conta</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>ID da conta</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell className="font-medium">{acc.label}</TableCell>
                  <TableCell>{acc.instagram_username ? `@${acc.instagram_username}` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{acc.instagram_account_id || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={acc.is_active ? "default" : "secondary"}>
                      {acc.is_active ? "Ativa" : "Inativa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(acc)}>Editar</Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(acc)}>
                      {acc.is_active ? "Desativar" : "Ativar"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(acc)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
