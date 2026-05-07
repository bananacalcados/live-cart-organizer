import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Send, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function FiscalDocuments() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saleId, setSaleId] = useState("");
  const [emitting, setEmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).from("fiscal_documents")
      .select("*, companies(razao_social, cnpj)")
      .order("created_at", { ascending: false }).limit(100);
    if (error) toast.error(error.message); else setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const emit = async () => {
    if (!saleId.trim()) return toast.error("Informe um sale_id");
    setEmitting(true);
    const { data, error } = await supabase.functions.invoke("nfce-emitir", { body: { sale_id: saleId.trim() } });
    setEmitting(false);
    if (error) return toast.error(error.message);
    if ((data as any)?.ok) {
      toast.success(`NFC-e ${(data as any).numero} autorizada`);
    } else {
      toast.error(`Falhou: ${(data as any)?.response?.Mensagem || JSON.stringify(data)}`);
    }
    load();
  };

  const statusBadge = (s: string) => {
    const map: any = {
      authorized: "default", pending: "secondary", rejected: "destructive",
      cancelled: "outline", error: "destructive", denied: "destructive", sent: "secondary",
    };
    return <Badge variant={map[s] || "outline"} className="text-xs">{s}</Badge>;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Admin</Button></Link>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6" />Documentos Fiscais</h1>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
      </div>

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

      <Card>
        <CardHeader><CardTitle>Últimas 100 emissões</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Empresa</TableHead><TableHead>Mod/Sér/Nº</TableHead>
                <TableHead>Amb.</TableHead><TableHead>Status</TableHead><TableHead>CPF</TableHead>
                <TableHead>Valor</TableHead><TableHead>Chave</TableHead><TableHead>Erro</TableHead>
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
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nenhuma emissão ainda.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
