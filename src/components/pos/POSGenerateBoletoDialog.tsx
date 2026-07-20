import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { posSendMedia, posSendText } from "@/lib/pos/posWhatsappSend";
import { FileText, Loader2, Send, ExternalLink, RefreshCw } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  phone: string;
  customerName?: string;
  storeId?: string | null;
  sendVia: "meta" | "zapi" | "uazapi" | "wasender";
  selectedNumberId?: string | null;
}

interface BoletoResult {
  boletoId: string;
  pdfUrl: string | null;
  boletoUrl: string | null;
  barcode: string | null;
  pixQrCode: string | null;
  amount: number;
  dueDate: string;
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

export function POSGenerateBoletoDialog({
  open, onOpenChange, phone, customerName, storeId, sendVia, selectedNumberId,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BoletoResult | null>(null);
  const [status, setStatus] = useState<string>("pending");
  const [checking, setChecking] = useState(false);

  const [form, setForm] = useState({
    customer_name: customerName || "",
    customer_cpf: "",
    customer_email: "",
    customer_phone: phone || "",
    address_zip: "",
    address_street: "",
    address_number: "",
    address_complement: "",
    address_neighborhood: "",
    address_city: "",
    address_state: "",
    amount: "",
    description: "",
    due_date: tomorrowIso(),
    include_pix: true,
  });

  useEffect(() => {
    if (!open) {
      setResult(null);
      setStatus("pending");
    } else {
      setForm((f) => ({
        ...f,
        customer_name: customerName || f.customer_name,
        customer_phone: phone || f.customer_phone,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Busca endereço por CEP
  const lookupCep = async () => {
    const cep = form.address_zip.replace(/\D/g, "");
    if (cep.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (j && !j.erro) {
        setForm((f) => ({
          ...f,
          address_street: j.logradouro || f.address_street,
          address_neighborhood: j.bairro || f.address_neighborhood,
          address_city: j.localidade || f.address_city,
          address_state: j.uf || f.address_state,
        }));
      }
    } catch { /* ignore */ }
  };

  const generate = async () => {
    setLoading(true);
    try {
      const amountNum = Number(String(form.amount).replace(",", "."));
      if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("Informe um valor válido");
      const { data, error } = await supabase.functions.invoke("mercadopago-create-boleto", {
        body: {
          ...form,
          amount: amountNum,
          storeId: storeId || null,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao gerar boleto");
      setResult({
        boletoId: data.boletoId,
        pdfUrl: data.pdfUrl,
        boletoUrl: data.boletoUrl,
        barcode: data.barcode,
        pixQrCode: data.pixQrCode,
        amount: data.amount,
        dueDate: data.dueDate,
      });
      toast.success("Boleto gerado com sucesso");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erro ao gerar boleto");
    } finally {
      setLoading(false);
    }
  };

  const sendToClient = async () => {
    if (!result?.pdfUrl) {
      toast.error("PDF ainda não disponível");
      return;
    }
    setSending(true);
    try {
      const captionLines = [
        `📄 *Boleto Banana Calçados*`,
        `Valor: R$ ${result.amount.toFixed(2).replace(".", ",")}`,
        `Vencimento: ${new Date(result.dueDate + "T00:00:00").toLocaleDateString("pt-BR")}`,
      ];
      if (result.barcode) captionLines.push(`\nLinha digitável:\n${result.barcode}`);
      const caption = captionLines.join("\n");

      await posSendMedia({
        provider: sendVia,
        phone,
        mediaUrl: result.pdfUrl,
        mediaType: "document",
        caption,
        numberId: selectedNumberId ?? null,
      });

      if (result.pixQrCode) {
        await posSendText({
          provider: sendVia,
          phone,
          text: `⚡ *Pagar via PIX (mesmo valor):*\n\n${result.pixQrCode}`,
          numberId: selectedNumberId ?? null,
        });
      }
      toast.success("Boleto enviado no WhatsApp");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erro ao enviar");
    } finally {
      setSending(false);
    }
  };

  const checkStatus = async () => {
    if (!result?.boletoId) return;
    setChecking(true);
    try {
      const { data } = await supabase
        .from("pos_boletos")
        .select("status, paid_at")
        .eq("id", result.boletoId)
        .maybeSingle();
      if (data?.status) setStatus(data.status);
      if (data?.status === "paid") toast.success("✅ Boleto pago!");
      else toast.info(`Status: ${data?.status || "desconhecido"}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-orange-500" />
            Gerar Boleto (Mercado Pago)
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nome completo *</Label>
                <Input value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} />
              </div>
              <div>
                <Label>CPF *</Label>
                <Input value={form.customer_cpf} onChange={(e) => set("customer_cpf", e.target.value)} placeholder="000.000.000-00" />
              </div>
              <div>
                <Label>E-mail *</Label>
                <Input type="email" value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>WhatsApp</Label>
                <Input value={form.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} />
              </div>

              <div>
                <Label>CEP *</Label>
                <Input value={form.address_zip} onChange={(e) => set("address_zip", e.target.value)} onBlur={lookupCep} placeholder="00000-000" />
              </div>
              <div className="col-span-1">
                <Label>Estado *</Label>
                <Input maxLength={2} value={form.address_state} onChange={(e) => set("address_state", e.target.value.toUpperCase())} />
              </div>
              <div className="col-span-2">
                <Label>Rua *</Label>
                <Input value={form.address_street} onChange={(e) => set("address_street", e.target.value)} />
              </div>
              <div>
                <Label>Número *</Label>
                <Input value={form.address_number} onChange={(e) => set("address_number", e.target.value)} />
              </div>
              <div>
                <Label>Complemento</Label>
                <Input value={form.address_complement} onChange={(e) => set("address_complement", e.target.value)} />
              </div>
              <div>
                <Label>Bairro *</Label>
                <Input value={form.address_neighborhood} onChange={(e) => set("address_neighborhood", e.target.value)} />
              </div>
              <div>
                <Label>Cidade *</Label>
                <Input value={form.address_city} onChange={(e) => set("address_city", e.target.value)} />
              </div>

              <div>
                <Label>Valor (R$) *</Label>
                <Input value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="199,90" />
              </div>
              <div>
                <Label>Vencimento *</Label>
                <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
              </div>

              <div className="col-span-2">
                <Label>Descrição</Label>
                <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Ex: Pedido #1234 - Tênis" />
              </div>

              <div className="col-span-2 flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">Incluir QR Code PIX no boleto</div>
                  <div className="text-xs text-muted-foreground">Cliente escolhe pagar por boleto ou PIX (mesmo valor)</div>
                </div>
                <Switch checked={form.include_pix} onCheckedChange={(v) => set("include_pix", v)} />
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={generate} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                Gerar boleto
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="rounded-lg border p-4 bg-muted/40">
              <div className="text-sm text-muted-foreground">Boleto gerado</div>
              <div className="text-2xl font-bold mt-1">R$ {result.amount.toFixed(2).replace(".", ",")}</div>
              <div className="text-sm mt-1">Vencimento: {new Date(result.dueDate + "T00:00:00").toLocaleDateString("pt-BR")}</div>
              <div className="mt-2 text-xs">Status atual: <span className="font-semibold">{status}</span></div>
              {result.barcode && (
                <div className="mt-3">
                  <div className="text-xs text-muted-foreground mb-1">Linha digitável</div>
                  <div className="font-mono text-xs break-all bg-background p-2 rounded border">{result.barcode}</div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {result.pdfUrl && (
                <Button variant="outline" asChild>
                  <a href={result.pdfUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" /> Abrir PDF
                  </a>
                </Button>
              )}
              {result.boletoUrl && (
                <Button variant="outline" asChild>
                  <a href={result.boletoUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" /> Boleto MP
                  </a>
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={sendToClient} disabled={sending || !result.pdfUrl} className="flex-1">
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar por WhatsApp
              </Button>
              <Button variant="outline" onClick={checkStatus} disabled={checking}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Verificar pagamento
              </Button>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button variant="secondary" onClick={() => setResult(null)}>Gerar outro</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
