import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Wifi, WifiOff, QrCode, MessageCircle, RefreshCw, Power, Webhook, Bot, BotOff, Globe } from "lucide-react";
import QRCode from "react-qr-code";

interface UazapiInstance {
  id: string;
  label: string;
  phone_display: string;
  provider: string;
  is_active: boolean;
  is_default: boolean;
  is_online: boolean | null;
  ai_paused: boolean | null;
  uazapi_proxy_mode: string | null;
  uazapi_proxy_managed_country: string | null;
  uazapi_proxy_managed_state: string | null;
  uazapi_proxy_managed_city: string | null;
  last_health_check: string | null;
  uazapi_owner: string | null;
  uazapi_instance_name: string | null;
  created_at: string;
}

interface ProxyCity {
  value: string;
  label?: string;
  name?: string;
  state?: string;
}

export function UazapiInstanceManager() {
  const { toast } = useToast();
  const [instances, setInstances] = useState<UazapiInstance[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [formLabel, setFormLabel] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [creating, setCreating] = useState(false);

  // QR dialog
  const [qrOpen, setQrOpen] = useState(false);
  const [qrInstance, setQrInstance] = useState<UazapiInstance | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string>("");
  const [qrLoading, setQrLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [actingId, setActingId] = useState<string | null>(null);

  // Proxy dialog
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyInstance, setProxyInstance] = useState<UazapiInstance | null>(null);
  const [proxyMode, setProxyMode] = useState<"internal" | "custom" | "none">("internal");
  const [proxyState, setProxyState] = useState<string>("");
  const [proxyCity, setProxyCity] = useState<string>("");
  const [proxyUrl, setProxyUrl] = useState<string>("");
  const [proxyFallback, setProxyFallback] = useState<string>("internal_proxy");
  const [proxyCities, setProxyCities] = useState<ProxyCity[]>([]);
  const [proxyCitiesLoading, setProxyCitiesLoading] = useState(false);
  const [proxyStatus, setProxyStatus] = useState<string>("");
  const [proxySaving, setProxySaving] = useState(false);

  const fetchInstances = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_numbers")
      .select("id, label, phone_display, provider, is_active, is_default, is_online, ai_paused, uazapi_proxy_mode, uazapi_proxy_managed_country, uazapi_proxy_managed_state, uazapi_proxy_managed_city, last_health_check, uazapi_owner, uazapi_instance_name, created_at")
      .eq("provider", "uazapi")
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Erro", description: "Falha ao carregar instâncias", variant: "destructive" });
    } else {
      setInstances((data || []) as UazapiInstance[]);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleCreate = async () => {
    if (!formLabel.trim()) {
      toast({ title: "Preencha o nome de exibição", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-session", {
        body: { action: "create", label: formLabel.trim(), phone: formPhone.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Instância criada!", description: "Agora escaneie o QR Code para conectar." });
      setCreateOpen(false);
      setFormLabel("");
      setFormPhone("");
      await fetchInstances();
    } catch (e) {
      toast({ title: "Erro ao criar instância", description: (e as Error).message, variant: "destructive" });
    }
    setCreating(false);
  };

  const refreshQr = useCallback(async (inst: UazapiInstance) => {
    setQrLoading(true);
    try {
      const { data: conn } = await supabase.functions.invoke("uazapi-session", {
        body: { action: "connect", whatsapp_number_id: inst.id },
      });
      let code = conn?.qrCode ?? null;
      const status = conn?.status ?? "";
      if (!code) {
        const { data: qr } = await supabase.functions.invoke("uazapi-session", {
          body: { action: "qrcode", whatsapp_number_id: inst.id },
        });
        code = qr?.qrCode ?? null;
      }
      setQrCode(code);
      setQrStatus(status);
    } catch (e) {
      toast({ title: "Erro ao gerar QR", description: (e as Error).message, variant: "destructive" });
    }
    setQrLoading(false);
  }, [toast]);

  const openQr = async (inst: UazapiInstance) => {
    setQrInstance(inst);
    setQrCode(null);
    setQrStatus("");
    setQrOpen(true);
    await refreshQr(inst);

    stopPolling();
    pollRef.current = setInterval(async () => {
      const { data } = await supabase.functions.invoke("uazapi-session", {
        body: { action: "status", whatsapp_number_id: inst.id },
      });
      const status = (data?.status || "").toString();
      setQrStatus(status);
      if (data?.is_online) {
        stopPolling();
        toast({ title: "✅ Conectado!", description: `${inst.label} está online.` });
        setQrOpen(false);
        fetchInstances();
      } else {
        const { data: qr } = await supabase.functions.invoke("uazapi-session", {
          body: { action: "qrcode", whatsapp_number_id: inst.id },
        });
        if (qr?.qrCode) setQrCode(qr.qrCode);
      }
    }, 4000);
  };

  const closeQr = () => {
    stopPolling();
    setQrOpen(false);
    setQrInstance(null);
    setQrCode(null);
  };

  const repairEvents = async (inst: UazapiInstance) => {
    setActingId(inst.id);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-session", {
        body: { action: "update_events", whatsapp_number_id: inst.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "✅ Webhook atualizado", description: "Eventos de mensagens e status reativados." });
    } catch (e) {
      toast({ title: "Erro ao reparar webhook", description: (e as Error).message, variant: "destructive" });
    }
    setActingId(null);
  };

  const checkStatus = async (inst: UazapiInstance) => {
    setActingId(inst.id);
    try {
      const { data } = await supabase.functions.invoke("uazapi-session", {
        body: { action: "status", whatsapp_number_id: inst.id },
      });
      toast({
        title: data?.is_online ? "✅ Online" : "❌ Offline",
        description: `Status: ${data?.status ?? "desconhecido"}`,
        variant: data?.is_online ? "default" : "destructive",
      });
      await fetchInstances();
    } catch {
      toast({ title: "Erro ao verificar status", variant: "destructive" });
    }
    setActingId(null);
  };

  const disconnect = async (inst: UazapiInstance) => {
    if (!confirm(`Desconectar "${inst.label}"?`)) return;
    setActingId(inst.id);
    try {
      await supabase.functions.invoke("uazapi-session", {
        body: { action: "disconnect", whatsapp_number_id: inst.id },
      });
      toast({ title: "Desconectado" });
      await fetchInstances();
    } catch {
      toast({ title: "Erro ao desconectar", variant: "destructive" });
    }
    setActingId(null);
  };

  const toggleAi = async (inst: UazapiInstance) => {
    const next = !inst.ai_paused;
    if (next && !confirm(`Pausar TODAS as IAs/automações da instância "${inst.label}"? Nenhuma resposta automática será enviada por esse número até você reativar.`)) return;
    setActingId(inst.id);
    try {
      const { error } = await supabase
        .from("whatsapp_numbers")
        .update({ ai_paused: next })
        .eq("id", inst.id);
      if (error) throw error;
      toast({
        title: next ? "🤖 IA pausada" : "✅ IA ativada",
        description: next
          ? `Nenhuma automação responde por "${inst.label}" até reativar.`
          : `Automações liberadas para "${inst.label}".`,
      });
      await fetchInstances();
    } catch (e) {
      toast({ title: "Erro ao alterar IA", description: (e as Error).message, variant: "destructive" });
    }
    setActingId(null);
  };

  const handleDelete = async (inst: UazapiInstance) => {
    if (!confirm(`Excluir a instância "${inst.label}"? Isso remove a sessão na uazapi. O histórico de conversas é preservado.`)) return;
    setActingId(inst.id);
    try {
      await supabase.functions.invoke("uazapi-session", {
        body: { action: "delete", whatsapp_number_id: inst.id, delete_row: true },
      });
      toast({ title: "Instância excluída" });
      await fetchInstances();
    } catch {
      toast({ title: "Erro ao excluir", variant: "destructive" });
    }
    setActingId(null);
  };

  const loadProxyCities = useCallback(async (instId: string, state: string) => {
    setProxyCitiesLoading(true);
    try {
      const { data } = await supabase.functions.invoke("uazapi-session", {
        body: { action: "proxy_cities", whatsapp_number_id: instId, country: "br", state: state || undefined },
      });
      const raw = data?.cities;
      const list: ProxyCity[] = Array.isArray(raw) ? raw : (raw?.cities ?? []);
      setProxyCities(list);
    } catch {
      setProxyCities([]);
    }
    setProxyCitiesLoading(false);
  }, []);

  const openProxy = async (inst: UazapiInstance) => {
    setProxyInstance(inst);
    setProxyMode((inst.uazapi_proxy_mode as "internal" | "custom" | "none") || "internal");
    setProxyState(inst.uazapi_proxy_managed_state || "");
    setProxyCity(inst.uazapi_proxy_managed_city || "");
    setProxyUrl("");
    setProxyFallback("internal_proxy");
    setProxyStatus("");
    setProxyCities([]);
    setProxyOpen(true);
    // Lê o estado runtime real do proxy
    try {
      const { data } = await supabase.functions.invoke("uazapi-session", {
        body: { action: "get_proxy", whatsapp_number_id: inst.id },
      });
      const p = data?.proxy;
      if (p) {
        const eff = p.effective_mode || p.mode || "—";
        const detail = p.effective_detail ? ` (${p.effective_detail})` : "";
        const fb = p.fallback?.active ? " ⚠️ em fallback" : "";
        setProxyStatus(`Em uso: ${eff}${detail}${fb}`);
      }
    } catch { /* noop */ }
    loadProxyCities(inst.id, inst.uazapi_proxy_managed_state || "");
  };

  const saveProxy = async () => {
    if (!proxyInstance) return;
    setProxySaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: "set_proxy",
        whatsapp_number_id: proxyInstance.id,
        mode: proxyMode,
      };
      if (proxyMode === "internal") {
        payload.proxy_managed_country = "br";
        if (proxyState) payload.proxy_managed_state = proxyState;
        if (proxyCity) payload.proxy_managed_city = proxyCity;
      } else if (proxyMode === "custom") {
        payload.proxy_url = proxyUrl.trim();
        payload.proxy_fallback = proxyFallback;
      }
      const { data, error } = await supabase.functions.invoke("uazapi-session", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "✅ Proxy configurado",
        description: "Reconecte a instância (QR) para o proxy entrar em uso.",
      });
      setProxyOpen(false);
      await fetchInstances();
    } catch (e) {
      toast({ title: "Erro ao configurar proxy", description: (e as Error).message, variant: "destructive" });
    }
    setProxySaving(false);
  };

  const BR_STATES = ["ac","al","ap","am","ba","ce","df","es","go","ma","mt","ms","mg","pa","pb","pr","pe","pi","rj","rn","rs","ro","rr","sc","sp","se","to"];



  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Instâncias uazapi</h2>
          <p className="text-sm text-muted-foreground">Conecte números de WhatsApp escaneando o QR Code</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
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
              <p>Nenhuma instância uazapi configurada</p>
              <Button variant="link" onClick={() => setCreateOpen(true)}>Adicionar primeira instância</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome / Telefone</TableHead>
                  <TableHead>Instância</TableHead>
                  <TableHead>Conexão</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map(inst => {
                  const online = inst.is_online;
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
                          {inst.uazapi_instance_name ?? "—"}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          {online === true ? (
                            <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 gap-1">
                              <Wifi className="h-3 w-3" /> Online
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <WifiOff className="h-3 w-3" /> Offline
                            </Badge>
                          )}
                          {inst.ai_paused ? (
                            <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500">
                              <BotOff className="h-3 w-3" /> IA pausada
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
                              <Bot className="h-3 w-3" /> IA ativa
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => openQr(inst)} title="Conectar / QR Code">
                            <QrCode className="h-4 w-4" /> Conectar
                          </Button>
                          <Button variant="ghost" size="icon" disabled={actingId === inst.id} onClick={() => checkStatus(inst)} title="Verificar status">
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 gap-1" disabled={actingId === inst.id} onClick={() => repairEvents(inst)} title="Reativar recebimento de mensagens e status">
                            <Webhook className="h-4 w-4" /> Atualizar eventos
                          </Button>
                          <Button
                            variant={inst.ai_paused ? "outline" : "ghost"}
                            size="sm"
                            className={`h-8 gap-1 ${inst.ai_paused ? "border-amber-500/50 text-amber-500 hover:bg-amber-500/10" : ""}`}
                            disabled={actingId === inst.id}
                            onClick={() => toggleAi(inst)}
                            title={inst.ai_paused ? "Ativar IA/automações" : "Pausar IA/automações"}
                          >
                            {inst.ai_paused ? <><Bot className="h-4 w-4" /> Ativar IA</> : <><BotOff className="h-4 w-4" /> Pausar IA</>}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className={`h-8 gap-1 ${inst.uazapi_proxy_mode && inst.uazapi_proxy_mode !== "none" ? "border-sky-500/50 text-sky-500 hover:bg-sky-500/10" : ""}`}
                            disabled={actingId === inst.id}
                            onClick={() => openProxy(inst)}
                            title="Configurar proxy"
                          >
                            <Globe className="h-4 w-4" /> Proxy
                          </Button>
                          <Button variant="ghost" size="icon" disabled={actingId === inst.id} onClick={() => disconnect(inst)} title="Desconectar">
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" disabled={actingId === inst.id} onClick={() => handleDelete(inst)} title="Excluir">
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Instância uazapi</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome de exibição *</Label>
              <Input value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="Ex: Banana Calçados, Loja 2..." />
              <p className="text-xs text-muted-foreground">Aparecerá nos chats e seletores do WhatsApp</p>
            </div>
            <div className="space-y-1.5">
              <Label>Telefone (com DDI)</Label>
              <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="5533999990000" />
              <p className="text-xs text-muted-foreground">Número do WhatsApp que será conectado (opcional)</p>
            </div>
            <Button onClick={handleCreate} className="w-full" disabled={creating}>
              {creating ? "Criando..." : "Criar e gerar QR Code"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* QR Dialog */}
      <Dialog open={qrOpen} onOpenChange={(o) => { if (!o) closeQr(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Conectar {qrInstance?.label}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {qrLoading ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                <p className="text-sm">Gerando QR Code...</p>
              </div>
            ) : qrCode ? (
              <>
                <div className="bg-white p-3 rounded-lg">
                  {qrCode.startsWith("data:") || /^[A-Za-z0-9+/=]{100,}$/.test(qrCode) ? (
                    <img
                      src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                      alt="QR Code WhatsApp"
                      className="w-56 h-56"
                    />
                  ) : (
                    <QRCode
                      value={qrCode.includes("#") ? qrCode.split("#").pop()! : qrCode}
                      size={224}
                      className="w-56 h-56"
                    />
                  )}
                </div>
                <p className="text-sm text-center text-muted-foreground">
                  Abra o WhatsApp → Aparelhos conectados → Conectar aparelho e escaneie o código.
                </p>
                {qrStatus && <Badge variant="secondary">{qrStatus}</Badge>}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                <QrCode className="h-10 w-10" />
                <p className="text-sm text-center">QR Code não disponível. Tente novamente.</p>
              </div>
            )}
            <Button variant="outline" className="w-full gap-2" disabled={qrLoading} onClick={() => qrInstance && refreshQr(qrInstance)}>
              <RefreshCw className="h-4 w-4" /> Atualizar QR Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
