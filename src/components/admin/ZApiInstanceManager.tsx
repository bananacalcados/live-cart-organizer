import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Wifi, WifiOff, Eye, EyeOff, MessageCircle } from "lucide-react";

interface ZApiInstance {
  id: string;
  label: string;
  phone_display: string;
  provider: string;
  is_active: boolean;
  is_default: boolean;
  zapi_instance_id: string | null;
  zapi_token: string | null;
  zapi_client_token: string | null;
  created_at: string;
}

export function ZApiInstanceManager() {
  const { toast } = useToast();
  const [instances, setInstances] = useState<ZApiInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});

  // Form state
  const [formLabel, setFormLabel] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formInstanceId, setFormInstanceId] = useState("");
  const [formToken, setFormToken] = useState("");
  const [formClientToken, setFormClientToken] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);

  // Connection test
  const [testingId, setTestingId] = useState<string | null>(null);
  const [connectionResults, setConnectionResults] = useState<Record<string, { connected: boolean; tested: boolean }>>({});

  const fetchInstances = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_numbers")
      .select("id, label, phone_display, provider, is_active, is_default, zapi_instance_id, zapi_token, zapi_client_token, created_at")
      .eq("provider", "zapi")
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Erro", description: "Falha ao carregar instâncias", variant: "destructive" });
    } else {
      setInstances((data || []) as ZApiInstance[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  const resetForm = () => {
    setFormLabel("");
    setFormPhone("");
    setFormInstanceId("");
    setFormToken("");
    setFormClientToken("");
    setFormIsActive(true);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (inst: ZApiInstance) => {
    setEditingId(inst.id);
    setFormLabel(inst.label);
    setFormPhone(inst.phone_display);
    setFormInstanceId(inst.zapi_instance_id || "");
    setFormToken(inst.zapi_token || "");
    setFormClientToken(inst.zapi_client_token || "");
    setFormIsActive(inst.is_active);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formLabel.trim() || !formInstanceId.trim() || !formToken.trim() || !formClientToken.trim()) {
      toast({ title: "Preencha todos os campos obrigatórios", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload = {
      label: formLabel.trim(),
      phone_display: formPhone.trim(),
      provider: "zapi" as const,
      is_active: formIsActive,
      zapi_instance_id: formInstanceId.trim(),
      zapi_token: formToken.trim(),
      zapi_client_token: formClientToken.trim(),
    };

    let error;
    if (editingId) {
      ({ error } = await supabase.from("whatsapp_numbers").update(payload).eq("id", editingId));
    } else {
      ({ error } = await supabase.from("whatsapp_numbers").insert({ ...payload, is_default: false }));
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

  const testConnection = async (inst: ZApiInstance) => {
    if (!inst.zapi_instance_id || !inst.zapi_token || !inst.zapi_client_token) {
      toast({ title: "Credenciais incompletas", variant: "destructive" });
      return;
    }
    setTestingId(inst.id);
    try {
      const zapiUrl = `https://api.z-api.io/instances/${inst.zapi_instance_id}/token/${inst.zapi_token}/status`;
      const res = await fetch(zapiUrl, {
        headers: { "Client-Token": inst.zapi_client_token },
      });
      const data = await res.json();
      const connected = data?.connected === true || data?.smartphoneConnected === true;
      setConnectionResults(prev => ({ ...prev, [inst.id]: { connected, tested: true } }));
      toast({
        title: connected ? "✅ Conectado!" : "❌ Desconectado",
        description: connected ? `${inst.label} está online` : "Verifique o QR Code no painel Z-API",
        variant: connected ? "default" : "destructive",
      });
    } catch {
      setConnectionResults(prev => ({ ...prev, [inst.id]: { connected: false, tested: true } }));
      toast({ title: "Erro ao testar conexão", variant: "destructive" });
    }
    setTestingId(null);
  };

  const toggleVisibility = (id: string) => {
    setShowTokens(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const maskValue = (val: string | null) => {
    if (!val) return "—";
    if (val.length <= 8) return "••••••••";
    return val.slice(0, 4) + "••••" + val.slice(-4);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Instâncias Z-API</h2>
          <p className="text-sm text-muted-foreground">Gerencie suas conexões WhatsApp via Z-API</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nova Instância
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
              <p>Nenhuma instância Z-API configurada</p>
              <Button variant="link" onClick={openCreate}>Adicionar primeira instância</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome / Telefone</TableHead>
                  <TableHead>Instance ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Conexão</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map(inst => {
                  const show = showTokens[inst.id];
                  const conn = connectionResults[inst.id];
                  return (
                    <TableRow key={inst.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{inst.label}</p>
                          <p className="text-xs text-muted-foreground">{inst.phone_display || "Sem número"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {show ? inst.zapi_instance_id : maskValue(inst.zapi_instance_id)}
                        </code>
                        <Button variant="ghost" size="icon" className="h-6 w-6 ml-1" onClick={() => toggleVisibility(inst.id)}>
                          {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {inst.is_active
                          ? <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Ativo</Badge>
                          : <Badge variant="secondary">Inativo</Badge>}
                      </TableCell>
                      <TableCell>
                        {conn?.tested ? (
                          conn.connected
                            ? <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 gap-1"><Wifi className="h-3 w-3" /> Online</Badge>
                            : <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" /> Offline</Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={testingId === inst.id}
                            onClick={() => testConnection(inst)}
                          >
                            {testingId === inst.id ? "Testando..." : "Testar"}
                          </Button>
                        )}
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
            <DialogTitle>{editingId ? "Editar Instância Z-API" : "Nova Instância Z-API"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome de exibição *</Label>
              <Input value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="Ex: Banana Calçados, Loja 2..." />
              <p className="text-xs text-muted-foreground">Aparecerá nos chats e seletores do WhatsApp</p>
            </div>
            <div className="space-y-1.5">
              <Label>Telefone (exibição)</Label>
              <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="+55 33 99999-0000" />
            </div>
            <div className="space-y-1.5">
              <Label>Instance ID *</Label>
              <Input value={formInstanceId} onChange={e => setFormInstanceId(e.target.value)} placeholder="Cole o Instance ID do Z-API" />
            </div>
            <div className="space-y-1.5">
              <Label>Token *</Label>
              <Input value={formToken} onChange={e => setFormToken(e.target.value)} placeholder="Cole o Token do Z-API" type="password" />
            </div>
            <div className="space-y-1.5">
              <Label>Client Token *</Label>
              <Input value={formClientToken} onChange={e => setFormClientToken(e.target.value)} placeholder="Cole o Client Token do Z-API" type="password" />
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
