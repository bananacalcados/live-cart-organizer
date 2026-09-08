import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EraseContactButtonProps {
  phone?: string | null;
  instagramHandle?: string | null;
  customerName?: string | null;
  /** Chamado após a exclusão concluir com sucesso. */
  onErased?: () => void;
  showLabel?: boolean;
  className?: string;
}

/**
 * EXCLUIR CONTATO — apaga o contato de todas as bases (chat, leads, CRM/RFM,
 * disparos, automações) e registra opt-out permanente. Vendas e notas fiscais
 * são preservadas (registros contábeis).
 */
export function EraseContactButton({
  phone,
  instagramHandle,
  customerName,
  onErased,
  showLabel = true,
  className,
}: EraseContactButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);

  if (!phone && !instagramHandle) return null;
  const canConfirm = confirmText.trim().toUpperCase() === "EXCLUIR";

  const handleErase = async () => {
    if (!canConfirm) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("contact-erase", {
        body: { phone: phone || null, instagram_handle: instagramHandle || null, reason: "excluido_manual_chat" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const failures = Object.keys(data?.failures || {});
      toast.success(
        `Contato excluído: ${data?.deleted ?? 0} registro(s) apagado(s)` +
          (data?.anonymized ? `, ${data.anonymized} cadastro(s) anonimizado(s)` : "") +
          ". Opt-out permanente registrado.",
      );
      if (failures.length) toast.warning(`Algumas bases não puderam ser limpas: ${failures.join(", ")}`);
      setOpen(false);
      setConfirmText("");
      onErased?.();
    } catch (err) {
      console.error("[EraseContactButton]", err);
      toast.error(`Não foi possível excluir o contato. ${err instanceof Error ? err.message : ""}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn("h-7 px-1.5 text-xs gap-1 text-muted-foreground hover:text-destructive", className)}
        title="Excluir contato de todas as bases"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {showLabel && <span className="hidden xl:inline">Excluir contato</span>}
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmText(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato de todas as bases?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>{customerName || phone || instagramHandle}</strong> será apagado(a) do chat,
                  leads, CRM/Matriz RFM, listas de disparo e automações — em todas as instâncias.
                  Um bloqueio permanente de envios fica registrado: só voltaremos a falar com essa
                  pessoa se ela entrar em contato.
                </p>
                <p className="text-muted-foreground">
                  Vendas, pedidos e notas fiscais já emitidas são mantidos (registros contábeis).
                  Esta ação não pode ser desfeita.
                </p>
                <Input
                  autoFocus
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder='Digite EXCLUIR para confirmar'
                  className="h-8"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleErase(); }}
              disabled={loading || !canConfirm}
              className="bg-destructive hover:bg-destructive/90"
            >
              {loading ? "Excluindo..." : "Excluir contato"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default EraseContactButton;
