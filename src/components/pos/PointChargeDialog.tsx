import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Smartphone,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";

interface Terminal {
  id: string;
  pos_id?: number | string | null;
  store_id?: number | string | null;
  operating_mode?: string | null;
}

interface PointChargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Terminal pré-selecionado (opcional). */
  terminalId?: string;
  /** Valor pré-preenchido (opcional). */
  defaultAmount?: number;
  storeId?: string | null;
  saleId?: string | null;
  description?: string;
  /** Disparado quando a cobrança é confirmada (paga). */
  onPaid?: (intent: any) => void;
}

const FINAL_STATUSES = ["processed", "canceled", "refunded", "failed", "expired", "error"];

function statusLabel(status: string): { label: string; tone: "ok" | "wait" | "bad" } {
  switch (status) {
    case "processed":
      return { label: "Pago ✅", tone: "ok" };
    case "at_terminal":
      return { label: "Na maquininha — aguardando cliente", tone: "wait" };
    case "action_required":
      return { label: "Confirme na maquininha", tone: "wait" };
    case "created":
    case "pending":
      return { label: "Enviando para a maquininha...", tone: "wait" };
    case "canceled":
      return { label: "Cancelada", tone: "bad" };
    case "refunded":
      return { label: "Estornada", tone: "bad" };
    case "failed":
      return { label: "Pagamento recusado", tone: "bad" };
    case "expired":
      return { label: "Expirada (tempo esgotado)", tone: "bad" };
    case "error":
      return { label: "Erro ao cobrar", tone: "bad" };
    default:
      return { label: status, tone: "wait" };
  }
}

export function PointChargeDialog({
  open,
  onOpenChange,
  terminalId,
  defaultAmount,
  storeId,
  saleId,
  description,
  onPaid,
}: PointChargeDialogProps) {
  const { toast } = useToast();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loadingTerminals, setLoadingTerminals] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState<string>(terminalId || "");
  const [amount, setAmount] = useState<string>(defaultAmount ? String(defaultAmount) : "");
  const [sending, setSending] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const paidFiredRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Carrega terminais quando abre (apenas se não houver um pré-selecionado).
  useEffect(() => {
    if (!open) return;
    setSelectedTerminal(terminalId || "");
    setAmount(defaultAmount ? String(defaultAmount) : "");
    setIntentId(null);
    setStatus(null);
    setErrorMsg(null);
    paidFiredRef.current = false;

    if (terminalId) return;
    setLoadingTerminals(true);
    supabase.functions
      .invoke("point-terminals", { body: { action: "list" } })
      .then(({ data, error }) => {
        if (error || data?.error) {
          toast({
            title: "Maquininhas",
            description: data?.error || error?.message || "Falha ao listar maquininhas",
            variant: "destructive",
          });
          setTerminals([]);
          return;
        }
        const list: Terminal[] = data?.terminals ?? [];
        // Prioriza terminais em modo PDV (integrado).
        const pdv = list.filter((t) => (t.operating_mode || "").toUpperCase() === "PDV");
        setTerminals(pdv.length ? pdv : list);
      })
      .finally(() => setLoadingTerminals(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollStatus = useCallback(
    async (id: string) => {
      const { data, error } = await supabase.functions.invoke("point-create-order", {
        body: { action: "status", intent_id: id },
      });
      if (error) return;
      if (data?.status) {
        setStatus(data.status);
        if (data.status === "processed" && !paidFiredRef.current) {
          paidFiredRef.current = true;
          stopPolling();
          toast({ title: "Pagamento confirmado", description: "A cobrança foi paga na maquininha." });
          onPaid?.(data.intent);
        } else if (FINAL_STATUSES.includes(data.status)) {
          stopPolling();
        }
      }
    },
    [onPaid, stopPolling, toast],
  );

  const handleSend = async () => {
    const amt = Number(amount.replace(",", "."));
    if (!selectedTerminal) {
      toast({ title: "Selecione a maquininha", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Informe um valor válido", variant: "destructive" });
      return;
    }
    setSending(true);
    setErrorMsg(null);
    setStatus(null);
    paidFiredRef.current = false;
    try {
      const { data, error } = await supabase.functions.invoke("point-create-order", {
        body: {
          action: "create",
          terminal_id: selectedTerminal,
          amount: amt,
          description,
          store_id: storeId || null,
          sale_id: saleId || null,
        },
      });
      if (error) throw error;
      if (data?.error) {
        setErrorMsg(data.error);
        setStatus("error");
        return;
      }
      const newId = data?.intent?.id || null;
      setIntentId(newId);
      setStatus(data?.status || "created");
      toast({ title: "Cobrança enviada", description: "Confira a maquininha selecionada." });
      // Inicia polling.
      if (newId) {
        stopPolling();
        pollRef.current = setInterval(() => pollStatus(newId), 3000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Falha ao enviar cobrança");
      setStatus("error");
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async () => {
    if (!intentId) return;
    try {
      const { data } = await supabase.functions.invoke("point-create-order", {
        body: { action: "cancel", intent_id: intentId },
      });
      if (data?.error) {
        toast({ title: "Cancelamento", description: data.error, variant: "destructive" });
      } else {
        setStatus(data?.status || "canceled");
        stopPolling();
        toast({ title: "Cobrança cancelada" });
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const isInFlight = !!intentId && !!status && !FINAL_STATUSES.includes(status);
  const meta = status ? statusLabel(status) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) stopPolling(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" /> Cobrar na maquininha (Point)
          </DialogTitle>
          <DialogDescription>
            A cobrança é enviada direto para a maquininha selecionada. O cliente paga no aparelho e a
            confirmação chega aqui automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!terminalId && (
            <div className="space-y-1.5">
              <Label>Maquininha</Label>
              <Select
                value={selectedTerminal}
                onValueChange={setSelectedTerminal}
                disabled={loadingTerminals || isInFlight}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={loadingTerminals ? "Carregando..." : "Selecione o terminal"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {terminals.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.id}
                      {t.pos_id ? ` — Caixa ${t.pos_id}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loadingTerminals && terminals.length === 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Nenhuma maquininha em modo PDV encontrada.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isInFlight}
            />
          </div>

          {meta && (
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                meta.tone === "ok"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : meta.tone === "bad"
                  ? "border-red-300 bg-red-50 text-red-800"
                  : "border-amber-300 bg-amber-50 text-amber-800"
              }`}
            >
              {meta.tone === "ok" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : meta.tone === "bad" ? (
                <XCircle className="h-4 w-4 shrink-0" />
              ) : (
                <Clock className="h-4 w-4 shrink-0 animate-pulse" />
              )}
              <span>{meta.label}</span>
            </div>
          )}

          {errorMsg && (
            <p className="text-xs text-red-600">{errorMsg}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {isInFlight ? (
            <Button variant="outline" onClick={handleCancel}>
              Cancelar cobrança
            </Button>
          ) : (
            <Button variant="outline" onClick={() => { stopPolling(); onOpenChange(false); }}>
              Fechar
            </Button>
          )}
          <Button onClick={handleSend} disabled={sending || isInFlight}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...
              </>
            ) : isInFlight ? (
              "Aguardando pagamento..."
            ) : status === "processed" ? (
              "Nova cobrança"
            ) : (
              "Cobrar na maquininha"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
