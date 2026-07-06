import { useState } from "react";
import { QrCode, Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ChatPixButtonProps {
  /** ID do pedido para o qual o PIX será gerado */
  orderId?: string | null;
  /** Estilo do trigger: ícone branco (header de chat) ou botão completo */
  variant?: "icon-light" | "button";
  className?: string;
}

/**
 * Botão reutilizável para gerar uma chave PIX diretamente de dentro de um chat
 * (WhatsApp/Instagram) do módulo de eventos. Gera via mercadopago-create-pix,
 * copia automaticamente e exibe o código em um modal para copiar novamente.
 */
export function ChatPixButton({ orderId, variant = "icon-light", className }: ChatPixButtonProps) {
  const [loading, setLoading] = useState(false);
  const [pixCode, setPixCode] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
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
      if (error) throw error;
      if (data?.qrCode) {
        setPixCode(data.qrCode);
        setAmount(data.amount ? String(data.amount) : "");
        setOpen(true);
        try {
          await navigator.clipboard.writeText(data.qrCode);
          toast.success(`PIX gerado! Código copiado.${data.amount ? ` Valor: R$ ${data.amount}` : ""}`, { duration: 6000 });
        } catch {
          toast.success("PIX gerado!", { duration: 6000 });
        }
      } else {
        throw new Error("Nenhum dado de PIX retornado");
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

  return (
    <>
      {variant === "icon-light" ? (
        <Button
          variant="ghost"
          size="icon"
          className={className ?? "text-white hover:bg-white/10 h-8 w-8"}
          onClick={generate}
          disabled={loading}
          title="Gerar PIX"
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
              Chave PIX gerada
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {amount && (
              <p className="text-sm text-muted-foreground">
                Valor: <span className="font-semibold text-foreground">R$ {amount}</span>
              </p>
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
