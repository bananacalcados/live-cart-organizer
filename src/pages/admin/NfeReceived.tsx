import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, RefreshCw, Inbox, CheckCircle2, AlertCircle, FileSearch } from "lucide-react";
import { toast } from "sonner";

const TIPO_OPTS = [
  { v: "ciencia",         l: "Ciência da Operação" },
  { v: "confirmacao",     l: "Confirmação da Operação" },
  { v: "desconhecimento", l: "Desconhecimento da Operação" },
  { v: "nao_realizada",   l: "Operação não Realizada" },
];

const TIPO_LABEL: Record<string, string> = {
  pendente: "Pendente",
  ciencia: "Ciência",
  confirmacao: "Confirmada",
  desconhecimento: "Desconhecida",
  nao_realizada: "Não Realizada",
};

export default function NfeReceived() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [target, setTarget] = useState<any>(null);
  const [tipo, setTipo] = useState("ciencia");
  const [just, setJust] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("nfe_received")
      .select("*, companies(legal_name, cnpj)")
      .order("data_emissao", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message); else setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const puxar = async () => {
    setPulling(true);
    const { data, error } = await supabase.functions.invoke("nfe-puxar-destinadas", { body: {} });
    setPulling(false);
    if (error) return toast.error(error.message);
    const total = (data as any)?.results?.reduce((a: number, r: any) => a + (r.inseridos || 0), 0) ?? 0;
    toast.success(`Sincronização concluída — ${total} NF-e novas/atualizadas`);
    load();
  };

  const openManifest = (row: any) => {
    setTarget(row);
    setTipo("ciencia");
    setJust("");
  };

  const submit = async () => {
    if (!target) return;
    if (tipo === "nao_realizada" && just.trim().length < 15) {
      return toast.error("Justificativa mínima de 15 caracteres");
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("nfe-manifestar", {
      body: { nfe_received_id: target.id, tipo, justificativa: just.trim() || undefined },
    });
    setSubmitting(false);
    if (error || !(data as any)?.ok) {
      return toast.error((data as any)?.error || error?.message || "Falha na manifestação");
    }
    toast.success(`Manifestação registrada — protocolo ${(data as any).protocolo || "OK"}`);
    setTarget(null);
    load();
  };

  const manifBadge = (s: string) => {
    const map: any = {
      pendente: "secondary",
      ciencia: "outline",
      confirmacao: "default",
      desconhecimento: "destructive",
      nao_realizada: "destructive",
    };
    return <Badge variant={map[s] || "secondary"}>{TIPO_LABEL[s] || s}</Badge>;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Inbox className="h-6 w-6" /> NF-e Recebidas</h1>
            <p className="text-sm text-muted-foreground">NF-e em que sua empresa é destinatária — manifestação SEFAZ</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Atualizar</Button>
          <Button size="sm" onClick={puxar} disabled={pulling}>
            <FileSearch className="h-4 w-4 mr-1" /> {pulling ? "Sincronizando…" : "Puxar da SEFAZ"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documentos</CardTitle>
          <CardDescription>{rows.length} registros — sincronização automática diária às 06:00</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">Nenhuma NF-e recebida ainda. Clique em "Puxar da SEFAZ".</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Nº</TableHead>
                    <TableHead>Emitente</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Manifestação</TableHead>
                    <TableHead>Estoque</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{r.data_emissao ? new Date(r.data_emissao).toLocaleDateString("pt-BR") : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.numero || "—"}/{r.serie || "—"}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{r.emitente_nome || "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.emitente_cnpj}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.valor_total ? `R$ ${Number(r.valor_total).toFixed(2)}` : "—"}</TableCell>
                      <TableCell>{manifBadge(r.manifestacao_status)}</TableCell>
                      <TableCell>
                        {r.estoque_status === "lancado"
                          ? <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Lançado</Badge>
                          : <Badge variant="secondary">Não lançado</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openManifest(r)}>
                          Manifestar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manifestação do Destinatário</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{target?.chave_acesso}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Tipo de evento</label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPO_OPTS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {tipo === "ciencia" && "Apenas registra que você tomou ciência da NF-e (não confirma)."}
                {tipo === "confirmacao" && "Confirma que a operação ocorreu — protege contra 'cancelamento' indevido depois."}
                {tipo === "desconhecimento" && "Você desconhece esta operação (NF emitida contra seu CNPJ sem autorização)."}
                {tipo === "nao_realizada" && "A operação foi cancelada / não ocorreu (mercadoria não recebida)."}
              </p>
            </div>
            {(tipo === "nao_realizada" || tipo === "desconhecimento") && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Justificativa {tipo === "nao_realizada" && <span className="text-destructive">*</span>}
                </label>
                <Textarea value={just} onChange={(e) => setJust(e.target.value)} maxLength={255}
                  placeholder="Mínimo 15 caracteres" rows={3} />
                <div className="text-xs text-muted-foreground mt-1">{just.length}/255</div>
              </div>
            )}
            {target?.manifestacao_status !== "pendente" && (
              <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded text-xs">
                <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <span>Esta NF-e já tem manifestação registrada ({TIPO_LABEL[target?.manifestacao_status]}). Você pode reenviar/atualizar.</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancelar</Button>
            <Button onClick={submit} disabled={submitting}>{submitting ? "Enviando…" : "Enviar manifestação"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
