import { useState } from "react";
import { QrCode, Loader2, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseChargebackBlock, chargebackBlockMessage } from "@/lib/chargebackBlock";
import {
  sendPixMessages,
  getPixIncludeQrPref,
  setPixIncludeQrPref,
  type PixSendChannel,
} from "@/lib/pix/sendPixMessages";

interface ChatPixButtonProps {
  /** ID do pedido para o qual o PIX será gerado */
  orderId?: string | null;
  /** Estilo do trigger: ícone branco (header de chat) ou botão completo */
  variant?: "icon-light" | "button";
  className?: string;
  /**
   * Canal de envio da conversa atual. Quando informado, o modal ganha o botão
   * "Enviar no WhatsApp" (código + botão Copiar, e QR code opcional).
   */
  channel?: PixSendChannel | null;
  /** Chamado após o envio bem-sucedido (ex.: recarregar histórico). */
  onSent?: () => void;
}

/**
 * Botão reutilizável para gerar uma chave PIX do PEDIDO REAL diretamente de dentro
 * de um chat (WhatsApp/Instagram). Gera via mercadopago-create-pix (mesmo valor,
 * desconto e conta do link de pagamento — a confirmação cai no pedido sozinha).
 */
export function ChatPixButton({ orderId, variant = "icon-light", className, channel, onSent }: ChatPixButtonProps) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pixCode, setPixCode] = useState<string>("");
  const [qrBase64, setQrBase64] = useState<string>("");
  const [amount, setAmount] = useState<number | null>(null);
  const [includeQr, setIncludeQr] = useState<boolean>(() => getPixIncludeQrPref());
  const [open, setOpen] = useState(false);

  const generate = async () => {
    if (!orderId) {
      toast.error("Salve o pedido primeiro para gerar o PIX");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("mercadopago-create-pix", {
        body: { orderId },
      });
      const blocked = await parseChargebackBlock(error, data);
      if (blocked) throw new Error(chargebackBlockMessage(blocked));
      if (error) throw error;
      if (data?.qrCode) {
        setPixCode(data.qrCode);
        setQrBase64(data.qrCodeBase64 || "");
        setAmount(data.amount ? Number(data.amount) : null);
        setOpen(true);
        try {
          await navigator.clipboard.writeText(data.qrCode);
          toast.success(`PIX gerado! Código copiado.${data.amount ? ` Valor: R$ ${data.amount}` : ""}`, { duration: 6000 });
        } catch {
          toast.success("PIX gerado!", { duration: 6000 });
        }
      } else {
        throw new Error(data?.error || "Nenhum dado de PIX retornado");
      }
    } catch (err) {
      console.error("Error generating PIX in chat:", err);
      const msg = err instanceof Error ? err.message : "Erro ao gerar PIX";
      toast.error(msg, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  };

  const copyAgain = () => {
    navigator.clipboard.writeText(pixCode.trim())
      .then(() => toast.success("Código PIX copiado!"))
      .catch(() => window.prompt("Copie o código PIX:", pixCode.trim()));
  };

  const handleSend = async () => {
    if (!channel || !pixCode || amount == null) return;
    setSending(true);
    try {
      const res = await sendPixMessages({
        channel,
        code: pixCode,
        amount,
        includeQr,
        qrBase64,
        qrKey: orderId || "pix",
      });
      toast.success(
        res.usedCopyButton
          ? `PIX enviado com botão Copiar${res.sentQr ? " + QR code" : ""}!`
          : `PIX enviado${res.sentQr ? " com QR code" : ""} (código isolado p/ copiar).`,
      );
      onSent?.();
      setOpen(false);
    } catch (e) {
      console.error("[ChatPixButton] envio falhou:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao enviar o PIX");
    } finally {
      setSending(false);
    }
  };

  const toggleQr = (v: boolean) => {
    setIncludeQr(v);
    setPixIncludeQrPref(v);
  };

  const supportsCopyButton = channel?.provider === "uazapi";

  return (
    <>
      {variant === "icon-light" ? (
        <Button
          variant="ghost"
          size="icon"
          className={className ?? "text-white hover:bg-white/10 h-8 w-8"}
          onClick={generate}
          disabled={loading}
          title={channel ? "Gerar e enviar PIX do pedido" : "Gerar PIX"}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className={className ?? "gap-1.5"}
          onClick={generate}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
          PIX
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-[hsl(160,70%,40%)]" />
              PIX do pedido gerado
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {amount != null && (
              <p className="text-sm text-muted-foreground">
                Valor: <span className="font-semibold text-foreground">R$ {amount.toFixed(2).replace(".", ",")}</span>
                <span className="ml-2 text-xs">· atrelado ao pedido, confirma sozinho ao pagar</span>
              </p>
            )}
            {qrBase64 && (
              <div className="flex justify-center">
                <img
                  src={`data:image/png;base64,${qrBase64}`}
                  alt="QR Code PIX"
                  className="w-40 h-40 rounded-lg border bg-white"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Código PIX (copia e cola)</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={pixCode}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 text-xs font-mono"
                />
                <Button type="button" size="sm" variant="outline" className="h-9 shrink-0 gap-1" onClick={copyAgain}>
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
            </div>

            {channel && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Enviar também o QR code</p>
                    <p className="text-xs text-muted-foreground">
                      Imagem para pagar pela galeria do banco. Sem isso vai só{" "}
                      {supportsCopyButton ? "o botão Copiar + a chave" : "a instrução + a chave"}.
                    </p>
                  </div>
                  <Switch checked={includeQr} onCheckedChange={toggleQr} disabled={!qrBase64} />
                </div>
                {!supportsCopyButton && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Esta instância não suporta botão "Copiar" nativo — a chave vai em mensagem isolada.
                  </p>
                )}
                <Button
                  className="w-full bg-[#00a884] hover:bg-[#008c6f] text-white gap-1.5"
                  onClick={handleSend}
                  disabled={sending}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? "Enviando..." : "Enviar PIX na conversa"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
