import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Send, RefreshCw, Webhook, Copy, AlertTriangle, Zap, Ban } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CancelFiscalDocDialog } from "@/components/fiscal/CancelFiscalDocDialog";

export default function FiscalDocuments() {
  const [rows, setRows] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saleId, setSaleId] = useState("");
  const [emitting, setEmitting] = useState(false);
  const [cancelDoc, setCancelDoc] = useState<any>(null);

  const webhookUrl = `https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/brasilnfe-webhook`;

  const load = async () => {
    setLoading(true);
    const [docsRes, evtRes] = await Promise.all([
      (supabase as any).from("fiscal_documents")
        .select("*, companies(razao_social, cnpj)")
        .order("created_at", { ascending: false }).limit(100),
      (supabase as any).from("fiscal_webhook_events")
        .select("*")
        .order("received_at", { ascending: false }).limit(50),
    ]);
    if (docsRes.error) toast.error(docsRes.error.message); else setRows(docsRes.data || []);
    if (!evtRes.error) setEvents(evtRes.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const emit = async () => {
    if (!saleId.trim()) return toast.error("Informe um sale_id");
    setEmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("nfce-emitir", { body: { sale_id: saleId.trim() } });
      if (error) {
        const { extractEdgeError } = await import("@/lib/edgeFunctionError");
        toast.error(await extractEdgeError(error, "Erro ao emitir NFC-e"), { duration: 12000 });
      } else if ((data as any)?.ok) {
        toast.success(`NFC-e ${(data as any).numero} autorizada`);
      } else {
        toast.error((data as any)?.error || (data as any)?.response?.Mensagem || "Falha ao emitir NFC-e", { duration: 12000 });
      }
    } finally {
      setEmitting(false);
      load();
    }
  };

  const statusBadge = (s: string) => {
    const map: any = {
      authorized: "default", pending: "secondary", rejected: "destructive",
      cancelled: "outline", error: "destructive", denied: "destructive", sent: "secondary",
      pending_sefaz: "secondary",
    };
    const label = s === "pending_sefaz" ? "contingência" : s;
    return <Badge variant={map[s] || "outline"} className="text-xs">{label}</Badge>;
  };

  const pendingSefaz = rows.filter(r => r.status === "pending_sefaz");

  const retryNow = async () => {
    const t = toast.loading("Reprocessando fila…");
    const { data, error } = await supabase.functions.invoke("nfce-retry-pending");
    toast.dismiss(t);
    if (error) return toast.error(error.message);
    toast.success(`Processadas ${(data as any)?.processed ?? 0} notas`);
    load();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Admin</Button></Link>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6" />Documentos Fiscais</h1>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {pendingSefaz.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <div>
                <CardTitle className="text-base">SEFAZ em contingência — {pendingSefaz.length} {pendingSefaz.length === 1 ? "nota pendente" : "notas pendentes"}</CardTitle>
                <CardDescription>As vendas foram concluídas. Reemissão automática a cada 5 min com backoff exponencial.</CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={retryNow}><Zap className="w-4 h-4 mr-1" />Tentar agora</Button>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Webhook className="w-5 h-5" />Webhook BrasilNFe</CardTitle>
          <CardDescription>Cole esta URL no painel BrasilNFe (Configurações → Webhooks) para receber notificações automáticas de status das notas.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input readOnly value={webhookUrl} className="font-mono text-xs" />
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("URL copiada"); }}>
            <Copy className="w-4 h-4 mr-1" />Copiar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emitir NFC-e (teste)</CardTitle>
          <CardDescription>Cole o ID da venda POS para emitir uma NFC-e modelo 65 no ambiente da empresa.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="sale_id (uuid)" value={saleId} onChange={e => setSaleId(e.target.value)} />
          <Button onClick={emit} disabled={emitting}><Send className="w-4 h-4 mr-1" />{emitting ? "Emitindo…" : "Emitir"}</Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="docs">
        <TabsList>
          <TabsTrigger value="docs">Emissões</TabsTrigger>
          <TabsTrigger value="events">Webhooks recebidos ({events.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="docs">
          <Card>
            <CardHeader><CardTitle>Últimas 100 emissões</CardTitle></CardHeader>
            <CardContent>
              {loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data</TableHead><TableHead>Empresa</TableHead><TableHead>Mod/Sér/Nº</TableHead>
                    <TableHead>Amb.</TableHead><TableHead>Status</TableHead><TableHead>CPF</TableHead>
                    <TableHead>Valor</TableHead><TableHead>Chave</TableHead><TableHead>Erro</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rows.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                        <TableCell className="text-xs">{r.companies?.razao_social}</TableCell>
                        <TableCell className="font-mono text-xs">{r.modelo}/{r.serie}/{r.numero}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{r.ambiente}</Badge></TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.cpf_destinatario}</TableCell>
                        <TableCell>R$ {Number(r.valor_total || 0).toFixed(2)}</TableCell>
                        <TableCell className="font-mono text-[10px] max-w-[180px] truncate" title={r.chave_acesso}>{r.chave_acesso || "—"}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-[200px] truncate" title={r.rejection_message}>{r.rejection_message || ""}</TableCell>
                        <TableCell className="text-right">
                          {r.status === "authorized" && (
                            <Button size="sm" variant="ghost" onClick={() => setCancelDoc(r)} title="Cancelar nota">
                              <Ban className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Nenhuma emissão ainda.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardHeader><CardTitle>Eventos recebidos da BrasilNFe</CardTitle><CardDescription>Últimos 50 callbacks (autorização, cancelamento, rejeição etc.)</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Recebido</TableHead><TableHead>Tipo</TableHead><TableHead>Chave</TableHead>
                  <TableHead>Identificador</TableHead><TableHead>Doc.</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {events.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{new Date(e.received_at).toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" title={e.event_type}>{e.event_type}</TableCell>
                      <TableCell className="font-mono text-[10px] max-w-[160px] truncate" title={e.chave_acesso}>{e.chave_acesso || "—"}</TableCell>
                      <TableCell className="font-mono text-[10px]">{e.identificador_interno || "—"}</TableCell>
                      <TableCell className="font-mono text-[10px]">{e.fiscal_document_id ? "✓" : "—"}</TableCell>
                      <TableCell>{e.processed ? <Badge variant="default" className="text-[10px]">processado</Badge> : <Badge variant="destructive" className="text-[10px]">{e.error_message || "pendente"}</Badge>}</TableCell>
                    </TableRow>
                  ))}
                  {!events.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum webhook recebido ainda.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {cancelDoc && (
        <CancelFiscalDocDialog
          open={!!cancelDoc}
          onOpenChange={(v) => { if (!v) setCancelDoc(null); }}
          fiscalDocumentId={cancelDoc.id}
          modelo={cancelDoc.modelo}
          numero={cancelDoc.numero}
          onCancelled={() => { setCancelDoc(null); load(); }}
        />
      )}
    </div>
  );
}
