import { useState, useEffect, useRef } from "react";
import { QrCode, Loader2, Copy, Check, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  phone: string;
  customerName?: string;
  sendVia: "zapi" | "meta";
  selectedNumberId: string | null;
}

export function POSWhatsAppPixDialog({
  open, onOpenChange, storeId, phone, customerName, sendVia, selectedNumberId,
}: Props) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [pixCode, setPixCode] = useState("");
  const [pixQrBase64, setPixQrBase64] = useState("");
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [paid, setPaid] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for payment
  useEffect(() => {
    if (!pixPaymentId || !saleId || paid) return;
    const check = async () => {
      try {
        const { data } = await supabase.functions.invoke("mercadopago-check-payment", {
          body: { paymentId: pixPaymentId, orderId: saleId },
        });
        if (data?.status === "approved") {
          setPaid(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
          await supabase.from("pos_sales").update({ status: "completed" } as any).eq("id", saleId);
          // Remove from awaiting payment
          await supabase.from("chat_awaiting_payment").delete().eq("phone", phone);
          toast.success("PIX confirmado! 🎉");
        }
      } catch {}
    };
    pollingRef.current = setInterval(check, 5000);
    check();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [pixPaymentId, saleId, paid]);

  useEffect(() => {
    if (!open && pollingRef.current) clearInterval(pollingRef.current);
  }, [open]);

  const handleGenerate = async () => {
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) { toast.error("Informe um valor válido"); return; }
    setGenerating(true);
    try {
      const { data: sale, error: saleErr } = await supabase.from("pos_sales").insert({
        store_id: storeId,
        subtotal: amountNum,
        discount: 0,
        total: amountNum,
        status: "online_pending",
        sale_type: "online",
        payment_gateway: "pix",
        payment_details: {
          customer_name: customerName || null,
          customer_phone: phone,
          description: description || "PIX WhatsApp",
        },
      } as any).select("id").single();
      if (saleErr || !sale) throw new Error("Erro ao criar registro");

      await supabase.from("pos_sale_items").insert({
        sale_id: sale.id,
        product_name: description || "Pagamento PIX",
        unit_price: amountNum,
        quantity: 1,
        total_price: amountNum,
      } as any);

      setSaleId(sale.id);

      const { data, error } = await supabase.functions.invoke("mercadopago-create-pix", {
        body: { orderId: sale.id },
      });
      if (error || !data?.qrCode) throw new Error("Erro ao gerar PIX");
      setPixCode(data.qrCode);
      setPixQrBase64(data.qrCodeBase64 || "");
      if (data.paymentId) setPixPaymentId(String(data.paymentId));

      // Add to awaiting payment
      await supabase.from("chat_awaiting_payment").upsert({
        phone,
        sale_id: sale.id,
        type: 'pix',
      } as any, { onConflict: 'phone' });

      toast.success("PIX gerado!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar PIX");
    } finally {
      setGenerating(false);
    }
  };

  const handleSendPix = async () => {
    if (!pixCode) return;
    setSending(true);
    try {
      const message = `💰 *PIX - R$ ${parseFloat(amount).toFixed(2)}*\n${description ? `📝 ${description}\n` : ''}\nCopie o código abaixo para pagar:\n\n${pixCode}`;
      if (sendVia === "meta" && selectedNumberId) {
        await supabase.functions.invoke("meta-whatsapp-send", { body: { phone, message, whatsapp_number_id: selectedNumberId } });
      } else {
        await supabase.functions.invoke("zapi-send-message", { body: { phone, message } });
      }
      await supabase.from("whatsapp_messages").insert({
        phone, message, direction: "outgoing", status: "sent",
        whatsapp_number_id: sendVia === "meta" ? selectedNumberId : null,
      });
      toast.success("PIX enviado!");
    } catch {
      toast.error("Erro ao enviar");
    } finally {
      setSending(false);
    }
  };

  const handleReset = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setPixCode("");
    setPixQrBase64("");
    setPixPaymentId(null);
    setSaleId(null);
    setPaid(false);
    setAmount("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleReset(); onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-emerald-500" />
            Gerar PIX
          </DialogTitle>
        </DialogHeader>

        {paid ? (
          <div className="text-center space-y-4 py-6">
            <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto animate-pulse">
              <Check className="h-8 w-8 text-emerald-500" />
            </div>
            <div>
              <p className="text-lg font-bold text-emerald-600">PIX Confirmado!</p>
              <p className="text-sm text-muted-foreground">R$ {parseFloat(amount).toFixed(2)}</p>
            </div>
            <Button onClick={() => { handleReset(); onOpenChange(false); }} className="w-full">Fechar</Button>
          </div>
        ) : pixCode ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
              <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Aguardando pagamento...</span>
            </div>
            {pixQrBase64 && (
              <div className="flex justify-center">
                <img src={`data:image/png;base64,${pixQrBase64}`} alt="QR Code PIX" className="w-48 h-48 rounded-lg border" />
              </div>
            )}
            <div>
              <div className="p-3 bg-muted/50 rounded-lg text-xs font-mono break-all max-h-20 overflow-y-auto">{pixCode}</div>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={async () => {
                  await navigator.clipboard.writeText(pixCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}>
                  {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                  {copied ? "Copiado!" : "Copiar"}
                </Button>
                <Button size="sm" className="flex-1 bg-[#00a884] hover:bg-[#008c6f]" onClick={handleSendPix} disabled={sending}>
                  {sending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
                  Enviar
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Valor: <span className="font-bold">R$ {parseFloat(amount).toFixed(2)}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Valor (R$) *</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                type="number"
                step="0.01"
                className="h-12 text-lg font-bold text-center"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-sm">Descrição (opcional)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Tamanco Cléo 36"
                className="h-9"
              />
            </div>
            {customerName && (
              <p className="text-xs text-muted-foreground">
                Cliente: <span className="font-medium">{customerName}</span>
              </p>
            )}
            <Button onClick={handleGenerate} disabled={generating || !amount} className="w-full h-12 text-lg bg-emerald-600 hover:bg-emerald-700">
              {generating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <QrCode className="h-5 w-5 mr-2" />}
              Gerar PIX
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
