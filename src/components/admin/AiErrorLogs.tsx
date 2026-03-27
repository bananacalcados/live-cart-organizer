import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle, Plus, RefreshCw, Eye } from "lucide-react";
import { format } from "date-fns";

interface AiError {
  id: string;
  created_at: string;
  agent: string;
  phone: string | null;
  error_type: string;
  error_message: string | null;
  provider_attempted: string | null;
  fallback_provider: string | null;
  fallback_success: boolean;
  customer_message: string | null;
  ai_response: string | null;
  history_sent_count: number | null;
  status: string;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export function AiErrorLogs() {
  const { toast } = useToast();
  const [errors, setErrors] = useState<AiError[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedError, setSelectedError] = useState<AiError | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualAgent, setManualAgent] = useState("concierge");
  const [manualType, setManualType] = useState("");
  const [manualMessage, setManualMessage] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const fetchErrors = async () => {
    setLoading(true);
    let query = supabase
      .from("ai_error_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (agentFilter !== "all") query = query.eq("agent", agentFilter);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);

    const { data, error } = await query;
    if (error) {
      toast({ title: "Erro ao carregar logs", variant: "destructive" });
    } else {
      setErrors((data as any[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchErrors(); }, [agentFilter, statusFilter]);

  const resolveError = async (errorId: string) => {
    const { error } = await supabase
      .from("ai_error_logs")
      .update({
        status: "resolved",
        resolution_notes: resolutionNotes,
        resolved_at: new Date().toISOString(),
        resolved_by: "admin",
      } as any)
      .eq("id", errorId);

    if (error) {
      toast({ title: "Erro ao resolver", variant: "destructive" });
    } else {
      toast({ title: "Erro marcado como resolvido ✅" });
      setSelectedError(null);
      setResolutionNotes("");
      fetchErrors();
    }
  };

  const addManualError = async () => {
    if (!manualType.trim()) return;
    const { error } = await supabase.from("ai_error_logs").insert({
      agent: manualAgent,
      phone: manualPhone || null,
      error_type: "manual",
      error_message: manualMessage || manualType,
      provider_attempted: "manual_report",
      status: "open",
      customer_message: manualType,
    } as any);

    if (error) {
      toast({ title: "Erro ao registrar", variant: "destructive" });
    } else {
      toast({ title: "Erro registrado manualmente ✅" });
      setManualOpen(false);
      setManualType("");
      setManualMessage("");
      setManualPhone("");
      fetchErrors();
    }
  };

  const statusBadge = (status: string, fallbackSuccess: boolean) => {
    if (status === "resolved") return <Badge className="bg-green-600 text-white">Resolvido</Badge>;
    if (fallbackSuccess) return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Fallback OK</Badge>;
    return <Badge variant="destructive">Aberto</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" /> Erros das IAs
        </h2>
        <div className="flex items-center gap-2">
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Agente" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos agentes</SelectItem>
              <SelectItem value="concierge">Bia (Concierge)</SelectItem>
              <SelectItem value="livete">Livete</SelectItem>
              <SelectItem value="secretary">Secretária</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="open">Abertos</SelectItem>
              <SelectItem value="resolved">Resolvidos</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchErrors} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Dialog open={manualOpen} onOpenChange={setManualOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Registrar Erro</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Registrar Erro Manualmente</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Agente</Label>
                  <Select value={manualAgent} onValueChange={setManualAgent}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="concierge">Bia (Concierge)</SelectItem>
                      <SelectItem value="livete">Livete</SelectItem>
                      <SelectItem value="secretary">Secretária</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone (opcional)</Label>
                  <Input value={manualPhone} onChange={e => setManualPhone(e.target.value)} placeholder="5511999999999" />
                </div>
                <div className="space-y-1.5">
                  <Label>Descrição do erro</Label>
                  <Input value={manualType} onChange={e => setManualType(e.target.value)} placeholder="Ex: Bia respondeu sobre vendas" />
                </div>
                <div className="space-y-1.5">
                  <Label>Detalhes (opcional)</Label>
                  <Textarea value={manualMessage} onChange={e => setManualMessage(e.target.value)} placeholder="O que aconteceu exatamente..." rows={3} />
                </div>
                <Button onClick={addManualError} disabled={!manualType.trim()} className="w-full">Registrar</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Data</TableHead>
                <TableHead className="w-28">Agente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="w-32">Provider</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {loading ? "Carregando..." : "Nenhum erro registrado 🎉"}
                  </TableCell>
                </TableRow>
              )}
              {errors.map(err => (
                <TableRow key={err.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(err.created_at), "dd/MM HH:mm")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{err.agent}</Badge>
                  </TableCell>
                  <TableCell className="text-sm max-w-[300px] truncate" title={err.error_message || ""}>
                    {err.error_type === "manual" ? "📝 " : "⚠️ "}
                    {err.error_message?.slice(0, 80) || err.error_type}
                  </TableCell>
                  <TableCell className="text-xs">
                    {err.provider_attempted}
                    {err.fallback_provider && <span className="text-muted-foreground"> → {err.fallback_provider}</span>}
                  </TableCell>
                  <TableCell>{statusBadge(err.status, err.fallback_success)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedError(err); setResolutionNotes(err.resolution_notes || ""); }}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail / Resolve dialog */}
      <Dialog open={!!selectedError} onOpenChange={() => setSelectedError(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Detalhes do Erro</DialogTitle></DialogHeader>
          {selectedError && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-medium text-muted-foreground">Agente:</span> {selectedError.agent}</div>
                <div><span className="font-medium text-muted-foreground">Data:</span> {format(new Date(selectedError.created_at), "dd/MM/yyyy HH:mm:ss")}</div>
                <div><span className="font-medium text-muted-foreground">Provider:</span> {selectedError.provider_attempted}</div>
                <div><span className="font-medium text-muted-foreground">Fallback:</span> {selectedError.fallback_provider || "—"} {selectedError.fallback_success ? "✅" : "❌"}</div>
                {selectedError.phone && <div className="col-span-2"><span className="font-medium text-muted-foreground">Telefone:</span> {selectedError.phone}</div>}
                {selectedError.history_sent_count != null && <div><span className="font-medium text-muted-foreground">Histórico:</span> {selectedError.history_sent_count} msgs</div>}
              </div>

              <div>
                <Label className="text-muted-foreground">Tipo do Erro</Label>
                <p className="bg-muted p-2 rounded text-xs font-mono break-all">{selectedError.error_type}</p>
              </div>

              {selectedError.error_message && (
                <div>
                  <Label className="text-muted-foreground">Mensagem de Erro</Label>
                  <p className="bg-muted p-2 rounded text-xs font-mono break-all">{selectedError.error_message}</p>
                </div>
              )}

              {selectedError.customer_message && (
                <div>
                  <Label className="text-muted-foreground">Mensagem do Cliente</Label>
                  <p className="bg-muted p-2 rounded text-xs">{selectedError.customer_message}</p>
                </div>
              )}

              {selectedError.ai_response && (
                <div>
                  <Label className="text-muted-foreground">Resposta da IA</Label>
                  <p className="bg-muted p-2 rounded text-xs">{selectedError.ai_response}</p>
                </div>
              )}

              <div className="border-t pt-3 space-y-2">
                <Label>Notas de Resolução</Label>
                <Textarea
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  placeholder="Causa raiz, solução aplicada..."
                  rows={3}
                  disabled={selectedError.status === "resolved"}
                />
                {selectedError.status !== "resolved" && (
                  <Button onClick={() => resolveError(selectedError.id)} className="w-full gap-2">
                    <CheckCircle className="h-4 w-4" /> Marcar como Resolvido
                  </Button>
                )}
                {selectedError.status === "resolved" && selectedError.resolved_at && (
                  <p className="text-xs text-muted-foreground">
                    Resolvido em {format(new Date(selectedError.resolved_at), "dd/MM/yyyy HH:mm")} por {selectedError.resolved_by}
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
