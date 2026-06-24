import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Upload, Images, CheckCircle2, Clock, XCircle, Layers } from "lucide-react";
import { toast } from "sonner";

const LADDER = [2, 3, 4, 5, 6, 7, 8, 9, 10];

interface MetaNumber {
  id: string;
  label: string | null;
  phone_display: string | null;
  business_account_id: string | null;
  provider: string | null;
}

interface LadderRow {
  qtd_cards: number;
  template_id: string;
  template_language: string;
  aprovado: boolean;
  meta_status: string;
  whatsapp_number_id: string | null;
  updated_at: string;
}

function statusBadge(row?: LadderRow) {
  if (!row) return <Badge variant="outline" className="gap-1"><Layers className="h-3 w-3" /> Não criado</Badge>;
  if (row.aprovado || row.meta_status === "APPROVED")
    return <Badge className="gap-1 bg-green-600 hover:bg-green-600"><CheckCircle2 className="h-3 w-3" /> Aprovado</Badge>;
  if (row.meta_status === "REJECTED")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Rejeitado</Badge>;
  return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> {row.meta_status || "Pendente"}</Badge>;
}

export function CarouselTemplatesLadder() {
  const [numbers, setNumbers] = useState<MetaNumber[]>([]);
  const [numberId, setNumberId] = useState<string>("");
  const [rows, setRows] = useState<Record<number, LadderRow>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [sampleB64, setSampleB64] = useState<string>("");
  const [sampleType, setSampleType] = useState<string>("");
  const [sampleName, setSampleName] = useState<string>("");
  const [bodyExample, setBodyExample] = useState("Confira nossas novidades 👟");
  const [cardBodyExample, setCardBodyExample] = useState("Produto incrível por um super preço");
  const [buttonText, setButtonText] = useState("Quero esse");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadNumbers = async () => {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id, label, phone_display, business_account_id, provider")
      .eq("is_active", true);
    const meta = (data || []).filter(
      (n: MetaNumber) => (n.provider === "meta" || !n.provider) && !!n.business_account_id,
    );
    setNumbers(meta);
    if (meta.length && !numberId) setNumberId(meta[0].id);
  };

  const loadRows = async () => {
    setLoading(true);
    const { data } = await supabase.from("templates_carrossel").select("*");
    const map: Record<number, LadderRow> = {};
    (data || []).forEach((r: LadderRow) => { map[r.qtd_cards] = r; });
    setRows(map);
    setLoading(false);
  };

  useEffect(() => { loadNumbers(); loadRows(); }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setSampleB64(String(reader.result));
      setSampleType(file.type);
      setSampleName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const createRow = async (qtd: number) => {
    if (!numberId) { toast.error("Selecione um número Meta/WABA"); return; }
    if (!sampleB64) { toast.error("Suba uma imagem-exemplo primeiro"); return; }
    setCreating(qtd);
    try {
      const { data, error } = await supabase.functions.invoke("carousel-ladder-create", {
        body: {
          whatsappNumberId: numberId,
          qtdCards: qtd,
          sampleImageBase64: sampleB64,
          sampleImageType: sampleType,
          bodyExample,
          cardBodyExample,
          buttonText,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      toast.success(`Template de ${qtd} cards enviado à Meta (${data?.meta_status || "PENDING"})`);
      await loadRows();
    } catch (e) {
      toast.error(`Erro ao criar template de ${qtd} cards: ${(e as Error).message}`);
    } finally {
      setCreating(null);
    }
  };

  const syncStatus = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: { whatsappNumberId: numberId },
      });
      if (error) throw error;
      const templates: Array<{ name: string; status: string }> = data?.templates || data?.data || [];
      const byName = new Map(templates.map((t) => [t.name, t.status]));
      let updated = 0;
      for (const qtd of LADDER) {
        const row = rows[qtd];
        if (!row) continue;
        const metaStatus = byName.get(row.template_id);
        if (metaStatus && metaStatus !== row.meta_status) {
          await supabase
            .from("templates_carrossel")
            .update({ meta_status: metaStatus, aprovado: metaStatus === "APPROVED" })
            .eq("qtd_cards", qtd);
          updated++;
        }
      }
      toast.success(updated ? `${updated} status atualizados` : "Status já sincronizados");
      await loadRows();
    } catch (e) {
      toast.error(`Erro ao sincronizar: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const approvedCount = LADDER.filter((q) => rows[q]?.aprovado).length;

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Images className="h-4 w-4" /> Escada de templates de carrossel
            </h3>
            <p className="text-sm text-muted-foreground">
              Crie 1 template aprovado para cada quantidade de cards (2 a 10). A vendedora nunca escolhe template — o sistema escolhe pela quantidade de fotos. {approvedCount}/9 aprovados.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={syncStatus} disabled={syncing} className="gap-1.5">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sincronizar status
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Número Meta/WABA (oficial)</Label>
            <Select value={numberId} onValueChange={setNumberId}>
              <SelectTrigger><SelectValue placeholder="Selecione o número" /></SelectTrigger>
              <SelectContent>
                {numbers.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label || n.phone_display || n.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {numbers.length === 0 && (
              <p className="text-xs text-destructive">Nenhum número Meta/WABA oficial encontrado (precisa de business_account_id).</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Imagem-exemplo (usada na criação dos templates)</Label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> {sampleName ? sampleName : "Subir imagem-exemplo"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>Texto-exemplo do corpo</Label>
            <Input value={bodyExample} onChange={(e) => setBodyExample(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Texto-exemplo da legenda do card</Label>
            <Input value={cardBodyExample} onChange={(e) => setCardBodyExample(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Texto do botão (todos os cards)</Label>
            <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="grid gap-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground p-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando escada...
          </div>
        ) : (
          LADDER.map((qtd) => {
            const row = rows[qtd];
            return (
              <Card key={qtd} className="p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center font-semibold text-sm">
                    {qtd}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{qtd} cards</p>
                    <p className="text-xs text-muted-foreground">
                      {row?.template_id || `carrossel_escada_${qtd}cards`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(row)}
                  <Button
                    size="sm"
                    variant={row ? "outline" : "default"}
                    disabled={creating === qtd}
                    onClick={() => createRow(qtd)}
                    className="gap-1.5"
                  >
                    {creating === qtd ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {row ? "Recriar" : "Criar template"}
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
