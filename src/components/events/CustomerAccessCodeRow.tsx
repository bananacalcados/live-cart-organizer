import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Copy, KeyRound, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Linha destacada com o código de acesso PERMANENTE (OTP fixo) do cliente,
 * para a equipe copiar e mandar manualmente quando o cliente não recebe no WhatsApp.
 */
export function CustomerAccessCodeRow({ phone }: { phone?: string | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const digits = String(phone || "").replace(/\D/g, "");

  useEffect(() => {
    let cancelled = false;
    if (digits.length < 10) {
      setCode(null);
      return;
    }
    setLoading(true);
    (async () => {
      const { data } = await supabase.rpc("get_or_create_customer_access_code" as any, {
        _phone: digits,
      } as any);
      if (!cancelled) {
        setCode(data ? String(data) : null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [digits]);

  if (digits.length < 10) return null;

  const resend = async () => {
    setSending(true);
    const { data, error } = await supabase.functions.invoke("live-member-area", {
      body: { action: "send_otp", phone: digits },
    });
    setSending(false);
    if (error || (data as any)?.success === false) {
      toast.error((data as any)?.error || "Não foi possível enviar o código pelo WhatsApp");
    } else {
      toast.success("Código enviado no WhatsApp!");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
      <KeyRound className="h-4 w-4 text-primary" />
      <span className="text-xs font-semibold text-muted-foreground">Código de acesso</span>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (!code) return;
            navigator.clipboard.writeText(code);
            toast.success("Código copiado!");
          }}
          className="flex items-center gap-1.5 font-mono text-lg font-black tracking-widest text-primary hover:opacity-80"
          title="Copiar código"
        >
          {code || "—"}
          {code && <Copy className="h-3.5 w-3.5 opacity-60" />}
        </button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="ml-auto gap-1.5 h-7 text-xs"
        onClick={resend}
        disabled={sending || !code}
      >
        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        Reenviar
      </Button>
    </div>
  );
}
