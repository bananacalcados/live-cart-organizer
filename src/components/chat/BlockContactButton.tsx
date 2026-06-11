import { useCallback, useEffect, useState } from "react";
import { Ban, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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

interface BlockContactButtonProps {
  /** Telefone do contato (qualquer formato; normalizado internamente). */
  phone?: string | null;
  /** Instância vinculada à conversa (whatsapp_number_id). */
  whatsappNumberId?: string | null;
  /** Nome exibido na confirmação. */
  customerName?: string | null;
  /** Quando true, mostra o rótulo de texto ao lado do ícone. */
  showLabel?: boolean;
  className?: string;
}

/**
 * Botão de bloqueio/desbloqueio nativo de contato no WhatsApp
 * (Meta / Z-API / WaSender / uazapi), com bloqueio cross-instância.
 */
export function BlockContactButton({
  phone,
  whatsappNumberId,
  customerName,
  showLabel = true,
  className,
}: BlockContactButtonProps) {
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!phone) {
      setIsBlocked(false);
      return;
    }
    (async () => {
      let digits = phone.replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 11) digits = "55" + digits;
      let query = supabase.from("blocked_contacts").select("id").eq("phone", digits);
      if (whatsappNumberId) query = query.eq("whatsapp_number_id", whatsappNumberId);
      const { data } = await query.limit(1);
      if (!cancelled) setIsBlocked((data?.length ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [phone, whatsappNumberId]);

  const handleToggleBlock = useCallback(async () => {
    if (!phone) return;
    if (!whatsappNumberId) {
      toast.error("Não foi possível identificar a instância desta conversa para bloquear.");
      return;
    }
    const action = isBlocked ? "unblock" : "block";
    setBlockLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("whatsapp-block-contact", {
        body: {
          phone,
          whatsapp_number_id: whatsappNumberId,
          action,
          blocked_by: userData?.user?.id ?? null,
        },
      });
      if (error) throw error;
      if (data?.success === false || data?.error) throw new Error(data?.error || "Falha no bloqueio");
      setIsBlocked(action === "block");
      toast.success(action === "block" ? "Contato bloqueado no WhatsApp" : "Contato desbloqueado");
    } catch (err) {
      console.error("[BlockContactButton] toggle block failed:", err);
      toast.error(
        `Não foi possível ${action === "block" ? "bloquear" : "desbloquear"} o contato. ${
          err instanceof Error ? err.message : ""
        }`,
      );
    } finally {
      setBlockLoading(false);
      setShowBlockConfirm(false);
    }
  }, [phone, whatsappNumberId, isBlocked]);

  if (!phone) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={blockLoading}
        onClick={() => (isBlocked ? handleToggleBlock() : setShowBlockConfirm(true))}
        className={cn(
          "h-7 px-1.5 text-xs gap-1",
          isBlocked
            ? "text-emerald-600 hover:text-emerald-700"
            : "text-muted-foreground hover:text-destructive",
          className,
        )}
        title={isBlocked ? "Desbloquear contato no WhatsApp" : "Bloquear contato no WhatsApp"}
      >
        {isBlocked ? (
          <>
            <ShieldCheck className="h-3.5 w-3.5" />
            {showLabel && <span className="hidden xl:inline">Desbloquear</span>}
          </>
        ) : (
          <>
            <Ban className="h-3.5 w-3.5" />
            {showLabel && <span className="hidden xl:inline">Bloquear</span>}
          </>
        )}
      </Button>

      <AlertDialog open={showBlockConfirm} onOpenChange={setShowBlockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear contato no WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso aciona o bloqueio nativo do WhatsApp para{" "}
              <strong>{customerName || phone}</strong>. Ele não receberá mais disparos em massa,
              automações nem mensagens de nenhuma das nossas instâncias até ser desbloqueado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={blockLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleToggleBlock();
              }}
              disabled={blockLoading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {blockLoading ? "Bloqueando..." : "Bloquear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default BlockContactButton;
