import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { Hash, ArrowLeft, Plus, Pencil, Zap, AlertTriangle, Ban } from "lucide-react";
import { InutilizarFiscalDialog } from "@/components/fiscal/InutilizarFiscalDialog";

interface Company {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string;
  is_pilot: boolean;
  is_active: boolean;
}

interface Sequence {
  id: string;
  company_id: string;
  modelo: number; // 55 NF-e | 65 NFC-e
  serie: number;
  ambiente: "homologacao" | "producao";
  last_number: number;
  notes: string | null;
  updated_at: string;
}

const MODELO_LABEL: Record<number, string> = {
  55: "NF-e (modelo 55)",
  65: "NFC-e (modelo 65)",
};

export default function FiscalNumbering() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [companyId, setCompanyId] = useState("");
  const [modelo, setModelo] = useState<55 | 65>(65);
  const [serie, setSerie] = useState(1);
  const [ambiente, setAmbiente] = useState<"homologacao" | "producao">("homologacao");
  const [startNumber, setStartNumber] = useState(0);
  const [notes, setNotes] = useState("");

  const load = async () => {
    setLoading(true);
    const [c, s] = await Promise.all([
      (supabase as any).from("companies").select("id,legal_name,trade_name,cnpj,is_pilot,is_active").order("legal_name"),
      (supabase as any).from("fiscal_sequences").select("*").order("updated_at", { ascending: false }),
    ]);
    if (c.error) toast({ title: "Erro empresas", description: c.error.message, variant: "destructive" });
    else setCompanies(c.data || []);
    if (s.error) toast({ title: "Erro sequências", description: s.error.message, variant: "destructive" });
    else setSequences(s.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const companyName = (id: string) => {
    const c = companies.find((x) => x.id === id);
    return c ? (c.trade_name || c.legal_name) : id.slice(0, 8);
  };

  const handleSave = async () => {
    if (!companyId) {
      toast({ title: "Selecione uma empresa", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).rpc("set_fiscal_sequence_start", {
      p_company_id: companyId,
      p_modelo: modelo,
      p_serie: serie,
      p_ambiente: ambiente,
      p_starting_number: startNumber,
      p_notes: notes || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Numeração configurada", description: `Próxima emissão = ${startNumber + 1}` });
    setOpen(false);
    setNotes("");
    load();
  };

  const handleTestNext = async (seq: Sequence) => {
    if (!confirm(`Reservar próximo número de teste para ${MODELO_LABEL[seq.modelo]} série ${seq.serie} (${seq.ambiente})?\n\nIsso AVANÇA a numeração em +1 (irreversível).`)) return;
    setTesting(true);
    const { data, error } = await (supabase as any).rpc("get_next_fiscal_number", {
      p_company_id: seq.company_id,
      p_modelo: seq.modelo,
      p_serie: seq.serie,
      p_ambiente: seq.ambiente,
    });
    setTesting(false);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    const nextNum = data?.[0]?.next_number;
    toast({ title: "Próximo número reservado", description: `Nº ${nextNum}` });
    load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Hash className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Numeração Fiscal</h1>
              <p className="text-xs text-muted-foreground">Sequências NF-e / NFC-e por CNPJ</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/companies")} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Empresas
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Sequências de Numeração</h2>
            <p className="text-sm text-muted-foreground">
              Cada CNPJ controla sua própria numeração por modelo + série + ambiente. Reserva atômica via advisory lock.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Configurar Numeração</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Inicializar / Atualizar Numeração</DialogTitle>
              </DialogHeader>

              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Atenção:</strong> Para CNPJs migrados do Tiny, informe o <strong>último número emitido</strong> no Tiny.
                  A próxima emissão será <strong>último + 1</strong>. CNPJ Novo (piloto) começa em 0.
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Empresa (CNPJ)</Label>
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {companies.filter(c => c.is_active).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.trade_name || c.legal_name}{c.is_pilot && " (piloto)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Modelo</Label>
                    <Select value={String(modelo)} onValueChange={(v) => setModelo(Number(v) as 55 | 65)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="65">65 — NFC-e</SelectItem>
                        <SelectItem value="55">55 — NF-e</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Série</Label>
                    <Input type="number" min={0} max={999} value={serie} onChange={(e) => setSerie(Number(e.target.value))} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Ambiente</Label>
                  <Select value={ambiente} onValueChange={(v) => setAmbiente(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="homologacao">Homologação (testes)</SelectItem>
                      <SelectItem value="producao">Produção (real)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Último número emitido no Tiny (ou 0 se novo)</Label>
                  <Input type="number" min={0} value={startNumber} onChange={(e) => setStartNumber(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">Próxima emissão = {startNumber + 1}</p>
                </div>

                <div className="space-y-1.5">
                  <Label>Notas (opcional)</Label>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: migrado do Tiny em 07/05/2026" />
                </div>

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? "Salvando..." : "Salvar Numeração"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : sequences.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                Nenhuma sequência configurada. Comece pelo CNPJ piloto (modelo 65, série 1, homologação, número 0).
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Série</TableHead>
                    <TableHead>Ambiente</TableHead>
                    <TableHead>Último Nº</TableHead>
                    <TableHead>Próximo Nº</TableHead>
                    <TableHead>Atualizado</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sequences.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{companyName(s.company_id)}</TableCell>
                      <TableCell className="text-xs">{MODELO_LABEL[s.modelo] || s.modelo}</TableCell>
                      <TableCell className="font-mono text-xs">{s.serie}</TableCell>
                      <TableCell>
                        {s.ambiente === "producao" ? (
                          <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-xs">Produção</Badge>
                        ) : (
                          <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 text-xs">Homologação</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">{s.last_number}</TableCell>
                      <TableCell className="font-mono text-primary font-semibold">{s.last_number + 1}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(s.updated_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={testing}
                          onClick={() => handleTestNext(s)}
                          title="Reservar próximo número (teste)"
                        >
                          <Zap className="h-4 w-4 text-amber-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
          <p><strong className="text-foreground">⚙️ Como funciona:</strong></p>
          <p>• Cada combinação <code>empresa + modelo + série + ambiente</code> tem sua própria numeração.</p>
          <p>• Emissão chama <code>get_next_fiscal_number()</code> que reserva o próximo nº de forma atômica (lock por transação).</p>
          <p>• Mesmo com 100 emissões simultâneas, ninguém recebe o mesmo número.</p>
          <p>• Para migrar de Tiny: configure aqui o <strong>último nº emitido</strong> antes da primeira venda no novo sistema.</p>
        </div>
      </main>
    </div>
  );
}
