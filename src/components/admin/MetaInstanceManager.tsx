import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Eye, EyeOff, MessageCircle, Copy } from "lucide-react";

interface MetaInstance {
  id: string;
  label: string;
  phone_display: string;
  provider: string;
  is_active: boolean;
  is_default: boolean;
  phone_number_id: string | null;
  business_account_id: string | null;
  has_meta_token: boolean | null;
  created_at: string;
}

export function MetaInstanceManager() {
  const { toast } = useToast();
  const [instances, setInstances] = useState<MetaInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showIds, setShowIds] = useState<Record<string, boolean>>({});

  // Form state
  const [formLabel, setFormLabel] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formPhoneNumberId, setFormPhoneNumberId] = useState("");
  const [formWabaId, setFormWabaId] = useState("");
  const [formAccessToken, setFormAccessToken] = useState("");
  const [showFormToken, setShowFormToken] = useState(false);
  const [formIsActive, setFormIsActive] = useState(true);

  const fetchInstances = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_numbers")
      .select("id, label, phone_display, provider, is_active, is_default, phone_number_id, business_account_id, access_token, created_at")
      .eq("provider", "meta")
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Erro", description: "Falha ao carregar instâncias Meta", variant: "destructive" });
    } else {
      setInstances((data || []) as MetaInstance[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  const resetForm = () => {
    setFormLabel("");
    setFormPhone("");
    setFormPhoneNumberId("");
    setFormWabaId("");
    setFormAccessToken("");
    setShowFormToken(false);
    setFormIsActive(true);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (inst: MetaInstance) => {
    setEditingId(inst.id);
    setFormLabel(inst.label);
    setFormPhone(inst.phone_display);
    setFormPhoneNumberId(inst.phone_number_id || "");
    setFormWabaId(inst.business_account_id || "");
    setFormAccessToken(inst.access_token || "");
    setShowFormToken(false);
    setFormIsActive(inst.is_active);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formLabel.trim() || !formPhoneNumberId.trim() || !formWabaId.trim()) {
      toast({ title: "Preencha Nome, Phone Number ID e WABA ID", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload: Record<string, unknown> = {
      label: formLabel.trim(),
      phone_display: formPhone.trim(),
      provider: "meta" as const,
      is_active: formIsActive,
      phone_number_id: formPhoneNumberId.trim(),
      business_account_id: formWabaId.trim(),
    };

    // Only update access_token if user typed something (don't wipe existing token on edit)
    if (formAccessToken.trim()) {
      payload.access_token = formAccessToken.trim();
    } else if (!editingId) {
      // On create, allow empty token (will need to be set later)
      payload.access_token = null;
    }

    let error;
    if (editingId) {
      ({ error } = await supabase.from("whatsapp_numbers").update(payload as never).eq("id", editingId));
    } else {
      ({ error } = await supabase.from("whatsapp_numbers").insert({ ...payload, is_default: false } as never));
    }

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editingId ? "Instância atualizada!" : "Instância criada!" });
      setDialogOpen(false);
      resetForm();
      fetchInstances();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Tem certeza que deseja excluir a instância "${label}"?`)) return;
    const { error } = await supabase.from("whatsapp_numbers").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Instância excluída!" });
      fetchInstances();
    }
  };

  const toggleVisibility = (id: string) => {
    setShowIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const maskValue = (val: string | null) => {
    if (!val) return "—";
    if (val.length <= 8) return "••••••••";
    return val.slice(0, 4) + "••••" + val.slice(-4);
  };

  const copy = (val: string) => {
    navigator.clipboard.writeText(val);
    toast({ title: "Copiado!" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Instâncias Meta (WhatsApp Cloud API)</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas conexões WhatsApp via API oficial da Meta</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nova Instância Meta
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : instances.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageCircle className="h-10 w-10 mb-2" />
              <p>Nenhuma instância Meta configurada</p>
              <Button variant="link" onClick={openCreate}>Adicionar primeira instância</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome / Telefone</TableHead>
                  <TableHead>Phone Number ID</TableHead>
                  <TableHead>WABA ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map(inst => {
                  const show = showIds[inst.id];
                  return (
                    <TableRow key={inst.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{inst.label}</p>
                          <p className="text-xs text-muted-foreground">{inst.phone_display || "Sem número"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {show ? (inst.phone_number_id || "—") : maskValue(inst.phone_number_id)}
                          </code>
                          {inst.phone_number_id && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(inst.phone_number_id!)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {show ? (inst.business_account_id || "—") : maskValue(inst.business_account_id)}
                          </code>
                          {inst.business_account_id && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(inst.business_account_id!)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleVisibility(inst.id)}>
                            {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        {inst.is_active
                          ? <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Ativo</Badge>
                          : <Badge variant="secondary">Inativo</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(inst)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(inst.id, inst.label)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Instância Meta" : "Nova Instância Meta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome de exibição *</Label>
              <Input value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="Ex: Ravena, Meta Centro..." />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone (exibição)</Label>
              <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="+55 33 99999-0000" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number ID *</Label>
              <Input value={formPhoneNumberId} onChange={e => setFormPhoneNumberId(e.target.value)} placeholder="Ex: 1009921908860145" />
              <p className="text-xs text-muted-foreground">ID do número no Meta Business / WhatsApp Cloud API</p>
            </div>
            <div className="space-y-1.5">
              <Label>WABA ID (Business Account ID) *</Label>
              <Input value={formWabaId} onChange={e => setFormWabaId(e.target.value)} placeholder="Ex: 3389632571189529" />
              <p className="text-xs text-muted-foreground">ID da Conta Business do WhatsApp (WABA)</p>
            </div>
            <div className="space-y-1.5">
              <Label>Access Token {editingId ? "" : "*"}</Label>
              <div className="flex gap-1">
                <Input
                  type={showFormToken ? "text" : "password"}
                  value={formAccessToken}
                  onChange={e => setFormAccessToken(e.target.value)}
                  placeholder={editingId ? "Deixe em branco para manter o atual" : "Cole o token gerado no Meta"}
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShowFormToken(s => !s)}>
                  {showFormToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Token de acesso (System User permanente recomendado, ou temporário 24h do API Setup)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formIsActive} onCheckedChange={setFormIsActive} />
              <Label>Instância ativa</Label>
            </div>
            <Button onClick={handleSave} className="w-full" disabled={saving}>
              {saving ? "Salvando..." : editingId ? "Salvar Alterações" : "Criar Instância"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
