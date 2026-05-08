import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Ban } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Company { id: string; legal_name: string; trade_name: string | null; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  defaultCompanyId?: string;
  defaultModelo?: 55 | 65;
  defaultSerie?: number;
  defaultAmbiente?: "homologacao" | "producao";
  onDone?: () => void;
}

export function InutilizarFiscalDialog({ open, onOpenChange, companies, defaultCompanyId, defaultModelo, defaultSerie, defaultAmbiente, onDone }: Props) {
  const [companyId, setCompanyId] = useState(defaultCompanyId || "");
  const [modelo, setModelo] = useState<55 | 65>(defaultModelo || 65);
  const [serie, setSerie] = useState(defaultSerie || 1);
  const [ambiente, setAmbiente] = useState<"homologacao" | "producao">(defaultAmbiente || "homologacao");
  const [numIni, setNumIni] = useState(0);
  const [numFim, setNumFim] = useState(0);
  const [justificativa, setJustificativa] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setCompanyId(defaultCompanyId || "");
      setModelo(defaultModelo || 65);
      setSerie(defaultSerie || 1);
      setAmbiente(defaultAmbiente || "homologacao");
      setNumIni(0); setNumFim(0); setJustificativa("");
    }
  }, [open, defaultCompanyId, defaultModelo, defaultSerie, defaultAmbiente]);

  const handleSubmit = async () => {
    if (!companyId) return toast.error("Selecione a empresa");
    if (!numIni || !numFim) return toast.error("Informe a faixa");
    if (numFim < numIni) return toast.error("Número final deve ser >= inicial");
    const j = justificativa.trim();
    if (j.length < 15) return toast.error("Justificativa precisa de no mínimo 15 caracteres");

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("nfce-inutilizar", {
      body: {
        company_id: companyId, modelo, serie,
        numero_inicial: numIni, numero_final: numFim,
        ambiente, justificativa: j,
      },
    });
    setLoading(false);

    if (error) return toast.error(error.message);
    if ((data as any)?.ok) {
      toast.success(`Faixa ${numIni}-${numFim} inutilizada com sucesso`);
      onOpenChange(false);
      onDone?.();
    } else {
      toast.error((data as any)?.response?.Mensagem || (data as any)?.error || "Falha na inutilização");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ban className="w-5 h-5 text-destructive" />Inutilizar faixa de numeração</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Empresa</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Modelo</Label>
              <Select value={String(modelo)} onValueChange={(v) => setModelo(Number(v) as 55 | 65)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="65">65 NFC-e</SelectItem>
                  <SelectItem value="55">55 NF-e</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Série</Label>
              <Input type="number" min={0} value={serie} onChange={(e) => setSerie(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Ambiente</Label>
              <Select value={ambiente} onValueChange={(v) => setAmbiente(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="homologacao">Homologação</SelectItem>
                  <SelectItem value="producao">Produção</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Número inicial</Label>
              <Input type="number" min={1} value={numIni} onChange={(e) => setNumIni(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Número final</Label>
              <Input type="number" min={1} value={numFim} onChange={(e) => setNumFim(Number(e.target.value))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Justificativa (15-255 chars)</Label>
            <Textarea rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} maxLength={255} placeholder="Ex: Numeração quebrada por falha técnica em 08/05/2026, sem emissão dessa faixa." />
            <p className="text-xs text-muted-foreground">{justificativa.length}/255</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Voltar</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={loading || justificativa.trim().length < 15}>
            {loading ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Enviando…</> : "Inutilizar faixa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
